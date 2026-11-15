import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import crypto from 'crypto';
import { generateLicenseKey, decodeLicenseKey, verifyLicenseKey } from '../../src/keyGenerator.js';
import checkoutEntry from '../../api/checkout/razorpay.js';
import validateEntry from '../../api/license/validate.js';
import healthEntry from '../../api/health.js';
import lemonWebhookEntry from '../../api/webhook/lemonsqueezy.js';
import razorpayWebhookEntry from '../../api/webhook/razorpay.js';
import { handleWebhook } from '../../src/webhook.js';
import { getEntitlement } from '../../src/entitlement.js';
const { sendEmail } = vi.hoisted(() => ({ sendEmail: vi.fn().mockResolvedValue(undefined) }));
const checkout = checkoutEntry.fetch;
const validate = validateEntry.fetch;
vi.mock('../../src/emailService.js', () => ({ sendLicenseEmail: sendEmail }));
const future = () => new Date(Date.now() + 86400000).toISOString();
const post = (body: unknown) => new Request('https://test.invalid', { method: 'POST', body: JSON.stringify(body) });
const reply = (data: any, status = 200) => new Response(JSON.stringify(data), { status });
const key = (id = '123') => generateLicenseKey({ provider: 'lemonsqueezy', subscriptionId: id, customerId: '1' });
const subscription = (attrs: any = {}) => ({ data: { attributes: { status: 'active', store_id: 1, variant_id: 2, renews_at: future(), user_email: 'buyer@example.com', ...attrs } } });
const invoice = (attrs: any = {}) => ({ data: [{ attributes: { status: 'paid', refunded: false, ...attrs } }] });
let mockFetch: ReturnType<typeof vi.fn>;
beforeEach(() => {
    vi.stubEnv('LICENSE_SIGNING_SECRET', 'a'.repeat(64));
    vi.stubEnv('LEMONSQUEEZY_API_KEY', 'test');
    vi.stubEnv('LEMONSQUEEZY_STORE_ID', '1');
    vi.stubEnv('LEMONSQUEEZY_VARIANT_IDS', '2,3');
    vi.stubEnv('LEMONSQUEEZY_WEBHOOK_SECRET', 'test-webhook');
    vi.stubEnv('RAZORPAY_WEBHOOK_SECRET', 'test-webhook');
    vi.stubEnv('RAZORPAY_KEY_ID', 'rzp_test_key');
    vi.stubEnv('RAZORPAY_KEY_SECRET', 'test');
    vi.stubEnv('PAYMENTS_TEST_MODE', 'false');
    mockFetch = vi.fn(); vi.stubGlobal('fetch', mockFetch); sendEmail.mockClear();
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('Vercel Web entrypoints', () => {
    it('routes standard Requests through the deployed fetch export', async () => {
        const response = await healthEntry.fetch(new Request('https://test.invalid/health'));
        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({ service: 'llm-observer-license-server' });
        expect((await checkoutEntry.fetch(new Request('https://test.invalid', { method: 'OPTIONS' }))).status).toBe(204);
        expect((await validateEntry.fetch(new Request('https://test.invalid', { method: 'OPTIONS' }))).status).toBe(204);
        expect((await lemonWebhookEntry.fetch(webhook({}, false))).status).toBe(401);
        expect((await razorpayWebhookEntry.fetch(webhook({}, false))).status).toBe(401);
    });
});

describe('license identity', () => {
    it('preserves full case-sensitive references and generates stable keys', () => {
        const options = { provider: 'razorpay' as const, subscriptionId: 'plink_Aa12345678901234567890', customerId: '1' };
        const k = generateLicenseKey(options);
        expect(decodeLicenseKey(k)?.id).toBe(options.subscriptionId);
        expect(generateLicenseKey(options)).toBe(k);
        expect(generateLicenseKey({ ...options, subscriptionId: options.subscriptionId + 'x' })).not.toBe(k);
        expect(verifyLicenseKey(k.slice(0, -1) + 'x')).toBe(false);
    });
    it('fails closed without a signing secret', () => {
        vi.stubEnv('LICENSE_SIGNING_SECRET', ''); expect(() => key()).toThrow();
    });
    it('rejects old prefix-only and truncated keys', () => {
        expect(verifyLicenseKey('PRO_LS_ABCD1234_SUB123')).toBe(false);
    });
});

describe('provider-backed access', () => {
    it('activates a paid subscription and does not return customer email', async () => {
        mockFetch.mockResolvedValueOnce(reply(subscription())).mockResolvedValueOnce(reply(invoice()));
        const response = await validate(post({ license_key: key() }));
        expect(response.status).toBe(200);
        const data = await response.json();
        expect(data).toMatchObject({ valid: true, tier: 'pro' });
        expect(data).not.toHaveProperty('email');
        for (const [, options] of mockFetch.mock.calls) {
            expect(options.headers).toMatchObject({ Accept: 'application/vnd.api+json', 'Content-Type': 'application/vnd.api+json' });
        }
    });
    it.each(['expired', 'unpaid', 'past_due', 'paused'])('rejects %s', async status => {
        mockFetch.mockResolvedValueOnce(reply(subscription({ status })));
        expect((await getEntitlement('lemonsqueezy', '123')).valid).toBe(false);
    });
    it('honors cancellation until the paid-through date', async () => {
        mockFetch.mockResolvedValueOnce(reply(subscription({ status: 'cancelled', ends_at: future() }))).mockResolvedValueOnce(reply(invoice()));
        expect((await getEntitlement('lemonsqueezy', '123')).valid).toBe(true);
    });
    it('rejects cancellation after the paid period', async () => {
        mockFetch.mockResolvedValueOnce(reply(subscription({ status: 'cancelled', ends_at: '2020-01-01' })));
        expect((await getEntitlement('lemonsqueezy', '123')).valid).toBe(false);
    });
    it.each([{ refunded: true }, { refunded_amount: 100 }, { status: 'failed' }])('rejects refund/failed invoice %j', async attrs => {
        mockFetch.mockResolvedValueOnce(reply(subscription())).mockResolvedValueOnce(reply(invoice(attrs)));
        expect((await getEntitlement('lemonsqueezy', '123')).valid).toBe(false);
    });
    it.each([{ store_id: 9 }, { variant_id: 9 }, { test_mode: true }])('rejects wrong product/store/test mode %j', async attrs => {
        mockFetch.mockResolvedValueOnce(reply(subscription(attrs)));
        expect((await getEntitlement('lemonsqueezy', '123')).valid).toBe(false);
    });
    it('treats provider outages as retryable, not a revocation', async () => {
        mockFetch.mockRejectedValue(new Error('timeout'));
        const response = await validate(post({ license_key: key() }));
        expect(response.status).toBe(503); expect((await response.json()).valid).toBeUndefined();
    });
    it('handles malformed body and forged keys', async () => {
        expect((await validate(post(null))).status).toBe(400);
        expect((await validate(post({ license_key: 'PRO_fake' }))).status).toBe(400);
        expect(mockFetch).not.toHaveBeenCalled();
    });
    const link = () => ({ status: 'paid', currency: 'INR', amount: 79900, amount_paid: 79900, accept_partial: false, notes: { product: 'llm-observer', plan: 'pro-30-days' }, customer: { email: 'buyer@example.com' }, payments: [{ status: 'captured', payment_id: 'pay_abc' }] });
    const payment = (attrs = {}) => ({ status: 'captured', captured: true, currency: 'INR', amount: 79900, amount_refunded: 0, created_at: Math.floor(Date.now() / 1000), ...attrs });
    it('grants a paid Razorpay pass for exactly 30 days', async () => {
        const p = payment(); mockFetch.mockResolvedValueOnce(reply(link())).mockResolvedValueOnce(reply(p));
        const e = await getEntitlement('razorpay', 'plink_abc');
        expect(e.valid).toBe(true); expect(Date.parse(e.valid_until!)).toBe(p.created_at * 1000 + 30 * 86400000);
    });
    it.each([{ amount_refunded: 1 }, { created_at: 1 }])('rejects refunded or expired Razorpay passes %j', async attrs => {
        mockFetch.mockResolvedValueOnce(reply(link())).mockResolvedValueOnce(reply(payment(attrs)));
        expect((await getEntitlement('razorpay', 'plink_abc')).valid).toBe(false);
    });
});

function webhook(body: any, signature = true) {
    const raw = JSON.stringify(body);
    return new Request('https://test.invalid', { method: 'POST', body: raw, headers: { 'x-signature': signature ? crypto.createHmac('sha256', 'test-webhook').update(raw).digest('hex') : 'fake' } });
}
describe('purchase email and renewals', () => {
    it('requires configured secrets and valid signatures', async () => {
        expect((await handleWebhook(webhook({}, false), 'lemonsqueezy')).status).toBe(401);
        vi.stubEnv('LEMONSQUEEZY_WEBHOOK_SECRET', '');
        expect((await handleWebhook(webhook({}), 'lemonsqueezy')).status).toBe(503);
        expect(sendEmail).not.toHaveBeenCalled();
    });
    it('new purchase and renewal deliver the same subscription key', async () => {
        mockFetch.mockImplementation(async url => reply(String(url).includes('subscription-invoices') ? invoice() : subscription()));
        await handleWebhook(webhook({ meta: { event_name: 'subscription_created' }, data: { id: '123' } }), 'lemonsqueezy');
        await handleWebhook(webhook({ meta: { event_name: 'subscription_payment_success' }, data: { id: 'invoice99', attributes: { subscription_id: '123' } } }), 'lemonsqueezy');
        expect(sendEmail).toHaveBeenCalledTimes(2);
        expect(sendEmail.mock.calls[0][0].licenseKey).toBe(sendEmail.mock.calls[1][0].licenseKey);
        expect(sendEmail.mock.calls[1][0].idempotencyKey).toContain('invoice99');
    });
    it('returns retryable failure if delivery fails', async () => {
        mockFetch.mockResolvedValueOnce(reply(subscription())).mockResolvedValueOnce(reply(invoice()));
        sendEmail.mockRejectedValueOnce(new Error('email unavailable'));
        expect((await handleWebhook(webhook({ meta: { event_name: 'subscription_created' }, data: { id: '123' } }), 'lemonsqueezy')).status).toBe(503);
    });
});

describe('checkout', () => {
    it('creates a fixed-price non-recurring pass', async () => {
        mockFetch.mockResolvedValueOnce(reply({ short_url: 'https://rzp.io/test' }));
        expect((await checkout(post({ email: 'buyer@example.com' }))).status).toBe(200);
        expect(JSON.parse(mockFetch.mock.calls[0][1].body)).toMatchObject({ amount: 79900, accept_partial: false, notes: { plan: 'pro-30-days' } });
    });
    it('rejects malformed email values', async () => {
        for (const email of [null, 42, 'invalid']) expect((await checkout(post({ email }))).status).toBe(400);
    });
    it('handles upstream timeout without hanging', async () => {
        mockFetch.mockRejectedValue(new Error('timeout')); expect((await checkout(post({ email: 'buyer@example.com' }))).status).toBe(502);
    });
});
