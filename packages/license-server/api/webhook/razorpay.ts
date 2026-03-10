import { generateLicenseKey, verifyWebhookSignature, getRawBody } from '../../src/keyGenerator.js';
import { sendLicenseEmail } from '../../src/emailService.js';

/**
 * POST /webhook/razorpay
 *
 * Vercel Serverless Function — Razorpay Payment Webhook
 *
 * Events handled:
 *   - subscription.activated → New subscriber activated
 *   - subscription.charged   → Renewal payment charged
 *   - payment.captured       → One-time payment captured
 *
 * Security: HMAC-SHA256 validated via X-Razorpay-Signature header.
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
    const signature = req.headers.get('x-razorpay-signature') || '';

    if (secret) {
        const isValid = verifyWebhookSignature({ rawBody, signature, secret });
        if (!isValid) {
            console.warn('[RZP WEBHOOK] Invalid signature. Possible spoofing attempt.');
            return jsonResponse({ error: 'Invalid signature' }, 401);
        }
    } else {
        console.warn('[RZP WEBHOOK] RAZORPAY_WEBHOOK_SECRET not set — skipping in dev mode.');
    }

    // ── Parse the Razorpay payload ────────────────────────────────────────────
    const body = JSON.parse(rawBody.toString('utf-8'));
    const event: string = body?.event ?? '';
    const payload = body?.payload ?? {};

    const ACTIVATABLE = ['subscription.activated', 'subscription.charged', 'payment.captured'];
    if (!ACTIVATABLE.includes(event)) {
        return jsonResponse({ received: true, action: 'ignored', event });
    }

    // ── Extract entity data (works for both subscription and payment events) ───
    const subscription = payload?.subscription?.entity ?? {};
    const payment = payload?.payment?.entity ?? {};

    // Prefer subscription data; fall back to payment entity for one-time payments
    const subscriptionId: string = subscription.id ?? payment.order_id ?? `rzp_${Date.now()}`;
    const customerId: string = subscription.customer_id ?? payment.customer_id ?? 'unknown';
    const amountCents: number = subscription.quantity
        ? (subscription.quantity * (payment.amount ?? 0))
        : (payment.amount ?? 0);
    const currency: string = (subscription.currency ?? payment.currency ?? 'INR').toUpperCase();

    // ── Get customer email ────────────────────────────────────────────────────
    // Razorpay doesn't always provide email in the webhook payload.
    // It's available in payment.email or from a supplementary API call.
    // We use what's available in the payload, and fall back to customer_id.
    const customerEmail: string =
        payment.email ??
        subscription.notify_info?.notify_email ??
        body?.meta?.notify_email ??
        '';

    if (!customerEmail) {
        // Without an email we can't deliver the key — log for manual follow-up
        console.error(`[RZP WEBHOOK] No email found for subscription ${subscriptionId}. Manual key delivery needed.`);
        // Still return 200 to stop Razorpay from retrying endlessly
        return jsonResponse({
            received: true,
            action: 'pending_manual_delivery',
            subscription_id: subscriptionId,
        });
    }

    // ── Generate signed license key ───────────────────────────────────────────
    const licenseKey = generateLicenseKey({
        provider: 'razorpay',
        subscriptionId,
        customerId,
    });

    console.log(`[RZP WEBHOOK] ✅ Key generated for ${subscriptionId}: ${licenseKey.substring(0, 16)}...`);

    // ── Send the license email ─────────────────────────────────────────────────
    try {
        await sendLicenseEmail({
            to: customerEmail,
            licenseKey,
            provider: 'razorpay',
            amount: (amountCents / 100).toFixed(2),
            currency,
        });
    } catch (err: any) {
        console.error('[RZP WEBHOOK] Email send failed:', err.message);
        // Return 500 so Razorpay retries
        return jsonResponse({ received: true, action: 'email_failed', error: err.message }, 500);
    }

    return jsonResponse({ received: true, activated: true, key: licenseKey.substring(0, 16) + '...' });
}

function jsonResponse(body: Record<string, unknown>, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' }
    });
}
