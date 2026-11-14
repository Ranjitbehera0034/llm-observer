import { createHash } from 'node:crypto';
import { customerStore } from '../../src/customerStore.js';
import { decodeLicenseKey } from '../../src/keyGenerator.js';
import { getEntitlement } from '../../src/entitlement.js';

async function handler(req: Request): Promise<Response> {
    const headers = { 'Cache-Control': 'no-store' };
    const reply = (data: unknown, status = 200) => Response.json(data, { status, headers });
    if (!['POST', 'DELETE'].includes(req.method)) return reply({ error: 'Method not allowed' }, 405);
    const raw = await req.text();
    if (raw.length > 4096) return reply({ error: 'Payload too large' }, 413);
    let body: any;
    try { body = JSON.parse(raw); } catch { return reply({ error: 'Invalid JSON' }, 400); }
    if (!body || typeof body.installation_id !== 'string' || typeof body.token !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(body.installation_id) || !/^[0-9a-f]{64}$/.test(body.token)) return reply({ error: 'Invalid installation credentials' }, 400);
    const tokenHash = createHash('sha256').update(body.token).digest('hex');
    try {
        if (req.method === 'DELETE') {
            const removed = await customerStore('rpc/forget_observer_installation', 'POST', { installation: body.installation_id, secret_hash: tokenHash });
            return reply({ removed: removed === true });
        }
        if (body.consent !== true || typeof body.version !== 'string' || !/^[0-9A-Za-z.+-]{1,40}$/.test(body.version)) return reply({ error: 'Explicit consent and app version required' }, 400);
        let customerRef: string | null = null;
        let plan = 'free';
        let validUntil: string | null = null;
        if (body.license_key) {
            if (typeof body.license_key !== 'string' || body.license_key.length > 1024) return reply({ error: 'Invalid license' }, 400);
            const ref = decodeLicenseKey(body.license_key);
            if (!ref) return reply({ error: 'Invalid license' }, 400);
            const entitlement = await getEntitlement(ref.provider, ref.id);
            if (entitlement.valid) {
                customerRef = `${ref.provider}:${ref.id}`;
                plan = entitlement.status === 'on_trial' ? 'trial' : 'pro';
                validUntil = entitlement.valid_until!;
            }
        }
        const accepted = await customerStore('rpc/report_observer_activity', 'POST', { installation: body.installation_id, secret_hash: tokenHash, app_version: body.version, customer_ref: customerRef, plan_name: plan, paid_until: validUntil });
        if (accepted !== true) return reply({ error: 'Installation credential mismatch' }, 403);
        return reply({ accepted: true });
    } catch { return reply({ error: 'Activity reporting temporarily unavailable' }, 503); }
}
export default { fetch: handler };
