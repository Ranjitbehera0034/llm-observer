import { timingSafeEqual } from 'node:crypto';
import { customerStore } from '../../src/customerStore.js';
async function handler(req: Request): Promise<Response> {
    const headers = { 'Cache-Control': 'no-store' };
    const reply = (body: unknown, status = 200) => Response.json(body, { status, headers });
    if (req.method !== 'GET') return reply({ error: 'Method not allowed' }, 405);
    const secret = process.env.CUSTOMER_ADMIN_TOKEN;
    if (!secret || secret.length < 32) return reply({ error: 'Customer admin is not configured' }, 503);
    const supplied = Buffer.from(req.headers.get('authorization') || '');
    const expected = Buffer.from(`Bearer ${secret}`);
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return reply({ error: 'Unauthorized' }, 401);
    const offset = Number(new URL(req.url).searchParams.get('offset') || '0');
    if (!Number.isSafeInteger(offset) || offset < 0) return reply({ error: 'Invalid offset' }, 400);
    try {
        const [customers, installations] = await Promise.all([
            customerStore(`observer_customers?select=*&order=updated_at.desc&limit=100&offset=${offset}`),
            customerStore(`observer_installations?select=id,customer_ref,plan,valid_until,version,first_seen,last_seen&order=last_seen.desc&limit=100&offset=${offset}`)
        ]);
        return reply({ customers, installations, next_offset: (customers?.length === 100 || installations?.length === 100) ? offset + 100 : null, coverage: 'Installations are opt-in and self-reported. No heartbeat means unknown activity, not inactivity. Billing status is a dated snapshot.' });
    } catch { return reply({ error: 'Customer reporting unavailable' }, 503); }
}
export default { fetch: handler };
