#!/usr/bin/env node
/**
 * Post-deploy verifier for the LLM Observer license server (packages/license-server).
 *
 *   node scripts/verify-license-server.js <baseUrl> [--admin-token-env NAME]
 *
 *   <baseUrl>               e.g. https://api.llm-observer.com (a local `vercel dev` URL works too)
 *   --admin-token-env NAME  NAME of an environment variable that holds your ADMIN_TOKEN, so the
 *                           authenticated /admin/report check can run. Pass the NAME, never the token:
 *                             ADMIN_TOKEN=... node scripts/verify-license-server.js https://api.llm-observer.com --admin-token-env ADMIN_TOKEN
 *
 * Read-only and non-destructive: it sends requests that are meant to be rejected (garbage and unsigned
 * licence keys, an invalid telemetry ping, webhooks with a deliberately wrong signature, a request with no
 * admin token) plus GETs of /health, /admin.html and /admin/report. It creates no customer, activation or
 * install record, sends no email, and never prints the admin token or any customer data (only counts).
 *
 * Each check prints one PASS / FAIL / SKIP line. Exit status: 0 = no FAIL, 1 = at least one FAIL,
 * 2 = bad usage. A FAIL line says which Vercel environment variable or route to look at.
 *
 * What it cannot show: that a real payment produces a real email. After it is green, do one test-mode
 * purchase (docs/DEPLOY_LICENSE_SERVER.md, step "Test purchase").
 *
 * Needs Node 18+ (global fetch); no dependencies.
 */
'use strict';

const crypto = require('crypto');

const REQUEST_TIMEOUT_MS = 15000;
const DEV_SECRET = 'dev-secret-change-in-prod'; // the public fallback in packages/license-server/src/keyGenerator.ts

const USAGE = `Usage: node scripts/verify-license-server.js <baseUrl> [--admin-token-env NAME]

  <baseUrl>               license server URL, e.g. https://api.llm-observer.com
  --admin-token-env NAME  name of the environment variable holding your ADMIN_TOKEN
                          (the NAME, not the token itself). Without it the authenticated
                          /admin/report check is skipped.

Exit status: 0 all checks passed (or skipped), 1 at least one FAIL, 2 bad usage.`;

// What each /health flag means, so a FAIL points at the Vercel setting to fix.
const HEALTH_FLAGS = {
    hasResendKey: ['RESEND_API_KEY', 'from Resend > API Keys; without it no licence email can be sent'],
    hasLSSecret: ['LEMONSQUEEZY_WEBHOOK_SECRET', 'the Lemon Squeezy webhook signing secret; its webhooks are rejected without it'],
    hasRZPSecret: ['RAZORPAY_WEBHOOK_SECRET', 'the Razorpay webhook secret; its webhooks are rejected without it'],
    hasLicensePrivateKey: ['LICENSE_PRIVATE_KEY', 'from `npm run keygen`; no licence key can be signed or validated without it'],
    hasLegacySigningSecret: ['LICENSE_SIGNING_SECRET', 'any long random string; without it legacy PRO_ keys are checked against a public fallback secret'],
    hasStorage: ['KV_REST_API_URL and KV_REST_API_TOKEN', 'added by the Upstash for Redis integration; no customer, device or install records without them'],
    hasAdminToken: ['ADMIN_TOKEN', '16+ characters, e.g. `openssl rand -hex 24`; /admin/report is disabled without it'],
};

// ---------------------------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------------------------

function usageError(message) {
    if (message) console.error(`Error: ${message}\n`);
    console.error(USAGE);
    process.exit(2);
}

function parseArgs(argv) {
    let rawBase;
    let tokenEnvName;
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === '-h' || a === '--help') { console.log(USAGE); process.exit(0); }
        if (a === '--admin-token-env') {
            tokenEnvName = argv[++i];
            if (!tokenEnvName || tokenEnvName.startsWith('--')) usageError('--admin-token-env needs the NAME of an environment variable');
        } else if (a.startsWith('--admin-token-env=')) {
            tokenEnvName = a.slice('--admin-token-env='.length);
            if (!tokenEnvName) usageError('--admin-token-env needs the NAME of an environment variable');
        } else if (a.startsWith('-')) {
            usageError(`unknown option ${a.slice(0, 40)}`);
        } else if (rawBase === undefined) {
            rawBase = a;
        } else {
            usageError('only one <baseUrl> is accepted');
        }
    }
    if (!rawBase) usageError('<baseUrl> is required');
    let url;
    try { url = new URL(rawBase); } catch { usageError('<baseUrl> is not a valid URL (include http:// or https://)'); }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') usageError('<baseUrl> must start with http:// or https://');
    return { base: `${url.origin}${url.pathname}`.replace(/\/+$/, ''), tokenEnvName, isHttps: url.protocol === 'https:', hostname: url.hostname };
}

