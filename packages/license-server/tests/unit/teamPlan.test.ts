import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import crypto from 'crypto';

vi.mock('../../src/emailService.js', () => ({ sendLicenseEmail: vi.fn().mockResolvedValue(undefined) }));

import { sendLicenseEmail } from '../../src/emailService.js';
import { signLicenseKey, verifySignedKey } from '../../src/signing.js';
import validateHandler from '../../api/license/validate.js';
import lsHandler from '../../api/webhook/lemonsqueezy.js';
import rzpHandler from '../../api/webhook/razorpay.js';
import adminHandler from '../../api/admin/report.js';

const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
const PRIV_PEM = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const PUB_PEM = publicKey.export({ type: 'spki', format: 'pem' }).toString();

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
const lsCreated = (id: string, attributes: object) => {
    const body = JSON.stringify({ data: { id, attributes: { user_email: 'buyer@x.co', total: 900, currency: 'usd', ...attributes } } });
    return lsHandler(new Request('http://x/webhook/lemonsqueezy', {
        method: 'POST', body, headers: { 'x-event-name': 'subscription_created', 'x-signature': hmac(body, 'ls-secret') },
    }));
};
const rzpActivated = (subscription: object) => {
    const body = JSON.stringify({ event: 'subscription.activated', payload: {
        subscription: { entity: { notify_info: { notify_email: 'in@x.co' }, ...subscription } },
        payment: { entity: { amount: 29900, currency: 'INR' } },
    } });
    return rzpHandler(new Request('http://x/webhook/razorpay', {
        method: 'POST', body, headers: { 'x-razorpay-signature': hmac(body, 'rzp-secret') },
    }));
};
const validate = (key: string, machine_id = 'm1') => validateHandler(new Request('http://x/license/validate', {
    method: 'POST', body: JSON.stringify({ license_key: key, machine_id }), headers: { 'Content-Type': 'application/json' },
}));
const report = async () => (await adminHandler(new Request('http://x/admin/report', { headers: { Authorization: 'Bearer owner-token-0123456789' } }))).json();
const lastKey = () => vi.mocked(sendLicenseEmail).mock.calls.at(-1)![0].licenseKey;

beforeEach(() => {
    process.env.LICENSE_PRIVATE_KEY = PRIV_PEM;
    process.env.LEMONSQUEEZY_WEBHOOK_SECRET = 'ls-secret';
    process.env.RAZORPAY_WEBHOOK_SECRET = 'rzp-secret';
    process.env.ADMIN_TOKEN = 'owner-token-0123456789';
    process.env.KV_REST_API_URL = 'https://fake.upstash.io';
    process.env.KV_REST_API_TOKEN = 't';
    vi.stubGlobal('fetch', fakeUpstash());
    vi.mocked(sendLicenseEmail).mockClear();
});
afterEach(() => {
    vi.unstubAllGlobals();
    for (const k of ['LICENSE_PRIVATE_KEY', 'LEMONSQUEEZY_WEBHOOK_SECRET', 'RAZORPAY_WEBHOOK_SECRET', 'ADMIN_TOKEN', 'KV_REST_API_URL',
        'KV_REST_API_TOKEN', 'LEMONSQUEEZY_TEAM_VARIANT_IDS', 'RAZORPAY_TEAM_PLAN_IDS']) delete process.env[k];
});

describe('signed keys carry a plan', () => {
    it('defaults to pro with no seats, exactly as before', () => {
        const payload = verifySignedKey(signLicenseKey('ls:1'), PUB_PEM);
        expect(payload).toMatchObject({ v: 1, sub: 'ls:1', plan: 'pro' });
        expect(payload).not.toHaveProperty('seats');
    });

    it('signs and verifies a team key with seats', () => {
        expect(verifySignedKey(signLicenseKey('ls:2', undefined, { plan: 'team', seats: 8 }), PUB_PEM)).toMatchObject({ plan: 'team', seats: 8 });
    });

    it('signs a team key without seats', () => {
        const payload = verifySignedKey(signLicenseKey('ls:3', undefined, { plan: 'team' }), PUB_PEM);
        expect(payload?.plan).toBe('team');
        expect(payload).not.toHaveProperty('seats');
    });

    it('refuses to sign nonsense seats', () => {
        for (const seats of [0, -1, 1.5, Number.NaN, 1e9]) {
            expect(() => signLicenseKey('ls:4', undefined, { plan: 'team', seats })).toThrow(/seats/);
        }
    });

    it('rejects a validly signed payload with an unknown plan or malformed seats', () => {
        const forge = (extra: object) => {
            const body = Buffer.from(JSON.stringify({ v: 1, sub: 'ls:5', iat: 1, ...extra })).toString('base64url');
            const sig = crypto.sign(null, Buffer.from(`LLMO1.${body}`), privateKey).toString('base64url');
            return `LLMO1.${body}.${sig}`;
        };
        expect(verifySignedKey(forge({ plan: 'enterprise' }), PUB_PEM)).toBeNull();
        expect(verifySignedKey(forge({ plan: 'team', seats: '5' }), PUB_PEM)).toBeNull();
        expect(verifySignedKey(forge({ plan: 'team', seats: 0 }), PUB_PEM)).toBeNull();
        expect(verifySignedKey(forge({ plan: 'team', seats: 2.5 }), PUB_PEM)).toBeNull();
        expect(verifySignedKey(forge({ plan: 'team', seats: 3 }), PUB_PEM)).not.toBeNull();
    });
});

