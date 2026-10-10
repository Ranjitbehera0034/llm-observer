/**
 * Shared fixture for the Team tier tests: a real in-memory database, a real licence manager
 * verifying keys signed by a throwaway keypair (SYNTHETIC keys, never valid anywhere else), and a
 * fake `fetch` that plays the licence server and the team server. No network, no MongoDB.
 */
import crypto from 'crypto';
import { getDb, updateSetting } from '@llm-observer/database';
import { __setLicensePublicKeyForTests } from '../../licenseKeys';
import { activateLicense, getLicenseInfo } from '../../licenseManager';

const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
__setLicensePublicKeyForTests(publicKey.export({ type: 'spki', format: 'pem' }).toString());

export function signedKey(plan: 'pro' | 'team', extra: object = {}): string {
    const body = Buffer.from(JSON.stringify({ v: 1, sub: 'test:1', iat: 1, plan, ...extra })).toString('base64url');
    const sig = crypto.sign(null, Buffer.from(`LLMO1.${body}`), privateKey).toString('base64url');
    return `LLMO1.${body}.${sig}`;
}

export const TEAM_URL = 'https://team.example.test';
export const TEAM_KEY = 'tk_live_0123456789abcdef0123456789abcdef';
export const TEAM_EMAIL = 'dev@example.test';

export interface PolicyBudgetJson { scope: 'daily' | 'weekly' | 'monthly'; limitUsd: number; provider?: string; action: 'alert' | 'block' }

export interface FakeTeamServer {
    /** What GET /api/team/policy answers. Set `status` to simulate an error. */
    policy: { version: number; budgets: PolicyBudgetJson[] } | any;
    policyStatus: number;
    /** Throw this from fetch (offline). */
    offline: boolean;
    /** Every request the team server saw. */
    calls: { method: string; url: string; headers: Record<string, string>; body?: any }[];
    syncStatus: number;
    rollup: { status: number; body: any };
}

export function installFakeFetch(): FakeTeamServer {
    const server: FakeTeamServer = {
        policy: { version: 1, budgets: [] }, policyStatus: 200, offline: false, calls: [], syncStatus: 200,
        rollup: { status: 200, body: { totals: {}, members: [] } },
    };
    const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
    (global as any).fetch = jest.fn(async (input: any, init: any = {}) => {
        const url = String(input);
        const headers: Record<string, string> = {};
        for (const [k, v] of Object.entries(init.headers || {})) headers[k.toLowerCase()] = String(v);
        if (url.includes('/license/validate')) return json(200, { valid: true });
        if (url.startsWith(TEAM_URL) || url.startsWith('http://localhost:4002')) {
            server.calls.push({ method: init.method || 'GET', url, headers, body: init.body ? JSON.parse(init.body) : undefined });
            if (server.offline) throw new TypeError('fetch failed');
            if (url.endsWith('/api/team/policy')) return json(server.policyStatus, server.policy);
            if (url.endsWith('/api/team/sync')) return json(server.syncStatus, { success: true, synced_count: 1 });
            if (/\/rollup/.test(url)) return json(server.rollup.status, server.rollup.body);
        }
        throw new Error(`unexpected fetch ${url}`);
    });
    return server;
}

export async function setLicence(plan: 'free' | 'pro' | 'team'): Promise<void> {
    updateSetting('license_status', 'active');
    for (const k of ['license_key', 'license_key_hmac']) getDb().prepare('DELETE FROM settings WHERE key = ?').run(k);
    if (plan !== 'free') {
        const res = await activateLicense(signedKey(plan, plan === 'team' ? { seats: 5 } : {}));
        if (!res.success) throw new Error(res.message);
    }
    await getLicenseInfo(true);
}

/** The licence lapses (subscription ended): the same path revalidation takes on an explicit "revoked". */
export async function lapseLicence(): Promise<void> {
    updateSetting('license_status', 'cancelled');
    await getLicenseInfo(true);
}

export function joinTeam(over: Record<string, string> = {}): void {
    const s = { team_server_url: TEAM_URL, team_id: 'acme', team_api_key: TEAM_KEY, team_member_email: TEAM_EMAIL, team_sync_enabled: 'true', ...over };
    for (const [k, v] of Object.entries(s)) updateSetting(k, v);
}

export function teamRows(): any[] {
    return getDb().prepare("SELECT * FROM budgets WHERE source = 'team' ORDER BY id").all();
}
export function localRows(): any[] {
    return getDb().prepare("SELECT * FROM budgets WHERE source = 'local' ORDER BY id").all();
}
