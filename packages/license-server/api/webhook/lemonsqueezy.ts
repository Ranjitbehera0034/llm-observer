import { verifyWebhookSignature, getRawBody } from '../../src/keyGenerator.js';
import { issueLicense, updateStatus, jsonResponse } from '../../src/issue.js';

/**
 * POST /webhook/lemonsqueezy
 *
 * Vercel Serverless Function — Lemon Squeezy Payment Webhook
 *
 * Events handled:
 *   - subscription_created                     → issue + email a signed license key
 *   - subscription_payment_success / _resumed  → mark customer active
 *   - subscription_cancelled                   → mark cancelled (keeps access until the period ends)
 *   - subscription_expired                     → mark expired (the app drops to Free on its next check)
 *
 * order_created is ignored: every subscription purchase also fires it, and
 * handling both sent customers two different keys.
 *
 * Security: HMAC-SHA256 validated via X-Signature header. Fails closed — with
 * no secret configured every request is rejected, so nobody can forge a
 * "payment" to get a key.
 */
export default async function handler(req: Request): Promise<Response> {
    if (req.method !== 'POST') {
        return new Response('Method Not Allowed', { status: 405 });
    }

    // ── Read raw body BEFORE any parsing ─────────────────────────────────────
    const rawBody = await getRawBody(req);

    // ── Verify HMAC Signature ─────────────────────────────────────────────────
    // LEMONSQUEEZY_SIGNING_SECRET is the name .env.example used; accept both.
    const secret = process.env.LEMONSQUEEZY_WEBHOOK_SECRET || process.env.LEMONSQUEEZY_SIGNING_SECRET;
    if (!secret) {
        console.error('[LS WEBHOOK] No webhook secret configured — rejecting.');
        return jsonResponse({ error: 'Webhook secret not configured' }, 503);
    }
    const signature = req.headers.get('x-signature') || '';
    if (!verifyWebhookSignature({ rawBody, signature, secret })) {
        console.warn('[LS WEBHOOK] Invalid signature. Possible spoofing attempt.');
        return jsonResponse({ error: 'Invalid signature' }, 401);
    }

    // ── Parse event ───────────────────────────────────────────────────────────
    const event = req.headers.get('x-event-name') || '';
    const body = JSON.parse(rawBody.toString('utf-8'));
    const attrs = body?.data?.attributes ?? {};
    const meta = body?.meta ?? {};

    // subscription_* events carry the subscription as data; invoice events
    // (subscription_payment_success) reference it via attributes.subscription_id.
    const subscriptionId = String(attrs.subscription_id ?? body?.data?.id ?? 'unknown');
    const sub = `ls:${subscriptionId}`;

    switch (event) {
        case 'subscription_created': {
            const email: string = attrs.user_email ?? meta.custom_data?.user_email ?? '';
            if (!email) {
                console.error('[LS WEBHOOK] No customer email found in payload:', JSON.stringify(body).substring(0, 200));
                return jsonResponse({ received: true, action: 'error', reason: 'no_email' }, 400);
            }
            const amountCents = attrs.total ?? attrs.first_subscription_item?.price ?? 0;
            return issueLicense({
                sub, provider: 'lemonsqueezy', email,
                amount: (amountCents / 100).toFixed(2),
                currency: String(attrs.currency ?? 'USD').toUpperCase(),
                event,
            });
        }
        case 'subscription_payment_success':
        case 'subscription_resumed':
        case 'subscription_unpaused':
            return updateStatus(sub, 'active', event);
        case 'subscription_cancelled':
            return updateStatus(sub, 'cancelled', event);
        case 'subscription_expired':
            return updateStatus(sub, 'expired', event);
        default:
            return jsonResponse({ received: true, action: 'ignored', event });
    }
}
