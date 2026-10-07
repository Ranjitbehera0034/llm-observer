import crypto from 'crypto';

// Real in-memory database (every migration applied) + a settings map; the real
// licenseManager runs against them so licence behaviour drives retention.
jest.mock('@llm-observer/database', () => {
    const { createTestDb } = require('../helpers/testDb');
    const { database } = createTestDb();
    const settings = new Map<string, string>();
    return {
        getDb: () => database,
        getSetting: (k: string) => settings.get(k) ?? null,
        updateSetting: (k: string, v: string) => { settings.set(k, v); },
        __settings: settings,
    };
});

import os from 'os';
import { getDb } from '@llm-observer/database';
import { runCleanup } from '../../retentionManager';
import { activateLicense, getLicenseInfo, getMachineId } from '../../licenseManager';
import { __setLicensePublicKeyForTests } from '../../licenseKeys';

const settings: Map<string, string> = (require('@llm-observer/database') as any).__settings;

const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
__setLicensePublicKeyForTests(publicKey.export({ type: 'spki', format: 'pem' }).toString());

function sign(sub: string): string {
    const body = Buffer.from(JSON.stringify({ v: 1, sub, plan: 'pro', iat: 1 })).toString('base64url');
    const sig = crypto.sign(null, Buffer.from(`LLMO1.${body}`), privateKey).toString('base64url');
    return `LLMO1.${body}.${sig}`;
}

const daysAgo = (n: number) => new Date(Date.now() - n * 86400_000).toISOString();

function seed() {
    const db = getDb();
    db.exec('DELETE FROM requests; DELETE FROM alerts; DELETE FROM optimization_cache;');
    const ins = db.prepare("INSERT INTO requests (id, project_id, provider, model, cost_usd, created_at) VALUES (?, 'default', 'openai', 'gpt-4', 0.01, ?)");
    ins.run('r-10d', daysAgo(10));
    ins.run('r-30d', daysAgo(30));
    ins.run('r-100d', daysAgo(100));
    const al = db.prepare("INSERT INTO alerts (id, project_id, type, message, created_at) VALUES (?, 'default', 'latency_spike', 'x', ?)");
    al.run('a-10d', daysAgo(10));
    al.run('a-1d', daysAgo(1));
    al.run('a-100d', daysAgo(100));
}
const requestIds = () => (getDb().prepare('SELECT id FROM requests ORDER BY id').all() as any[]).map(r => r.id);
const alertIds = () => (getDb().prepare('SELECT id FROM alerts ORDER BY id').all() as any[]).map(r => r.id);

beforeEach(() => {
    settings.clear();
    (global as any).fetch = jest.fn(() => Promise.resolve(new Response(JSON.stringify({ valid: true }), { status: 200 })));
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    seed();
});
afterEach(() => jest.restoreAllMocks());

