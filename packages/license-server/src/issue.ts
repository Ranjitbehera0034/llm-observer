import { signLicenseKey, isSigningConfigured, isValidSeats, type LicensePlan } from './signing.js';
import { sendLicenseEmail } from './emailService.js';
import { upsertCustomer, getCustomerStatus, isStoreConfigured, setCustomerStatus, type CustomerStatus } from './store.js';

export function jsonResponse(body: Record<string, unknown>, status = 200): Response {
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

/** Comma-separated env list -> trimmed, non-empty string ids. */
export function parseIdList(raw: string | undefined): string[] {
    return (raw ?? '').split(',').map(s => s.trim()).filter(Boolean);
}

/**
 * Decides the plan a purchase buys. 'team' only when the payment provider's
 * variant / plan id is listed in the matching env var; everything else is 'pro'.
 * `quantity` becomes the seat count for team purchases (ignored if not a sane integer).
 */
export function resolvePlan(provider: 'lemonsqueezy' | 'razorpay', productId: unknown, quantity: unknown): { plan: LicensePlan; seats?: number } {
    const listed = parseIdList(provider === 'lemonsqueezy' ? process.env.LEMONSQUEEZY_TEAM_VARIANT_IDS : process.env.RAZORPAY_TEAM_PLAN_IDS);
    if (productId === undefined || productId === null || !listed.includes(String(productId).trim())) return { plan: 'pro' };
    const seats = Number(quantity);
    return isValidSeats(seats) ? { plan: 'team', seats } : { plan: 'team' };
}

/**
 * Issues a signed license key for a new paying customer, records them, and
 * emails the key. Idempotent per `sub`: a webhook retry for a customer we
 * already emailed does not send a second key.
 */
export async function issueLicense(opts: {
    sub: string;
    provider: 'lemonsqueezy' | 'razorpay';
    email: string;
    amount: string;
    currency: string;
    event: string;
    plan?: LicensePlan;
    seats?: number;
}): Promise<Response> {
    const plan = opts.plan ?? 'pro';
    if (!isSigningConfigured()) {
        console.error('[ISSUE] LICENSE_PRIVATE_KEY not set — cannot issue keys. Returning 503 so the provider retries.');
        return jsonResponse({ received: true, action: 'error', reason: 'signing_not_configured' }, 503);
    }

    if (isStoreConfigured()) {
        const existing = await getCustomerStatus(opts.sub);
        if (existing === 'active') {
            return jsonResponse({ received: true, action: 'already_issued' });
        }
    }

    const licenseKey = signLicenseKey(opts.sub, undefined, { plan, seats: opts.seats });
    console.log(`[ISSUE] ✅ ${opts.provider} ${opts.sub} → ${licenseKey.substring(0, 16)}...`);

    try {
        await sendLicenseEmail({ to: opts.email, licenseKey, provider: opts.provider, amount: opts.amount, currency: opts.currency, plan, seats: opts.seats });
    } catch (err: any) {
        console.error('[ISSUE] Email failed:', err.message);
        // 500 so the payment provider retries; the customer isn't marked active yet
        return jsonResponse({ received: true, action: 'email_failed', error: err.message }, 500);
    }

    await upsertCustomer({
        sub: opts.sub, provider: opts.provider, email: opts.email, status: 'active', plan, seats: opts.seats,
        amount: opts.amount, currency: opts.currency, last_event: opts.event,
    }).catch(err => console.error('[ISSUE] Failed to record customer:', err.message));

    return jsonResponse({ received: true, activated: true });
}

export async function updateStatus(sub: string, status: CustomerStatus, event: string): Promise<Response> {
    await setCustomerStatus(sub, status, event).catch(err => console.error('[STATUS] Failed to update:', err.message));
    return jsonResponse({ received: true, action: 'status_updated', status });
}
