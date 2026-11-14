export interface Entitlement {
    valid: boolean;
    status?: string;
    test_mode?: boolean;
    valid_until?: string;
    email?: string;
    portal_url?: string;
    error?: string;
}
function required(name: string): string {
    const value = process.env[name];
    if (!value) throw new Error(`Missing ${name}`);
    return value;
}
async function providerGet(url: string, authorization: string): Promise<any> {
    const response = await fetch(url, { headers: { Authorization: authorization, Accept: url.startsWith('https://api.lemonsqueezy.com/') ? 'application/vnd.api+json' : 'application/json', 'Content-Type': url.startsWith('https://api.lemonsqueezy.com/') ? 'application/vnd.api+json' : 'application/json' }, signal: AbortSignal.timeout(8000) });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error('Payment provider unavailable');
    return response.json();
}
function invalid(error = 'Payment is inactive, refunded, or expired.'): Entitlement { return { valid: false, error }; }

// Providers are the durable source of truth. Webhook ordering cannot restore a
// cancelled/refunded entitlement; every validation reads the current record.
export async function getEntitlement(provider: 'lemonsqueezy' | 'razorpay', id: string): Promise<Entitlement> {
    if (provider === 'lemonsqueezy') {
        if (!/^\d+$/.test(id)) return invalid();
        const auth = `Bearer ${required('LEMONSQUEEZY_API_KEY')}`;
        const subscription = await providerGet(`https://api.lemonsqueezy.com/v1/subscriptions/${id}`, auth);
        const a = subscription?.data?.attributes;
        const variants = required('LEMONSQUEEZY_VARIANT_IDS').split(',').map(v => v.trim());
        if (!a || !variants.includes(String(a.variant_id)) || String(a.store_id) !== required('LEMONSQUEEZY_STORE_ID')) return invalid();
        if (a.test_mode && process.env.PAYMENTS_TEST_MODE !== 'true') return invalid();
        if (!['active', 'cancelled', 'on_trial'].includes(a.status)) return invalid();
        const until = a.status === 'cancelled' ? a.ends_at : a.status === 'on_trial' ? a.trial_ends_at : a.renews_at;
        if (!until || !Number.isFinite(Date.parse(until)) || Date.parse(until) <= Date.now()) return invalid();
        // Check latest invoice as a refunded charge can leave the subscription active.
        const invoices = await providerGet(`https://api.lemonsqueezy.com/v1/subscription-invoices?filter[subscription_id]=${id}&sort=-createdAt&page[size]=1`, auth);
        const invoice = invoices?.data?.[0]?.attributes;
        if (invoice && (invoice.refunded || (invoice.refunded_amount ?? 0) > 0 || invoice.status !== 'paid')) return invalid();
        if (!invoice && a.status !== 'on_trial') throw new Error('Paid invoice not available yet');
        return { valid: true, valid_until: new Date(until).toISOString(), status: a.status, test_mode: !!a.test_mode, email: a.user_email, portal_url: a.urls?.customer_portal };
    }
    if (!/^plink_[A-Za-z0-9]+$/.test(id)) return invalid();
    const auth = 'Basic ' + Buffer.from(`${required('RAZORPAY_KEY_ID')}:${required('RAZORPAY_KEY_SECRET')}`).toString('base64');
    const link = await providerGet(`https://api.razorpay.com/v1/payment_links/${id}`, auth);
    if (!link || link.status !== 'paid' || link.currency !== 'INR' || link.amount !== 79900 || link.amount_paid !== 79900 || link.accept_partial) return invalid();
    if (link.notes?.product !== 'llm-observer' || link.notes?.plan !== 'pro-30-days') return invalid();
    const paymentId = link.payments?.find((p: any) => p.status === 'captured')?.payment_id;
    if (!paymentId || !/^pay_[A-Za-z0-9]+$/.test(paymentId)) throw new Error('Payment capture not available yet');
    const p = await providerGet(`https://api.razorpay.com/v1/payments/${paymentId}`, auth);
    if (!p || p.status !== 'captured' || !p.captured || (p.amount_refunded ?? 0) > 0 || p.currency !== 'INR' || p.amount !== 79900) return invalid();
    const until = Number(p.created_at) * 1000 + 30 * 86400000;
    if (!Number.isFinite(until) || until <= Date.now()) return invalid();
    return { valid: true, valid_until: new Date(until).toISOString(), status: 'active', test_mode: required('RAZORPAY_KEY_ID').startsWith('rzp_test_'), email: link.customer?.email || p.email };
}