describe('runCleanup', () => {
    it('purges alerts older than the retention window along with requests', async () => {
        await runCleanup();
        expect(requestIds()).toEqual([]);          // free tier: 7 days
        expect(alertIds()).toEqual(['a-1d']);
    });

    it('prunes expired optimization_cache rows stored as ISO timestamps, keeps live ones', async () => {
        const ins = getDb().prepare("INSERT INTO optimization_cache (computed_at, days_analyzed, score, total_savings_usd, results_json, expires_at) VALUES (?, 7, 1, 0, '[]', ?)");
        ins.run(daysAgo(2), new Date(Date.now() - 3600_000).toISOString());   // expired an hour ago
        ins.run(daysAgo(0), new Date(Date.now() + 3600_000).toISOString());   // expires in an hour
        await runCleanup();
        const left = getDb().prepare('SELECT count(*) AS n FROM optimization_cache').get() as any;
        expect(left.n).toBe(1);
    });

    it('keeps Pro retention for a signed key after the hostname changes', async () => {
        expect((await activateLicense(sign('ls:ret'))).success).toBe(true);
        await runCleanup();
        expect(requestIds()).toEqual(['r-10d', 'r-30d']);

        // Container recreated: new hostname => new machine id => the machine HMAC no longer matches.
        jest.spyOn(os, 'hostname').mockReturnValue('recreated-container-abc123');
        expect(getMachineId()).not.toBe(settings.get('license_machine_id'));
        const info = await getLicenseInfo(true);
        expect(info.isPro).toBe(true);
        expect(info.limits.logRetentionDays).toBe(90);

        seed();
        await runCleanup();
        expect(requestIds()).toEqual(['r-10d', 'r-30d']);
        expect(alertIds()).toEqual(['a-10d', 'a-1d']);
    });

    it('never shortens retention on a legacy-key HMAC mismatch', async () => {
        process.env.LLM_OBSERVER_DEV_LICENSE = '1';
        try {
            expect((await activateLicense('PRO_LS_ABCD1234_SUB1')).success).toBe(true);
        } finally { delete process.env.LLM_OBSERVER_DEV_LICENSE; }
        await runCleanup();
        expect(settings.get('last_good_retention_days')).toBe('90');

        jest.spyOn(os, 'hostname').mockReturnValue('another-host');
        seed();
        await runCleanup();
        // Unresolved licence: nothing is deleted at all, not even down to the last good window.
        expect(requestIds()).toEqual(['r-100d', 'r-10d', 'r-30d']);
        expect(alertIds()).toEqual(['a-100d', 'a-10d', 'a-1d']);
        expect((await getLicenseInfo(true)).notice).toMatch(/could not be verified/i);
    });

    it('deletes nothing on a legacy-key HMAC mismatch even when no good window was ever recorded', async () => {
        process.env.LLM_OBSERVER_DEV_LICENSE = '1';
        try {
            expect((await activateLicense('PRO_LS_ABCD1234_SUB1')).success).toBe(true);
        } finally { delete process.env.LLM_OBSERVER_DEV_LICENSE; }
        settings.delete('last_good_retention_days');   // first 2.0.2 run after an upgrade

        jest.spyOn(os, 'hostname').mockReturnValue('recreated-container');
        seed();
        await runCleanup();
        expect(requestIds()).toEqual(['r-100d', 'r-10d', 'r-30d']);
        expect(alertIds()).toEqual(['a-100d', 'a-10d', 'a-1d']);
        expect((await getLicenseInfo(true)).integrityMismatch).toBe(true);
        expect((await getLicenseInfo(true)).notice).toMatch(/could not be verified/i);
        expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('could not be verified'));
    });

    it('records the Pro window when a licence is activated', async () => {
        expect(settings.get('last_good_retention_days')).toBeUndefined();
        expect((await activateLicense(sign('ls:seed'))).success).toBe(true);
        expect(settings.get('last_good_retention_days')).toBe('90');
    });

    it('deletes nothing when a stored signed key cannot be verified and was never cancelled', async () => {
        settings.set('license_key', 'LLMO1.corrupted.payload');
        settings.set('license_status', 'active');
        seed();
        await runCleanup();
        expect(requestIds()).toEqual(['r-100d', 'r-10d', 'r-30d']);
        const info = await getLicenseInfo(true);
        expect(info.integrityMismatch).toBe(true);
        expect(info.isPro).toBe(false);
        expect(info.notice).toBeTruthy();
    });

    it('keeps budget alerts (the dedupe rows) and their acknowledged state past the window', async () => {
        const db = getDb();
        db.prepare("INSERT INTO alerts (id, project_id, type, message, budget_id, period_start, acknowledged, created_at) VALUES ('b-old', 'default', 'budget_exceeded', 'x', 7, '2026-10-01', 1, ?)")
            .run(daysAgo(40));
        await runCleanup();
        expect(alertIds()).toEqual(['a-1d', 'b-old']);   // ordinary old alerts go, the budget alert stays
        const row = db.prepare("SELECT acknowledged FROM alerts WHERE id = 'b-old'").get() as any;
        expect(row.acknowledged).toBe(1);
    });

    it('deletes requests just past the cutoff on the same calendar date (ISO vs datetime text)', async () => {
        const db = getDb();
        const ins = db.prepare("INSERT INTO requests (id, project_id, provider, model, cost_usd, created_at) VALUES (?, 'default', 'openai', 'gpt-4', 0.01, ?)");
        ins.run('r-just-over', new Date(Date.now() - 7 * 86400_000 - 60_000).toISOString());
        ins.run('r-just-under', new Date(Date.now() - 7 * 86400_000 + 3600_000).toISOString());
        // A row written by the column default (space-separated) must compare correctly too.
        db.prepare("INSERT INTO requests (id, project_id, provider, model, cost_usd, created_at) VALUES ('r-sqlite-fmt', 'default', 'openai', 'gpt-4', 0.01, datetime('now', '-8 days'))").run();
        await runCleanup();
        expect(requestIds()).toEqual(['r-just-under']);
    });

    it('does shorten retention once the licence is confirmed cancelled', async () => {
        await activateLicense(sign('ls:cancel'));
        await runCleanup();
        expect(settings.get('last_good_retention_days')).toBe('90');
        settings.set('license_status', 'cancelled');
        seed();
        await runCleanup();
        expect(requestIds()).toEqual([]);
        expect(settings.get('last_good_retention_days')).toBe('7');
    });
});
