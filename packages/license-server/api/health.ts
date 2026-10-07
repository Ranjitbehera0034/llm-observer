/**
 * GET /health
 *
 * Health check for uptime monitoring (e.g. Vercel, Better Uptime).
 */
export default async function handler(req: Request): Promise<Response> {
    return new Response(JSON.stringify({
        status: 'ok',
        service: 'llm-observer-license-server',
        version: '2.0.2',
        timestamp: new Date().toISOString(),
        env: {
            hasResendKey: !!process.env.RESEND_API_KEY,
            hasLSSecret: !!(process.env.LEMONSQUEEZY_WEBHOOK_SECRET || process.env.LEMONSQUEEZY_SIGNING_SECRET),
            hasRZPSecret: !!process.env.RAZORPAY_WEBHOOK_SECRET,
            hasLicensePrivateKey: !!process.env.LICENSE_PRIVATE_KEY,
            hasLegacySigningSecret: !!(process.env.LICENSE_SIGNING_SECRET || process.env.LICENSE_SECRET),
            hasStorage: !!(process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL),
            hasAdminToken: !!process.env.ADMIN_TOKEN,
        }
    }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
    });
}
