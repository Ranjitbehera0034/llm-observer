import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import crypto from 'crypto';

vi.mock('../../src/emailService.js', () => ({ sendLicenseEmail: vi.fn().mockResolvedValue(undefined) }));

import { sendLicenseEmail } from '../../src/emailService.js';
import validateHandler from '../../api/license/validate.js';
import lsHandler from '../../api/webhook/lemonsqueezy.js';
import pingHandler from '../../api/telemetry/ping.js';
import adminHandler from '../../api/admin/report.js';

/** Minimal in-memory stand-in for the Upstash REST /pipeline endpoint. */
function fakeUpstash() {
    const h = new Map<string, Map<string, string>>();
    const s = new Map<string, Set<string>>();
    const z = new Map<string, Map<string, number>>();
    const hash = (k: string) => h.get(k) ?? h.set(k, new Map()).get(k)!;
    const num = (v: string) => (v === '+inf' ? Infinity : Number(v));
    const run = ([cmd, key, ...a]: string[]): unknown => {
        switch (cmd) {
            case 'HSET': for (let i = 0; i < a.length; i += 2) hash(key).set(a[i], a[i + 1]); return 1;
            case 'HSETNX': if (hash(key).has(a[0])) return 0; hash(key).set(a[0], a[1]); return 1;
            case 'HGET': return h.get(key)?.get(a[0]) ?? null;
            case 'HGETALL': return [...(h.get(key) ?? new Map())].flat();
            case 'EXISTS': return h.has(key) ? 1 : 0;
            case 'SADD': (s.get(key) ?? s.set(key, new Set()).get(key)!).add(a[0]); return 1;
            case 'SMEMBERS': return [...(s.get(key) ?? [])];
            case 'ZADD': (z.get(key) ?? z.set(key, new Map()).get(key)!).set(a[1], Number(a[0])); return 1;
            case 'ZCARD': return z.get(key)?.size ?? 0;
            case 'ZCOUNT': return [...(z.get(key) ?? new Map()).values()].filter(v => v >= num(a[0]) && v <= num(a[1])).length;
            case 'ZRANGEBYSCORE': return [...(z.get(key) ?? new Map())].filter(([, v]) => v >= num(a[0]) && v <= num(a[1])).map(([m]) => m);
            default: throw new Error(`fake redis: ${cmd} not implemented`);
        }
    };
    return vi.fn(async (_url: string, init: RequestInit) => {
        const cmds = JSON.parse(String(init.body)) as string[][];
        return new Response(JSON.stringify(cmds.map(c => ({ result: run(c) }))));
    });
}

const hmac = (body: string, secret: string) => crypto.createHmac('sha256', secret).update(body).digest('hex');
const lsEvent = (event: string, data: object) => {
    const body = JSON.stringify({ data });
    return lsHandler(new Request('http://x/webhook/lemonsqueezy', {
        method: 'POST', body, headers: { 'x-event-name': event, 'x-signature': hmac(body, 'ls-secret') },
    }));
};
const postJson = (handler: (r: Request) => Promise<Response>, body: object) =>
    handler(new Request('http://x', { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } }));
const report = async () => (await adminHandler(new Request('http://x/admin/report', { headers: { Authorization: 'Bearer owner-token-0123456789' } }))).json();

beforeEach(() => {
    const { privateKey } = crypto.generateKeyPairSync('ed25519');
    process.env.LICENSE_PRIVATE_KEY = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    process.env.LEMONSQUEEZY_WEBHOOK_SECRET = 'ls-secret';
    process.env.ADMIN_TOKEN = 'owner-token-0123456789';
    process.env.KV_REST_API_URL = 'https://fake.upstash.io';
    process.env.KV_REST_API_TOKEN = 't';
    vi.stubGlobal('fetch', fakeUpstash());
    vi.mocked(sendLicenseEmail).mockClear();
});
afterEach(() => {
    vi.unstubAllGlobals();
    for (const k of ['LICENSE_PRIVATE_KEY', 'LEMONSQUEEZY_WEBHOOK_SECRET', 'ADMIN_TOKEN', 'KV_REST_API_URL', 'KV_REST_API_TOKEN']) delete process.env[k];
});

describe('Owner view end to end', () => {
    it('tracks a customer from purchase through activation to expiry', async () => {
        expect((await lsEvent('subscription_created', { id: '501', attributes: { user_email: 'paid@x.co', total: 900, currency: 'usd' } })).status).toBe(200);
        const key = vi.mocked(sendLicenseEmail).mock.calls[0][0].licenseKey;

        // Webhook retry for the same subscription doesn't email a second key
        await lsEvent('subscription_created', { id: '501', attributes: { user_email: 'paid@x.co' } });
        expect(sendLicenseEmail).toHaveBeenCalledTimes(1);

        // The app activates on two machines
        for (const m of ['mac-1', 'linux-2']) {
            expect((await postJson(validateHandler, { license_key: key, machine_id: m, version: '2.0.1' })).status).toBe(200);
        }

        let r = await report();
        expect(r.customers).toHaveLength(1);
        expect(r.customers[0]).toMatchObject({ email: 'paid@x.co', status: 'active', provider: 'lemonsqueezy', amount: '9.00', currency: 'USD' });
        expect(r.customers[0].activations.map((a: any) => a.machine_id).sort()).toEqual(['linux-2', 'mac-1']);

        // Cancelled: still valid until the period ends
        await lsEvent('subscription_cancelled', { id: '501', attributes: {} });
        expect((await postJson(validateHandler, { license_key: key })).status).toBe(200);

        // Expired: the app is told to drop to Free
        await lsEvent('subscription_expired', { id: '501', attributes: {} });
        const res = await postJson(validateHandler, { license_key: key });
        expect(res.status).toBe(403);
        expect(await res.json()).toMatchObject({ valid: false, revoked: true });
        r = await report();
        expect(r.customers[0].status).toBe('expired');
    });

    it('counts opted-in installs by tier, version and OS', async () => {
        const a = crypto.randomUUID();
        await postJson(pingHandler, { install_id: a, version: '2.0.1', os: 'darwin', tier: 'free' });
        await postJson(pingHandler, { install_id: a, version: '2.0.1', os: 'darwin', tier: 'free' }); // same install, next day
        await postJson(pingHandler, { install_id: crypto.randomUUID(), version: '2.0.1', os: 'linux', tier: 'pro' });

        const { installs } = await report();
        expect(installs).toMatchObject({ active_7d: 2, active_30d: 2, total_ever: 2 });
        expect(installs.by_tier).toEqual({ free: 1, pro: 1 });
        expect(installs.by_os).toEqual({ darwin: 1, linux: 1 });
    });
});
