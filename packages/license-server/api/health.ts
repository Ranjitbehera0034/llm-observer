/**
 * GET /health
 *
 * Health check for uptime monitoring (e.g. Vercel, Better Uptime).
 */
export default async function handler(req: Request): Promise<Response> {
    return new Response(JSON.stringify({
        status: 'ok',
        service: 'llm-observer-license-server',
        version: '1.0.0',
        timestamp: new Date().toISOString(),
        env: {
            hasResendKey: !!process.env.RESEND_API_KEY,
            hasLSSecret: !!process.env.LEMONSQUEEZY_WEBHOOK_SECRET,
            hasRZPSecret: !!process.env.RAZORPAY_WEBHOOK_SECRET,
            hasSigningSecret: !!process.env.LICENSE_SIGNING_SECRET,
        }
    }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
    });
}
