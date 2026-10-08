/**
 * Customer / activation / install records, kept in Upstash Redis via its REST
 * API (no client library — just fetch). Add the "Upstash for Redis"
 * integration to the Vercel project and it sets KV_REST_API_URL and
 * KV_REST_API_TOKEN automatically (UPSTASH_REDIS_REST_* also accepted).
 *
 * Every function is a no-op when storage isn't configured, so licensing and
 * webhooks keep working — you just don't get the owner view in /admin.
 *
 * Keys:
 *   customer:<sub>           hash  sub, provider, email, status, plan, seats, amount, currency, created_at, updated_at, last_event
 *   customers                set   all subs
 *   activations:<sub>        hash  machine_id -> JSON { first_seen, last_seen, version }
 *   install:<install_id>     hash  version, os, tier, first_seen, last_seen
 *   installs                 zset  install_id scored by last_seen (ms)
 */

export type CustomerStatus = 'active' | 'cancelled' | 'expired';

export interface CustomerRecord {
    sub: string;
    provider: 'lemonsqueezy' | 'razorpay';
    email: string;
    status: CustomerStatus;
    plan: string;
    /** Seats bought (team plan only); informational. */
    seats?: number;
    amount?: string;
    currency?: string;
    created_at: string;
    updated_at: string;
    last_event: string;
}

function config(): { url: string; token: string } | null {
    const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
    return url && token ? { url: url.replace(/\/$/, ''), token } : null;
}

export function isStoreConfigured(): boolean {
    return config() !== null;
}

type Cmd = (string | number)[];

async function pipeline(cmds: Cmd[]): Promise<any[]> {
    const cfg = config();
    if (!cfg) return cmds.map(() => null);
    const res = await fetch(`${cfg.url}/pipeline`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${cfg.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(cmds.map(c => c.map(String))),
    });
    if (!res.ok) throw new Error(`Redis REST ${res.status}`);
    const out = (await res.json()) as { result?: unknown; error?: string }[];
    return out.map(r => {
        if (r.error) throw new Error(`Redis: ${r.error}`);
        return r.result;
    });
}

/** Redis HGETALL returns a flat [k1, v1, k2, v2, ...] array over REST. */
function toObject(flat: unknown): Record<string, string> {
    const obj: Record<string, string> = {};
    if (Array.isArray(flat)) for (let i = 0; i + 1 < flat.length; i += 2) obj[String(flat[i])] = String(flat[i + 1]);
    return obj;
}

const hset = (key: string, fields: Record<string, string | undefined>): Cmd => {
    const cmd: Cmd = ['HSET', key];
    for (const [k, v] of Object.entries(fields)) if (v !== undefined) cmd.push(k, v);
    return cmd;
};

export async function upsertCustomer(c: Omit<CustomerRecord, 'created_at' | 'updated_at'>): Promise<void> {
    if (!isStoreConfigured()) return;
    const now = new Date().toISOString();
    await pipeline([
        ['HSETNX', `customer:${c.sub}`, 'created_at', now],
        hset(`customer:${c.sub}`, { ...c, seats: c.seats === undefined ? undefined : String(c.seats), updated_at: now }),
        ['SADD', 'customers', c.sub],
    ]);
}

export async function setCustomerStatus(sub: string, status: CustomerStatus, event: string): Promise<void> {
    if (!isStoreConfigured()) return;
    const [exists] = await pipeline([['EXISTS', `customer:${sub}`]]);
    if (!exists) return; // never issued a key for this subscription
    await pipeline([hset(`customer:${sub}`, { status, last_event: event, updated_at: new Date().toISOString() })]);
}

export async function getCustomerStatus(sub: string): Promise<CustomerStatus | null> {
    if (!isStoreConfigured()) return null;
    const [status] = await pipeline([['HGET', `customer:${sub}`, 'status']]);
    return (status as CustomerStatus) ?? null;
}

export async function recordActivation(sub: string, machineId: string, version: string): Promise<void> {
    if (!isStoreConfigured()) return;
    const now = new Date().toISOString();
    const [prev] = await pipeline([['HGET', `activations:${sub}`, machineId]]);
    const first_seen = prev ? (JSON.parse(String(prev)).first_seen ?? now) : now;
    await pipeline([['HSET', `activations:${sub}`, machineId, JSON.stringify({ first_seen, last_seen: now, version })]]);
}

export async function recordPing(p: { install_id: string; version: string; os: string; tier: string }): Promise<void> {
    if (!isStoreConfigured()) return;
    const now = Date.now();
    await pipeline([
        ['HSETNX', `install:${p.install_id}`, 'first_seen', new Date(now).toISOString()],
        hset(`install:${p.install_id}`, { version: p.version, os: p.os, tier: p.tier, last_seen: new Date(now).toISOString() }),
        ['ZADD', 'installs', now, p.install_id],
    ]);
}

export interface OwnerReport {
    customers: (CustomerRecord & { activations: { machine_id: string; first_seen: string; last_seen: string; version: string }[] })[];
    installs: {
        active_7d: number;
        active_30d: number;
        total_ever: number;
        by_tier: Record<string, number>;
        by_version: Record<string, number>;
        by_os: Record<string, number>;
    };
}

const DAY = 24 * 60 * 60 * 1000;

export async function ownerReport(): Promise<OwnerReport> {
    const [subs] = await pipeline([['SMEMBERS', 'customers']]);
    const subList: string[] = Array.isArray(subs) ? subs.map(String) : [];
    const custResults = subList.length
        ? await pipeline(subList.flatMap(s => [['HGETALL', `customer:${s}`], ['HGETALL', `activations:${s}`]] as Cmd[]))
        : [];
    const customers = subList.map((_, i) => {
        const { seats, ...c } = toObject(custResults[i * 2]) as Record<string, string>;
        const acts = toObject(custResults[i * 2 + 1]);
        return {
            ...(c as unknown as CustomerRecord),
            ...(seats !== undefined && Number.isFinite(Number(seats)) ? { seats: Number(seats) } : {}),
            activations: Object.entries(acts).map(([machine_id, v]) => ({ machine_id, ...JSON.parse(v) })),
        };
    }).sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));

    const now = Date.now();
    const [total, active7, ids30] = await pipeline([
        ['ZCARD', 'installs'],
        ['ZCOUNT', 'installs', now - 7 * DAY, '+inf'],
        ['ZRANGEBYSCORE', 'installs', now - 30 * DAY, '+inf'],
    ]);
    const idList: string[] = Array.isArray(ids30) ? ids30.map(String) : [];
    const installs = idList.length ? await pipeline(idList.map(id => ['HGETALL', `install:${id}`] as Cmd)) : [];
    const by_tier: Record<string, number> = {};
    const by_version: Record<string, number> = {};
    const by_os: Record<string, number> = {};
    for (const raw of installs) {
        const r = toObject(raw);
        by_tier[r.tier || 'unknown'] = (by_tier[r.tier || 'unknown'] ?? 0) + 1;
        by_version[r.version || 'unknown'] = (by_version[r.version || 'unknown'] ?? 0) + 1;
        by_os[r.os || 'unknown'] = (by_os[r.os || 'unknown'] ?? 0) + 1;
    }
    return {
        customers,
        installs: {
            active_7d: Number(active7) || 0,
            active_30d: idList.length,
            total_ever: Number(total) || 0,
            by_tier, by_version, by_os,
        },
    };
}
