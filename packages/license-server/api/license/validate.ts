import { customerStore, customerStoreConfigured } from '../../src/customerStore.js';
import { decodeLicenseKey } from '../../src/keyGenerator.js';
import { getEntitlement } from '../../src/entitlement.js';

async function handler(req: Request): Promise<Response> {
    const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers });
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
    let body: any;
    try { body = await req.json(); } catch { return json({ valid: false, error: 'Invalid JSON' }, 400); }
    if (typeof body?.license_key !== 'string') return json({ valid: false, error: 'License key required' }, 400);
    try {
        const reference = decodeLicenseKey(body.license_key);
        if (!reference) return json({ valid: false, error: 'Invalid license. Older keys need to be reissued by support.' }, 400);
        const entitlement = await getEntitlement(reference.provider, reference.id);
        if (customerStoreConfigured()) {
            try { await customerStore('observer_customers?on_conflict=id', 'POST', { id: `${reference.provider}:${reference.id}`, ...(entitlement.email ? { email: entitlement.email } : {}), status: entitlement.valid ? entitlement.status ?? 'active' : 'inactive', valid_until: entitlement.valid_until ?? null, test_mode: entitlement.test_mode ?? false, updated_at: new Date().toISOString() }); }
            catch { console.warn('Customer billing snapshot unavailable'); } // Reporting failure must not revoke paid access.
        }
        // Email is used for delivery only; it is not returned to the local app.
        const { email, ...publicEntitlement } = entitlement;
        return json({ ...publicEntitlement, tier: entitlement.valid ? 'pro' : 'free' });
    } catch {
        return json({ error: 'License verification temporarily unavailable. Please retry.' }, 503);
    }
}

export default { fetch: handler };