// ---------------------------------------------------------------------------------------------
// HTTP + reporting
// ---------------------------------------------------------------------------------------------

const results = { pass: 0, fail: 0, skip: 0 };
const clean = (s) => String(s).replace(/[\u0000-\u001f\u007f]+/g, ' ').slice(0, 220);

function report(kind, name, detail) {
    results[kind.toLowerCase()]++;
    console.log(`${kind.padEnd(4)}  ${name}${detail ? ` - ${clean(detail)}` : ''}`);
}
const pass = (name, detail) => report('PASS', name, detail);
const fail = (name, detail) => report('FAIL', name, detail);
const skip = (name, detail) => report('SKIP', name, detail);

class CheckFailure extends Error {}
const failWith = (message) => { throw new CheckFailure(message); };

/** Runs one check; a thrown CheckFailure (or any error) becomes a FAIL line. */
async function check(name, fn) {
    try {
        const detail = await fn();
        pass(name, typeof detail === 'string' ? detail : undefined);
    } catch (err) {
        fail(name, err instanceof CheckFailure ? err.message : `unexpected error: ${err && err.message}`);
    }
}

function makeClient(base) {
    return async function http(method, path, { body, headers } = {}) {
        let res;
        try {
            res = await fetch(`${base}${path}`, {
                method,
                body,
                headers,
                redirect: 'manual',
                signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
            });
        } catch (err) {
            const why = err && err.name === 'TimeoutError'
                ? `no response within ${REQUEST_TIMEOUT_MS / 1000}s (a function that never answers looks like this)`
                : `${(err && err.cause && err.cause.code) || (err && err.message) || 'request failed'}`;
            failWith(`could not get a response: ${why}`);
        }
        if (res.status >= 300 && res.status < 400) {
            failWith(`redirected (HTTP ${res.status}) to ${clean(res.headers.get('location') || '?')} - verify the final https URL directly`);
        }
        const text = await res.text();
        let json;
        try { json = JSON.parse(text); } catch { /* not JSON */ }
        return { status: res.status, headers: res.headers, text, json };
    };
}

const isJsonResponse = (res) => /application\/json/i.test(res.headers.get('content-type') || '') && res.json !== undefined;
const serverError = (res) => (res.json && typeof res.json.error === 'string' ? clean(res.json.error) : '');
const b64url = (buf) => Buffer.from(buf).toString('base64url');

// ---------------------------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------------------------

