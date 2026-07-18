import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { generateLicenseKey, verifyLicenseKey, isValidLicenseKeyFormat } from '../../src/keyGenerator.js';
import checkoutHandler from '../../api/checkout/razorpay.js';
import validateHandler from '../../api/license/validate.js';

describe('License key generation & verification', () => {
    it('generates a key that passes cryptographic verification', () => {
        const key = generateLicenseKey({
            provider: 'razorpay',
            subscriptionId: 'sub_ABC123xyz789',
            customerId: 'cust_1'
        });
        expect(isValidLicenseKeyFormat(key)).toBe(true);
        expect(verifyLicenseKey(key)).toBe(true);
    });

    it('is deterministic — same payment always yields the same key', () => {
        const opts = { provider: 'lemonsqueezy' as const, subscriptionId: 'ls_sub_42', customerId: 'c9' };
        expect(generateLicenseKey(opts)).toBe(generateLicenseKey(opts));
    });

    it('rejects forged keys that match the format but not the HMAC', () => {
        const forged = 'PRO_RZP_DEADBEEF_FAKESUB123';
        expect(isValidLicenseKeyFormat(forged)).toBe(true); // looks right...
        expect(verifyLicenseKey(forged)).toBe(false);       // ...but is not genuine
    });

    it('rejects tampered keys (fingerprint from a different subscription)', () => {
        const real = generateLicenseKey({ provider: 'razorpay', subscriptionId: 'sub_AAA', customerId: 'c' });
        const [p, tag, fp] = real.split('_');
        const tampered = `${p}_${tag}_${fp}_STOLENSUB`;
        expect(verifyLicenseKey(tampered)).toBe(false);
    });
});

describe('POST /license/validate', () => {
    const post = (body: unknown) => validateHandler(new Request('http://x/license/validate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    }));

    it('accepts a genuinely issued key', async () => {
        const key = generateLicenseKey({ provider: 'razorpay', subscriptionId: 'sub_REAL1', customerId: 'c' });
        const res = await post({ license_key: key });
        const data = await res.json();
        expect(res.status).toBe(200);
        expect(data.valid).toBe(true);
        expect(data.tier).toBe('pro');
    });

    it('rejects a well-formed but forged key', async () => {
        const res = await post({ license_key: 'PRO_LS_ABCD1234_NOTREAL' });
        const data = await res.json();
        expect(res.status).toBe(400);
        expect(data.valid).toBe(false);
    });
});

describe('POST /checkout/razorpay', () => {
    const post = (body: unknown) => checkoutHandler(new Request('http://x/checkout/razorpay', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    }));

    beforeEach(() => {
        process.env.RAZORPAY_KEY_ID = 'rzp_test_key';
        process.env.RAZORPAY_KEY_SECRET = 'rzp_test_secret';
    });
    afterEach(() => {
        delete process.env.RAZORPAY_KEY_ID;
        delete process.env.RAZORPAY_KEY_SECRET;
        vi.unstubAllGlobals();
    });

    it('returns 503 when payment credentials are not configured', async () => {
        delete process.env.RAZORPAY_KEY_ID;
        const res = await post({ email: 'a@b.co' });
        expect(res.status).toBe(503);
    });

    it('rejects a missing or malformed email', async () => {
        const res = await post({ email: 'not-an-email' });
        expect(res.status).toBe(400);
        const data = await res.json();
        expect(data.error).toContain('email');
    });

    it('creates a payment link and returns its URL', async () => {
        const fetchMock = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({
            id: 'plink_123', short_url: 'https://rzp.io/l/test123'
        }), { status: 200 }));
        vi.stubGlobal('fetch', fetchMock);

        const res = await post({ email: 'dev@example.com' });
        const data = await res.json();
        expect(res.status).toBe(200);
        expect(data.url).toBe('https://rzp.io/l/test123');

        // Server-side call carries auth + the customer email; secrets never
        // reach the browser (they live only in this serverless function)
        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toBe('https://api.razorpay.com/v1/payment_links');
        expect(init.headers['Authorization']).toMatch(/^Basic /);
        const sent = JSON.parse(init.body);
        expect(sent.customer.email).toBe('dev@example.com');
        expect(sent.currency).toBe('INR');
    });

    it('maps Razorpay API failures to a 502 without leaking details', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response('upstream error', { status: 500 })));
        const res = await post({ email: 'dev@example.com' });
        expect(res.status).toBe(502);
        const data = await res.json();
        expect(data.error).not.toContain('upstream');
    });
});
