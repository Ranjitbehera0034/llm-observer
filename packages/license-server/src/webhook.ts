import { customerStore, customerStoreConfigured } from './customerStore.js';
import { generateLicenseKey, verifyWebhookSignature } from './keyGenerator.js';
import { getEntitlement } from './entitlement.js';
import { sendLicenseEmail } from './emailService.js';

export async function handleWebhook(req: Request, provider: 'lemonsqueezy' | 'razorpay'): Promise<Response> {
    const json = (body: unknown, status = 200) => Response.json(body, { status });
    if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
    const secret = process.env[provider === 'lemonsqueezy' ? 'LEMONSQUEEZY_WEBHOOK_SECRET' : 'RAZORPAY_WEBHOOK_SECRET'];
    if (!secret) return json({ error: 'Payments are not configured' }, 503);
    const rawBody = Buffer.from(await req.arrayBuffer());
    if (!verifyWebhookSignature({ rawBody, secret, signature: req.headers.get(provider === 'lemonsqueezy' ? 'x-signature' : 'x-razorpay-signature') || '' })) return json({ error: 'Invalid signature' }, 401);
    let body: any;
    try { body = JSON.parse(rawBody.toString()); } catch { return json({ error: 'Invalid JSON' }, 400); }
    const event = provider === 'lemonsqueezy' ? body.meta?.event_name : body.event;
    // Only delivery events are handled here. Current entitlement is always
    // checked against provider APIs, including refunds, expiry and cancellation.
    let id: string;
    if (provider === 'lemonsqueezy') {
        if (!['subscription_created', 'subscription_payment_success', 'subscription_updated', 'subscription_cancelled', 'subscription_expired', 'subscription_payment_failed', 'subscription_payment_refunded'].includes(event)) return json({ received: true, action: 'ignored' });
        id = String(event.startsWith('subscription_payment_') ? body.data?.attributes?.subscription_id ?? '' : body.data?.id);
    } else {
        if (event !== 'payment_link.paid') return json({ received: true, action: 'ignored' });
        id = body.payload?.payment_link?.entity?.id ?? '';
    }
    if (!id) return json({ error: 'Missing payment reference' }, 400);
    try {
        const entitlement = await getEntitlement(provider, id);
        if (customerStoreConfigured()) await customerStore('observer_customers?on_conflict=id', 'POST', { id: `${provider}:${id}`, ...(entitlement.email ? { email: entitlement.email } : {}), status: entitlement.valid ? entitlement.status ?? 'active' : 'inactive', valid_until: entitlement.valid_until ?? null, test_mode: entitlement.test_mode ?? body.meta?.test_mode === true, updated_at: new Date().toISOString() });
        if (!['subscription_created', 'subscription_payment_success', 'payment_link.paid'].includes(event)) return json({ received: true, action: 'status_updated' });
        if (!entitlement.valid) return json({ received: true, action: 'inactive' });
        if (!entitlement.email) return json({ error: 'Customer email unavailable; retry delivery' }, 503);
        const licenseKey = generateLicenseKey({ provider, subscriptionId: id, customerId: '' });
        await sendLicenseEmail({ to: entitlement.email, licenseKey, provider, amount: '', currency: '', validUntil: entitlement.valid_until!, portalUrl: entitlement.portal_url, idempotencyKey: `${provider}-${event}-${body.data?.id ?? id}` });
        return json({ received: true, delivered: true });
    } catch {
        return json({ error: 'License delivery unavailable; retry later' }, 503);
    }
}
