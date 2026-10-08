import crypto from 'crypto';

const settings = new Map<string, string>();
jest.mock('@llm-observer/database', () => ({
    getDb: jest.fn(),
    getSetting: (k: string) => settings.get(k) ?? null,
    updateSetting: (k: string, v: string) => { settings.set(k, v); },
}));

import { activateLicense, getLicenseInfo } from '../../licenseManager';
import { __setLicensePublicKeyForTests, verifySignedKey } from '../../licenseKeys';

const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
__setLicensePublicKeyForTests(publicKey.export({ type: 'spki', format: 'pem' }).toString());

function sign(payload: object, key: crypto.KeyObject = privateKey): string {
    const body = Buffer.from(JSON.stringify({ v: 1, sub: 'ls:1', iat: 1, ...payload })).toString('base64url');
    const sig = crypto.sign(null, Buffer.from(`LLMO1.${body}`), key).toString('base64url');
    return `LLMO1.${body}.${sig}`;
}

beforeEach(() => {
    settings.clear();
    (global as any).fetch = jest.fn(() => Promise.resolve(new Response(JSON.stringify({ valid: true }), { status: 200 })));
});

describe('licence plans', () => {
    it('free install reports plan free', async () => {
        expect(await getLicenseInfo(true)).toMatchObject({ isPro: false, plan: 'free' });
    });

    it('an existing pro key still works and reports plan pro', async () => {
        expect((await activateLicense(sign({ plan: 'pro' }))).success).toBe(true);
        const info = await getLicenseInfo(true);
        expect(info).toMatchObject({ isPro: true, status: 'active', plan: 'pro', limits: { maxProjects: 100, logRetentionDays: 90 } });
        expect(info.seats).toBeUndefined();
    });

    it('a team key activates, gets the Pro limits, and exposes plan and seats', async () => {
        const res = await activateLicense(sign({ plan: 'team', seats: 5 }));
        expect(res.success).toBe(true);
        expect(await getLicenseInfo(true)).toMatchObject({
            isPro: true, status: 'active', plan: 'team', seats: 5, limits: { maxProjects: 100, logRetentionDays: 90 },
        });
    });

    it('a team key without seats is fine', async () => {
        await activateLicense(sign({ plan: 'team' }));
        const info = await getLicenseInfo(true);
        expect(info.plan).toBe('team');
        expect(info.seats).toBeUndefined();
    });

    it('rejects unknown plans, malformed seats and foreign signatures', async () => {
        for (const payload of [{ plan: 'enterprise' }, { plan: 'team', seats: '5' }, { plan: 'team', seats: 0 }, { plan: 'team', seats: 1.5 }]) {
            expect((await activateLicense(sign(payload))).success).toBe(false);
        }
        const forger = crypto.generateKeyPairSync('ed25519').privateKey;
        expect((await activateLicense(sign({ plan: 'team', seats: 5 }, forger))).success).toBe(false);
        expect((await getLicenseInfo(true)).plan).toBe('free');
    });

    it('a cancelled team licence falls back to free', async () => {
        await activateLicense(sign({ plan: 'team', seats: 5 }));
        settings.set('license_status', 'cancelled');
        expect(await getLicenseInfo(true)).toMatchObject({ isPro: false, plan: 'free', status: 'cancelled' });
    });

    it('a stored team key that no longer verifies is unresolved free, not team', async () => {
        settings.set('license_key', sign({ plan: 'team', seats: 5 }, crypto.generateKeyPairSync('ed25519').privateKey));
        settings.set('license_status', 'active');
        expect(await getLicenseInfo(true)).toMatchObject({ isPro: false, plan: 'free', integrityMismatch: true });
    });

    it('verifySignedKey returns plan and seats', () => {
        expect(verifySignedKey(sign({ plan: 'team', seats: 3 }))).toMatchObject({ plan: 'team', seats: 3 });
    });
});
