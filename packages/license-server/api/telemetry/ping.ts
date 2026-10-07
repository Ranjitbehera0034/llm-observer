import { recordPing } from '../../src/store.js';

/**
 * POST /telemetry/ping
 *
 * Anonymous, opt-in usage ping from the local app — sent at most once a day,
 * and only when the user turned on "Share anonymous usage stats" in Settings
 * (off by default). Lets the owner see roughly how many installs are active.
 *
 * Body: { install_id: uuid, version: string, os: string, tier: 'free' | 'pro' }
 *
 * install_id is a random UUID generated on the user's machine — not derived
 * from any hardware or account identifier. No IP address, spend, prompt, file
 * or project data is received or stored.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHORT = /^[\w.+-]{1,32}$/;

export default async function handler(req: Request): Promise<Response> {
    if (req.method !== 'POST') {
        return new Response('Method Not Allowed', { status: 405 });
    }
    let body: Record<string, unknown>;
    try {
        body = await req.json();
    } catch {
        return new Response(null, { status: 400 });
    }
    const { install_id, version, os, tier } = body;
    if (typeof install_id !== 'string' || !UUID.test(install_id)
        || typeof version !== 'string' || !SHORT.test(version)
        || typeof os !== 'string' || !SHORT.test(os)
        || (tier !== 'free' && tier !== 'pro')) {
        return new Response(null, { status: 400 });
    }
    try {
        await recordPing({ install_id: install_id.toLowerCase(), version, os, tier });
    } catch (err: any) {
        console.error('[PING] not recorded:', err.message);
    }
    return new Response(null, { status: 204 });
}