async function main() {
    const { base, tokenEnvName, isHttps, hostname } = parseArgs(process.argv.slice(2));
    const http = makeClient(base);

    console.log(`Verifying ${base}`);
    console.log('Read-only: nothing is created, no email is sent, the admin token is never printed.');
    if (!isHttps && !['localhost', '127.0.0.1', '[::1]'].includes(hostname)) {
        console.log('WARN  this URL is plain http; the real deployment must be served over https');
    }
    console.log('');

    // --- /health ---------------------------------------------------------------------------
    let health;
    await check('GET /health returns 200 JSON with status ok', async () => {
        const res = await http('GET', '/health');
        if (res.status !== 200) failWith(`HTTP ${res.status}${serverError(res) ? `: ${serverError(res)}` : ''}`);
        if (!isJsonResponse(res)) failWith('response is not JSON');
        if (res.json.status !== 'ok') failWith(`status is ${JSON.stringify(res.json.status)}, expected "ok"`);
        health = res.json;
        return `service ${clean(res.json.service || '?')} version ${clean(res.json.version || '?')}`;
    });
    if (health) {
        const flags = health.env && typeof health.env === 'object' ? health.env : null;
        if (!flags) {
            fail('GET /health reports configuration flags', 'no "env" object in the response');
        } else {
            const names = Object.keys(flags).filter((k) => k.startsWith('has'));
            if (names.length === 0) fail('GET /health reports configuration flags', 'no has* flags in the response');
            for (const flag of names) {
                if (flags[flag] === true) pass(`/health ${flag} is true`);
                else {
                    const [envName, why] = HEALTH_FLAGS[flag] || ['the matching environment variable', 'see docs/DEPLOY_LICENSE_SERVER.md'];
                    fail(`/health ${flag} is false`, `${envName} is not set in Vercel (${why}); add it and redeploy`);
                }
            }
        }
    }

    // --- /license/validate rejects what it must -------------------------------------------------
    await check('POST /license/validate rejects a garbage key with 400 JSON', async () => {
        const res = await http('POST', '/license/validate', {
            body: JSON.stringify({ license_key: 'verify-not-a-license-key', machine_id: '', version: 'verify' }),
            headers: { 'Content-Type': 'application/json' },
        });
        if (res.status !== 400) failWith(`expected HTTP 400, got ${res.status}${serverError(res) ? `: ${serverError(res)}` : ''}`);
        if (!isJsonResponse(res) || res.json.valid !== false) failWith('expected a JSON body with valid:false');
    });

    await check('POST /license/validate rejects a body that is not JSON with 400 JSON', async () => {
        const res = await http('POST', '/license/validate', { body: 'verify garbage {', headers: { 'Content-Type': 'application/json' } });
        if (res.status !== 400) failWith(`expected HTTP 400, got ${res.status}`);
        if (!isJsonResponse(res) || res.json.valid !== false) failWith('expected a JSON body with valid:false');
    });

    await check('POST /license/validate rejects an unsigned LLMO1-shaped key with 400', async () => {
        const payload = b64url(JSON.stringify({ v: 1, sub: `verify:${crypto.randomBytes(6).toString('hex')}`, plan: 'pro', iat: Math.floor(Date.now() / 1000) }));
        const key = `LLMO1.${payload}.${b64url(crypto.randomBytes(64))}`;
        const res = await http('POST', '/license/validate', { body: JSON.stringify({ license_key: key }), headers: { 'Content-Type': 'application/json' } });
        if (res.status === 200) failWith('an unsigned key was ACCEPTED - signature verification is not working; do not ship until fixed');
        if (res.status !== 400) failWith(`expected HTTP 400, got ${res.status}${serverError(res) ? `: ${serverError(res)}` : ''}`);
        if (!isJsonResponse(res) || res.json.valid !== false) failWith('expected a JSON body with valid:false');
    });

    await check('POST /license/validate rejects a legacy PRO_ key signed with the public dev secret', async () => {
        const sub = crypto.randomBytes(5).toString('hex').toUpperCase().slice(0, 8);
        const fp = crypto.createHmac('sha256', DEV_SECRET).update(`LS:${sub}`).digest('hex').substring(0, 8).toUpperCase();
        const res = await http('POST', '/license/validate', { body: JSON.stringify({ license_key: `PRO_LS_${fp}_${sub}` }), headers: { 'Content-Type': 'application/json' } });
        if (res.status === 200) {
            failWith('a key forged with the public dev secret was ACCEPTED - anyone can mint a legacy Pro key. Set LICENSE_SIGNING_SECRET (and leave ALLOW_LEGACY_DEV_SECRET unset) in Vercel, then redeploy');
        }
        if (res.status !== 400) failWith(`expected HTTP 400, got ${res.status}${serverError(res) ? `: ${serverError(res)}` : ''}`);
    });

    await check('OPTIONS /license/validate answers a CORS preflight', async () => {
        const res = await http('OPTIONS', '/license/validate', {
            headers: { Origin: 'http://localhost:3000', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type' },
        });
        if (res.status < 200 || res.status >= 300) failWith(`expected a 2xx status, got ${res.status}`);
        const origin = res.headers.get('access-control-allow-origin');
        if (origin !== '*' && origin !== 'http://localhost:3000') failWith(`Access-Control-Allow-Origin is ${JSON.stringify(origin)}`);
        if (!/\bPOST\b/i.test(res.headers.get('access-control-allow-methods') || '')) failWith('Access-Control-Allow-Methods does not include POST');
        if (!/content-type/i.test(res.headers.get('access-control-allow-headers') || '')) failWith('Access-Control-Allow-Headers does not include Content-Type');
    });

    // --- telemetry -------------------------------------------------------------------------------
    await check('POST /telemetry/ping rejects an invalid body with 400 (no install record created)', async () => {
        const res = await http('POST', '/telemetry/ping', {
            body: JSON.stringify({ install_id: 'verify-not-a-uuid', version: 'verify', os: 'verify', tier: 'free' }),
            headers: { 'Content-Type': 'application/json' },
        });
        if (res.status !== 400) failWith(`expected HTTP 400, got ${res.status}`);
    });

    // --- webhooks: wrong signature must be 401; 503 means the secret is not set -----------------
    const webhookCheck = (path, signatureHeader, envName, extraHeaders) =>
        check(`POST ${path} with a wrong signature returns 401`, async () => {
            const body = JSON.stringify({ verify: 'llm-observer deploy check - invalid signature on purpose' });
            const res = await http('POST', path, {
                body,
                headers: { 'Content-Type': 'application/json', [signatureHeader]: crypto.randomBytes(32).toString('hex'), ...extraHeaders },
            });
            if (res.status === 503) failWith(`HTTP 503 - ${envName} is not set (the endpoint rejects everything until it is); add it in Vercel and redeploy`);
            if (res.status === 200 || res.status === 204) failWith(`a request with a wrong signature was ACCEPTED (HTTP ${res.status}) - anyone could forge a payment`);
            if (res.status !== 401) failWith(`expected HTTP 401, got ${res.status}${serverError(res) ? `: ${serverError(res)}` : ''}`);
        });
    await webhookCheck('/webhook/lemonsqueezy', 'x-signature', 'LEMONSQUEEZY_WEBHOOK_SECRET', { 'x-event-name': 'subscription_created' });
    await webhookCheck('/webhook/razorpay', 'x-razorpay-signature', 'RAZORPAY_WEBHOOK_SECRET', {});

    // --- /admin/report ---------------------------------------------------------------------------
    await check('GET /admin/report without a token returns 401', async () => {
        const res = await http('GET', '/admin/report');
        if (res.status === 200) failWith('owner data was returned WITHOUT a token');
        if (res.status === 503) failWith(`HTTP 503${serverError(res) ? `: ${serverError(res)}` : ''} - set ADMIN_TOKEN (16+ characters) in Vercel and redeploy`);
        if (res.status !== 401) failWith(`expected HTTP 401, got ${res.status}`);
    });

    await check('GET /admin/report with a wrong token returns 401', async () => {
        const res = await http('GET', '/admin/report', { headers: { Authorization: `Bearer verify-wrong-${crypto.randomBytes(12).toString('hex')}` } });
        if (res.status === 200) failWith('owner data was returned for a made-up token');
        if (res.status === 503) failWith(`HTTP 503${serverError(res) ? `: ${serverError(res)}` : ''} - set ADMIN_TOKEN (16+ characters) in Vercel and redeploy`);
        if (res.status !== 401) failWith(`expected HTTP 401, got ${res.status}`);
    });

    if (tokenEnvName === undefined) {
        skip('GET /admin/report with the token returns 200 JSON', 'not run: pass --admin-token-env NAME (the name of an env var holding your ADMIN_TOKEN)');
    } else {
        // The message deliberately does not repeat NAME: if someone passed the token itself, it must not be echoed.
        const token = process.env[tokenEnvName];
        if (!token) {
            fail('GET /admin/report with the token returns 200 JSON', 'the environment variable named by --admin-token-env is empty or not set (pass its NAME, not the token)');
        } else {
            await check('GET /admin/report with the token returns 200 JSON', async () => {
                const res = await http('GET', '/admin/report', { headers: { Authorization: `Bearer ${token}` } });
                if (res.status === 401) failWith('HTTP 401 - the token was rejected; it must equal ADMIN_TOKEN in the Vercel project (check for a trailing newline or an old value)');
                if (res.status === 503) failWith(`HTTP 503${serverError(res) ? `: ${serverError(res)}` : ''}`);
                if (res.status !== 200) failWith(`expected HTTP 200, got ${res.status}`);
                if (!isJsonResponse(res)) failWith('response is not JSON');
                if (!Array.isArray(res.json.customers) || !res.json.installs || typeof res.json.installs !== 'object') failWith('JSON has no customers array / installs object');
                // Counts only: the report holds customer emails, which must not end up in a terminal log or CI output.
                return `${res.json.customers.length} customer(s), ${Number(res.json.installs.total_ever) || 0} install(s) ever`;
            });
        }
    }

    // --- static page -------------------------------------------------------------------------------
    await check('GET /admin.html returns 200 HTML', async () => {
        const res = await http('GET', '/admin.html');
        if (res.status !== 200) failWith(`HTTP ${res.status} - public/admin.html is not being served`);
        if (!/text\/html/i.test(res.headers.get('content-type') || '')) failWith(`content-type is ${JSON.stringify(res.headers.get('content-type'))}, expected text/html`);
        if (!/<html/i.test(res.text)) failWith('body does not look like an HTML page');
    });

    console.log('');
    console.log(`Summary: ${results.pass} passed, ${results.fail} failed, ${results.skip} skipped`);
    if (results.fail > 0) {
        console.log('Not ready: fix the FAIL lines above, redeploy, and run this again.');
    } else {
        console.log('These checks do not prove a payment reaches a customer: do one test-mode purchase next (docs/DEPLOY_LICENSE_SERVER.md).');
    }
    process.exit(results.fail > 0 ? 1 : 0);
}

main().catch((err) => {
    console.log(`FAIL  verifier crashed: ${clean(err && err.message)}`);
    console.log(`Summary: ${results.pass} passed, ${results.fail + 1} failed, ${results.skip} skipped`);
    process.exit(1);
});
