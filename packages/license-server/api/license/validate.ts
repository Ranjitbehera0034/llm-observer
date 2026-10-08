import crypto from 'crypto';
import { verifyLicenseKey } from '../../src/keyGenerator.js';
import { verifySignedKey, configuredPublicKeyPem, SIGNED_KEY_PREFIX } from '../../src/signing.js';
import { getCustomerStatus, recordActivation } from '../../src/store.js';

/**
 * POST /license/validate
 *
 * Called by the local LLM Observer app when a user activates a key, and about
 * once a day afterwards to pick up cancellations. Records which machine
 * activated which license (for the owner's /admin view).
 *
 * Body: { license_key: string, machine_id?: string, version?: string }
 *
 * Signed LLMO1 keys are verified against LICENSE_PRIVATE_KEY's public half;
 * legacy PRO_ keys by re-deriving their HMAC fingerprint.
 *
 * Response:
 *   { valid: true, tier: 'pro', plan: 'pro' | 'team', seats?, status: 'active' | 'cancelled' | 'unknown' }
 *   { valid: false, revoked: true, error }   — subscription expired: the app drops to Free
 *   { valid: false, error }                  — not a genuine key
 */
export default async function handler(req: Request): Promise<Response> {
    // Allow CORS from anywhere (LLM Observer runs on localhost, no fixed origin)
    const corsHeaders = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Content-Type': 'application/json',
    };
    const reply = (body: Record<string, unknown>, status = 200) =>
        new Response(JSON.stringify(body), { status, headers: corsHeaders });

    if (req.method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: corsHeaders });
    }
    if (req.method !== 'POST') {
        return new Response('Method Not Allowed', { status: 405 });
    }

    let body: Record<string, unknown>;
    try {
        body = await req.json();
    } catch {
        return reply({ valid: false, error: 'Invalid JSON' }, 400);
    }

    const key = typeof body.license_key === 'string' ? body.license_key.trim() : '';
    if (!key) {
        return reply({ valid: false, error: 'license_key is required' }, 400);
    }
    const machineId = typeof body.machine_id === 'string' ? body.machine_id.slice(0, 128) : '';
    const version = typeof body.version === 'string' ? body.version.slice(0, 32) : 'unknown';

    let sub: string | null = null;
    let plan: 'pro' | 'team' = 'pro';
    let seats: number | undefined;
    if (key.startsWith(`${SIGNED_KEY_PREFIX}.`)) {
        const pub = configuredPublicKeyPem();
        const payload = pub ? verifySignedKey(key, pub) : null;
        if (payload) { sub = payload.sub; plan = payload.plan; seats = payload.seats; }
    } else if (key.startsWith('PRO_') && verifyLicenseKey(key)) {
        // Legacy key: PRO_{LS|RZP}_{FP}_{SUBID} — keyed by a hash so it can't be
        // reconstructed from the admin view
        sub = `legacy:${crypto.createHash('sha256').update(key).digest('hex').slice(0, 16)}`;
    }

    if (!sub) {
        return reply({ valid: false, error: 'Invalid or forged license key. Purchase at https://www.llm-observer.com/#pricing' }, 400);
    }

    const status = await getCustomerStatus(sub).catch(() => null);
    if (status === 'expired') {
        return reply({ valid: false, revoked: true, error: 'This subscription has ended. Renew at https://www.llm-observer.com/#pricing' }, 403);
    }

    if (machineId) {
        await recordActivation(sub, machineId, version).catch(err => console.error('[VALIDATE] activation not recorded:', err.message));
    }

    // tier stays 'pro' for both plans (Pro limits apply to Team); `plan` and `seats` say which was bought.
    return reply({ valid: true, tier: 'pro', plan, ...(seats !== undefined ? { seats } : {}), status: status ?? 'unknown', message: 'License verified. Enjoy Pro features!' });
}
