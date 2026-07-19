/**
 * POST /checkout/razorpay
 *
 * Creates a Razorpay Payment Link for the Pro plan and returns its URL.
 * Called by the landing-page "Pay via UPI / Razorpay" button; the customer is
 * redirected to Razorpay's hosted checkout. On successful payment, Razorpay
 * fires the webhook at /webhook/razorpay which issues and emails the license.
 *
 * Body: { email: string }
 * Response: { url: string } | { error: string }
 *
 * Env:
 *   RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET  — API credentials (server-side only)
 *   RAZORPAY_PRO_AMOUNT_PAISE              — price in paise (default 159900 = ₹1,599)
 *   CHECKOUT_CALLBACK_URL                  — where Razorpay redirects after payment
 *
 * Razorpay Docs: https://razorpay.com/docs/payment-links/
 */
export default async function handler(req: Request): Promise<Response> {
    const corsHeaders = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Content-Type': 'application/json',
    };

    if (req.method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: corsHeaders });
    }
    if (req.method !== 'POST') {
        return new Response('Method Not Allowed', { status: 405 });
    }

    const keyId = process.env.RAZORPAY_KEY_ID;
    const keySecret = process.env.RAZORPAY_KEY_SECRET;
    if (!keyId || !keySecret) {
        return new Response(JSON.stringify({ error: 'Payments are not configured on this deployment.' }), {
            status: 503, headers: corsHeaders
        });
    }

    let body: Record<string, string>;
    try {
        body = await req.json();
    } catch {
        return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers: corsHeaders });
    }

    const email = (body.email || '').trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return new Response(JSON.stringify({ error: 'A valid email is required — your license key is delivered there.' }), {
            status: 400, headers: corsHeaders
        });
    }

    const amountPaise = parseInt(process.env.RAZORPAY_PRO_AMOUNT_PAISE || '159900', 10);

    const rzpRes = await fetch('https://api.razorpay.com/v1/payment_links', {
        method: 'POST',
        headers: {
            'Authorization': 'Basic ' + Buffer.from(`${keyId}:${keySecret}`).toString('base64'),
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            amount: amountPaise,
            currency: 'INR',
            description: 'LLM Observer Pro — monthly license',
            customer: { email },
            notify: { email: true },
            notes: { plan: 'pro-monthly', product: 'llm-observer' },
            callback_url: process.env.CHECKOUT_CALLBACK_URL || 'https://www.llm-observer.com/thanks',
            callback_method: 'get',
        }),
    });

    if (!rzpRes.ok) {
        const detail = await rzpRes.text();
        console.error('[CHECKOUT] Razorpay payment link creation failed:', rzpRes.status, detail);
        return new Response(JSON.stringify({ error: 'Could not start checkout. Please try again shortly.' }), {
            status: 502, headers: corsHeaders
        });
    }

    const link = await rzpRes.json() as { short_url?: string; id?: string };
    if (!link.short_url) {
        console.error('[CHECKOUT] Unexpected Razorpay response:', JSON.stringify(link).slice(0, 300));
        return new Response(JSON.stringify({ error: 'Could not start checkout. Please try again shortly.' }), {
            status: 502, headers: corsHeaders
        });
    }

    return new Response(JSON.stringify({ url: link.short_url }), { status: 200, headers: corsHeaders });
}
