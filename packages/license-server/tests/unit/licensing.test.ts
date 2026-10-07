import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import crypto from 'crypto';

vi.mock('../../src/emailService.js', () => ({ sendLicenseEmail: vi.fn().mockResolvedValue(undefined) }));

import { signLicenseKey, verifySignedKey } from '../../src/signing.js';
import { sendLicenseEmail } from '../../src/emailService.js';
import validateHandler from '../../api/license/validate.js';
import lsHandler from '../../api/webhook/lemonsqueezy.js';
import rzpHandler from '../../api/webhook/razorpay.js';
import pingHandler from '../../api/telemetry/ping.js';
import adminHandler from '../../api/admin/report.js';

const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
const PRIV_PEM = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const PUB_PEM = publicKey.export({ type: 'spki', format: 'pem' }).toString();

const post = (handler: (r: Request) => Promise<Response>, path: string, body: unknown, headers: Record<string, string> = {}) =>
    handler(new Request(`http://x${path}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...headers },
        body: typeof body === 'string' ? body : JSON.stringify(body),
    }));

const hmac = (body: string, secret: string) => crypto.createHmac('sha256', secret).update(body).digest('hex');

beforeEach(() => {
    process.env.LICENSE_PRIVATE_KEY = PRIV_PEM;
    vi.mocked(sendLicenseEmail).mockClear();
});
afterEach(() => {
    for (const k of ['LICENSE_PRIVATE_KEY', 'LEMONSQUEEZY_WEBHOOK_SECRET', 'LEMONSQUEEZY_SIGNING_SECRET', 'RAZORPAY_WEBHOOK_SECRET', 'ADMIN_TOKEN']) delete process.env[k];
});

describe('Signed (LLMO1) license keys', () => {
    it('verifies a key signed by the matching private key', () => {
        const key = signLicenseKey('ls:123');
        expect(verifySignedKey(key, PUB_PEM)?.sub).toBe('ls:123');
    });

    it('rejects a key signed by a different keypair', () => {
        const other = crypto.generateKeyPairSync('ed25519').privateKey;
        expect(verifySignedKey(signLicenseKey('ls:123', other), PUB_PEM)).toBeNull();
    });

    it('rejects a key whose payload was edited', () => {
        const [p, , sig] = signLicenseKey('ls:123').split('.');
        const forgedBody = Buffer.from(JSON.stringify({ v: 1, sub: 'ls:999', plan: 'pro', iat: 1 })).toString('base64url');
        expect(verifySignedKey(`${p}.${forgedBody}.${sig}`, PUB_PEM)).toBeNull();
    });

    it('accepts the private key with escaped newlines, as pasted into env UIs', () => {
        process.env.LICENSE_PRIVATE_KEY = PRIV_PEM.trim().replace(/\n/g, '\\n');
        expect(verifySignedKey(signLicenseKey('rzp:sub_1'), PUB_PEM)).not.toBeNull();
    });
});

describe('POST /license/validate with signed keys', () => {
    it('accepts a genuine signed key', async () => {
        const res = await post(validateHandler, '/license/validate', { license_key: signLicenseKey('ls:42'), machine_id: 'm1', version: '2.0.1' });
        expect(res.status).toBe(200);
        expect((await res.json()).valid).toBe(true);
    });

    it('rejects a signed key from another keypair', async () => {
        const other = crypto.generateKeyPairSync('ed25519').privateKey;
        const res = await post(validateHandler, '/license/validate', { license_key: signLicenseKey('ls:42', other) });
        expect(res.status).toBe(400);
        expect((await res.json()).valid).toBe(false);
    });
});

describe('Webhooks fail closed', () => {
    it('LemonSqueezy rejects every request when no secret is configured', async () => {
        const res = await post(lsHandler, '/webhook/lemonsqueezy', { data: { id: '1', attributes: { user_email: 'a@b.co' } } }, { 'x-event-name': 'subscription_created' });
        expect(res.status).toBe(503);
        expect(sendLicenseEmail).not.toHaveBeenCalled();
    });

    it('LemonSqueezy rejects a bad signature', async () => {
        process.env.LEMONSQUEEZY_WEBHOOK_SECRET = 's3cret';
        const res = await post(lsHandler, '/webhook/lemonsqueezy', { data: { id: '1' } }, { 'x-event-name': 'subscription_created', 'x-signature': 'ab'.repeat(32) });
        expect(res.status).toBe(401);
    });

    it('Razorpay rejects every request when no secret is configured', async () => {
        const res = await post(rzpHandler, '/webhook/razorpay', { event: 'payment.captured', payload: { payment: { entity: { email: 'a@b.co', id: 'pay_1' } } } });
        expect(res.status).toBe(503);
        expect(sendLicenseEmail).not.toHaveBeenCalled();
    });
});

describe('Webhooks issue signed keys', () => {
    it('LemonSqueezy subscription_created emails a verifiable key (LEMONSQUEEZY_SIGNING_SECRET name accepted)', async () => {
        process.env.LEMONSQUEEZY_SIGNING_SECRET = 'ls-secret';
        const body = JSON.stringify({ data: { id: '777', attributes: { user_email: 'buyer@x.co', total: 900, currency: 'usd' } } });
        const res = await post(lsHandler, '/webhook/lemonsqueezy', body, { 'x-event-name': 'subscription_created', 'x-signature': hmac(body, 'ls-secret') });
        expect(res.status).toBe(200);
        const { licenseKey, to } = vi.mocked(sendLicenseEmail).mock.calls[0][0];
        expect(to).toBe('buyer@x.co');
        expect(verifySignedKey(licenseKey, PUB_PEM)?.sub).toBe('ls:777');
    });

    it('LemonSqueezy renewals and order_created do not send another key', async () => {
        process.env.LEMONSQUEEZY_WEBHOOK_SECRET = 'ls-secret';
        for (const event of ['subscription_payment_success', 'order_created']) {
            const body = JSON.stringify({ data: { id: 'inv_1', attributes: { subscription_id: 777, user_email: 'buyer@x.co' } } });
            const res = await post(lsHandler, '/webhook/lemonsqueezy', body, { 'x-event-name': event, 'x-signature': hmac(body, 'ls-secret') });
            expect(res.status).toBe(200);
        }
        expect(sendLicenseEmail).not.toHaveBeenCalled();
    });

    it('Razorpay skips payment.captured for a subscription charge', async () => {
        process.env.RAZORPAY_WEBHOOK_SECRET = 'rzp-secret';
        const body = JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: { id: 'pay_2', email: 'a@b.co', invoice_id: 'inv_9' } } } });
        const res = await post(rzpHandler, '/webhook/razorpay', body, { 'x-razorpay-signature': hmac(body, 'rzp-secret') });
        expect(res.status).toBe(200);
        expect(sendLicenseEmail).not.toHaveBeenCalled();
    });

    it('Razorpay one-time payment.captured issues a key', async () => {
        process.env.RAZORPAY_WEBHOOK_SECRET = 'rzp-secret';
        const body = JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: { id: 'pay_3', order_id: 'order_3', email: 'in@x.co', amount: 29900, currency: 'INR' } } } });
        const res = await post(rzpHandler, '/webhook/razorpay', body, { 'x-razorpay-signature': hmac(body, 'rzp-secret') });
        expect(res.status).toBe(200);
        const { licenseKey } = vi.mocked(sendLicenseEmail).mock.calls[0][0];
        expect(verifySignedKey(licenseKey, PUB_PEM)?.sub).toBe('rzp:order_3');
    });

    it('returns 503 (so the provider retries) when the signing key is missing', async () => {
        delete process.env.LICENSE_PRIVATE_KEY;
        process.env.RAZORPAY_WEBHOOK_SECRET = 'rzp-secret';
        const body = JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: { id: 'pay_4', email: 'in@x.co' } } } });
        const res = await post(rzpHandler, '/webhook/razorpay', body, { 'x-razorpay-signature': hmac(body, 'rzp-secret') });
        expect(res.status).toBe(503);
    });
});

describe('POST /telemetry/ping', () => {
    it('accepts a well-formed anonymous ping', async () => {
        const res = await post(pingHandler, '/telemetry/ping', { install_id: crypto.randomUUID(), version: '2.0.1', os: 'darwin', tier: 'free' });
        expect(res.status).toBe(204);
    });

    it('rejects anything that is not the documented shape', async () => {
        for (const body of [
            { install_id: 'not-a-uuid', version: '2.0.1', os: 'linux', tier: 'free' },
            { install_id: crypto.randomUUID(), version: '2.0.1', os: 'linux', tier: 'enterprise' },
            { install_id: crypto.randomUUID(), version: '<script>', os: 'linux', tier: 'pro' },
        ]) {
            expect((await post(pingHandler, '/telemetry/ping', body)).status).toBe(400);
        }
    });
});

describe('GET /admin/report', () => {
    const get = (token?: string) => adminHandler(new Request('http://x/admin/report', {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
    }));

    it('is disabled until ADMIN_TOKEN is set', async () => {
        expect((await get('anything')).status).toBe(503);
    });

    it('rejects a wrong token', async () => {
        process.env.ADMIN_TOKEN = 'correct-horse-battery-staple';
        expect((await get('wrong-token-wrong-token')).status).toBe(401);
        expect((await get()).status).toBe(401);
    });

    it('explains when storage is not configured', async () => {
        process.env.ADMIN_TOKEN = 'correct-horse-battery-staple';
        const res = await get('correct-horse-battery-staple');
        expect(res.status).toBe(503);
        expect((await res.json()).error).toMatch(/Upstash/);
    });
});
