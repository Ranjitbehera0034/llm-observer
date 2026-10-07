import crypto from 'crypto';
import { ownerReport, isStoreConfigured } from '../../src/store.js';

/**
 * GET /admin/report  (Authorization: Bearer <ADMIN_TOKEN>)
 *
 * Owner-only view: every paying customer (email, provider, status, devices
 * activated) plus anonymous active-install counts from the opt-in ping.
 * Open /admin.html in a browser for a table view of the same data.
 */
export default async function handler(req: Request): Promise<Response> {
    const json = (body: unknown, status = 200) =>
        new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

    if (req.method !== 'GET') {
        return new Response('Method Not Allowed', { status: 405 });
    }

    const adminToken = process.env.ADMIN_TOKEN;
    if (!adminToken || adminToken.length < 16) {
        return json({ error: 'ADMIN_TOKEN is not configured (needs 16+ characters)' }, 503);
    }
    const given = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
    const a = crypto.createHash('sha256').update(given).digest();
    const b = crypto.createHash('sha256').update(adminToken).digest();
    if (!crypto.timingSafeEqual(a, b)) {
        return json({ error: 'Unauthorized' }, 401);
    }

    if (!isStoreConfigured()) {
        return json({ error: 'Storage is not configured — add the Upstash for Redis integration to this Vercel project.' }, 503);
    }

    try {
        return json(await ownerReport());
    } catch (err: any) {
        console.error('[ADMIN] report failed:', err.message);
        return json({ error: 'Failed to build report' }, 500);
    }
}
