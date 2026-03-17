import { generateLicenseKey, verifyWebhookSignature, getRawBody } from '../../src/keyGenerator.js';
import { sendLicenseEmail } from '../../src/emailService.js';

/**
 * POST /webhook/lemonsqueezy
 *
 * Vercel Serverless Function — Lemon Squeezy Payment Webhook
 *
 * Events handled:
 *   - subscription_created  → New monthly/yearly subscriber
 *   - subscription_payment_success → Renewal payment
 *   - order_created → One-time purchase
 *
 * All other events return 200 with action: 'ignored' to prevent retries.
 *
 * Security: HMAC-SHA256 validated via X-Signature header.
 * The raw body MUST be read before JSON parsing for HMAC to work.
 */
export default async function handler(req: Request): Promise<Response> {
    if (req.method !== 'POST') {
        return new Response('Method Not Allowed', { status: 405 });
    }

    // ── Read raw body BEFORE any parsing ─────────────────────────────────────
    const rawBody = await getRawBody(req);

    // ── Verify HMAC Signature ─────────────────────────────────────────────────
    const secret = process.env.LEMONSQUEEZY_WEBHOOK_SECRET;
    const signature = req.headers.get('x-signature') || '';

    if (secret) {
        const isValid = verifyWebhookSignature({ rawBody, signature, secret });
        if (!isValid) {
            console.warn('[LS WEBHOOK] Invalid signature. Possible spoofing attempt.');
            return new Response(JSON.stringify({ error: 'Invalid signature' }), {
                status: 401,
                headers: { 'Content-Type': 'application/json' }
            });
        }
    } else {
        console.warn('[LS WEBHOOK] LEMONSQUEEZY_WEBHOOK_SECRET not set — skipping in dev mode.');
    }

    // ── Parse event ───────────────────────────────────────────────────────────
    const event = req.headers.get('x-event-name') || '';
    const body = JSON.parse(rawBody.toString('utf-8'));

    // Events that should trigger license activation
    const ACTIVATABLE = ['subscription_created', 'subscription_payment_success', 'order_created'];
    if (!ACTIVATABLE.includes(event)) {
        return jsonResponse({ received: true, action: 'ignored', event });
    }

    // ── Extract customer details from the Lemon Squeezy payload ───────────────
    // Lemon Squeezy payload structure varies slightly by event;
    // we handle both subscription and order shapes.
    const attrs = body?.data?.attributes ?? {};
    const meta = body?.meta ?? {};

    const subscriptionId = String(body?.data?.id ?? 'unknown');
    const customerId = String(
        attrs.customer_id ??
        attrs.user_email ??
        meta.custom_data?.user_email ??
        'unknown'
    );
    const customerEmail = attrs.user_email ?? meta.custom_data?.user_email ?? '';
    const amountCents = attrs.total ?? attrs.first_subscription_item?.price ?? 0;
    const currency: string = (attrs.currency ?? 'USD').toUpperCase();

    if (!customerEmail) {
        console.error('[LS WEBHOOK] No customer email found in payload:', JSON.stringify(body).substring(0, 200));
        return jsonResponse({ received: true, action: 'error', reason: 'no_email' }, 400);
    }

    // ── Generate license key ──────────────────────────────────────────────────
    const licenseKey = generateLicenseKey({
        provider: 'lemonsqueezy',
        subscriptionId,
        customerId,
    });

    console.log(`[LS WEBHOOK] ✅ Generating key for subscription ${subscriptionId} → ${licenseKey.substring(0, 16)}...`);

    // ── Send license email ────────────────────────────────────────────────────
    try {
        await sendLicenseEmail({
            to: customerEmail,
            licenseKey,
            provider: 'lemonsqueezy',
            amount: (amountCents / 100).toFixed(2),
            currency,
        });
    } catch (err: any) {
        console.error('[LS WEBHOOK] Email failed:', err.message);
        // Return 500 so Lemon Squeezy retries the webhook
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
