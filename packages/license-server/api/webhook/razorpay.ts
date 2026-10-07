import { verifyWebhookSignature, getRawBody } from '../../src/keyGenerator.js';
import { issueLicense, updateStatus, jsonResponse } from '../../src/issue.js';

/**
 * POST /webhook/razorpay
 *
 * Vercel Serverless Function — Razorpay Payment Webhook
 *
 * Events handled:
 *   - subscription.activated                       → issue + email a signed license key
 *   - payment.captured (one-time, e.g. Payment Link) → issue + email a signed license key
 *   - subscription.charged / .resumed              → mark customer active
 *   - subscription.cancelled / .halted / .completed → mark expired (the app drops to Free on its next check)
 *
 * payment.captured for a subscription's own recurring charge is skipped (it
 * carries an invoice_id) so subscribers don't get a new key every month.
 *
 * Security: HMAC-SHA256 validated via X-Razorpay-Signature header. Fails
 * closed — with no secret configured every request is rejected.
 *
 * Razorpay Docs: https://razorpay.com/docs/webhooks/
 */
export default async function handler(req: Request): Promise<Response> {
    if (req.method !== 'POST') {
        return new Response('Method Not Allowed', { status: 405 });
    }

    // ── Read raw body BEFORE JSON.parse ───────────────────────────────────────
    const rawBody = await getRawBody(req);

    // ── Verify Razorpay HMAC-SHA256 Signature ─────────────────────────────────
    const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
    if (!secret) {
        console.error('[RZP WEBHOOK] RAZORPAY_WEBHOOK_SECRET not configured — rejecting.');
        return jsonResponse({ error: 'Webhook secret not configured' }, 503);
    }
    const signature = req.headers.get('x-razorpay-signature') || '';
    if (!verifyWebhookSignature({ rawBody, signature, secret })) {
        console.warn('[RZP WEBHOOK] Invalid signature. Possible spoofing attempt.');
        return jsonResponse({ error: 'Invalid signature' }, 401);
    }

    // ── Parse the Razorpay payload ────────────────────────────────────────────
    const body = JSON.parse(rawBody.toString('utf-8'));
    const event: string = body?.event ?? '';
    const payload = body?.payload ?? {};
    const subscription = payload?.subscription?.entity ?? {};
    const payment = payload?.payment?.entity ?? {};

    // Razorpay doesn't always include an email; use what the payload has.
    const email: string =
        payment.email ??
        subscription.notify_info?.notify_email ??
        body?.meta?.notify_email ??
        '';
    const currency: string = String(subscription.currency ?? payment.currency ?? 'INR').toUpperCase();
    const amount = ((payment.amount ?? 0) / 100).toFixed(2);

    const issue = (sub: string) => {
        if (!email) {
            // Without an email we can't deliver the key — log for manual follow-up.
            // 200 stops Razorpay from retrying endlessly.
            console.error(`[RZP WEBHOOK] No email found for ${sub}. Manual key delivery needed.`);
            return jsonResponse({ received: true, action: 'pending_manual_delivery', sub });
        }
        return issueLicense({ sub, provider: 'razorpay', email, amount, currency, event });
    };

    switch (event) {
        case 'subscription.activated':
            return issue(`rzp:${subscription.id}`);
        case 'payment.captured':
            if (payment.invoice_id || payload?.subscription) {
                return jsonResponse({ received: true, action: 'ignored', reason: 'subscription_charge' });
            }
            return issue(`rzp:${payment.order_id ?? payment.id}`);
        case 'subscription.charged':
        case 'subscription.resumed':
            return updateStatus(`rzp:${subscription.id}`, 'active', event);
        case 'subscription.cancelled':
        case 'subscription.halted':
        case 'subscription.completed':
            return updateStatus(`rzp:${subscription.id}`, 'expired', event);
        default:
            return jsonResponse({ received: true, action: 'ignored', event });
    }
}