describe('POST /license/validate with team keys', () => {
    it('accepts a team key and reports plan and seats; a pro key reports pro', async () => {
        const team = await validate(signLicenseKey('ls:10', undefined, { plan: 'team', seats: 5 }));
        expect(team.status).toBe(200);
        expect(await team.json()).toMatchObject({ valid: true, plan: 'team', seats: 5 });
        const pro = await validate(signLicenseKey('ls:11'));
        expect(await pro.json()).toMatchObject({ valid: true, plan: 'pro' });
    });
});

describe('Lemon Squeezy webhook maps variants to plans', () => {
    it('issues a team key with seats when the variant is listed, and records it for /admin', async () => {
        process.env.LEMONSQUEEZY_TEAM_VARIANT_IDS = '111, 222';
        const res = await lsCreated('900', { variant_id: 222, first_subscription_item: { quantity: 7 } });
        expect(res.status).toBe(200);
        expect(verifySignedKey(lastKey(), PUB_PEM)).toMatchObject({ sub: 'ls:900', plan: 'team', seats: 7 });
        expect((await report()).customers[0]).toMatchObject({ sub: 'ls:900', plan: 'team', seats: 7 });
    });

    it('issues pro when the variant is not listed, when the list is unset, or when seats are absent', async () => {
        expect(await lsCreated('901', { variant_id: 5 })).toBeTruthy();
        expect(verifySignedKey(lastKey(), PUB_PEM)?.plan).toBe('pro');

        process.env.LEMONSQUEEZY_TEAM_VARIANT_IDS = '111';
        await lsCreated('902', { variant_id: 5, first_subscription_item: { quantity: 4 } });
        expect(verifySignedKey(lastKey(), PUB_PEM)).toMatchObject({ plan: 'pro' });
        expect(verifySignedKey(lastKey(), PUB_PEM)).not.toHaveProperty('seats');

        await lsCreated('903', { variant_id: 111 });
        const payload = verifySignedKey(lastKey(), PUB_PEM);
        expect(payload?.plan).toBe('team');
        expect(payload).not.toHaveProperty('seats');

        const customers = (await report()).customers as any[];
        expect(customers.find(c => c.sub === 'ls:901')).toMatchObject({ plan: 'pro' });
        expect(customers.find(c => c.sub === 'ls:902').seats).toBeUndefined();
    });
});

describe('Razorpay webhook maps plan ids to plans', () => {
    it('issues a team key for a listed plan id with the subscription quantity as seats', async () => {
        process.env.RAZORPAY_TEAM_PLAN_IDS = 'plan_team_monthly,plan_team_yearly';
        expect((await rzpActivated({ id: 'sub_T1', plan_id: 'plan_team_yearly', quantity: 12 })).status).toBe(200);
        expect(verifySignedKey(lastKey(), PUB_PEM)).toMatchObject({ sub: 'rzp:sub_T1', plan: 'team', seats: 12 });
        expect((await report()).customers[0]).toMatchObject({ plan: 'team', seats: 12 });
    });

    it('issues pro for an unlisted plan id', async () => {
        process.env.RAZORPAY_TEAM_PLAN_IDS = 'plan_team_monthly';
        await rzpActivated({ id: 'sub_P1', plan_id: 'plan_pro_monthly', quantity: 3 });
        expect(verifySignedKey(lastKey(), PUB_PEM)).toMatchObject({ plan: 'pro' });
    });
});
