/// <reference types="vite/client" />
/**
 * License server <-> app, over real HTTP.
 *
 * What is real here:
 *  - the license server's request handlers (packages/license-server/api/**), unmodified, including
 *    src/store.ts (talks Upstash REST over fetch) and src/emailService.ts (the `resend` package);
 *  - the routing: the adapter below resolves requests ONLY through packages/license-server/vercel.json,
 *    so a missing or wrong route fails a test;
 *  - the app side: the compiled bundle packages/proxy/dist/licenseE2E.js (activateLicense,
 *    getLicenseInfo, revalidateLicense, telemetry) with a real SQLite database in a temp dir.
 *
 * What is faked:
 *  - Upstash Redis: an in-memory implementation of the REST /pipeline commands the store uses.
 *  - Resend: a local HTTP server reached through the resend package's own RESEND_BASE_URL override;
 *    nothing is ever sent to a real mailbox. Captured emails are what the customer would receive.
 *  - The Vercel platform itself. The adapter assumes the Web Request/Response contract the handlers
 *    are written for; it does NOT prove Vercel's Node runtime invokes them that way. Only
 *    scripts/verify-license-server.js against a real deployment can show that.
 *  - The signing keypair is generated per run; the app is pointed at its public half through the
 *    app's test hook (the production public key is embedded in the app and its private half is not here).
 *
 * Needs `npm run build:ci` (or `npm run build --workspace=@llm-observer/proxy`) first, like the rest of
 * tests/integration that runs against dist/.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { generateLicenseKey } from '../../packages/license-server/src/keyGenerator';

const execFileAsync = promisify(execFile);
const ROOT = path.resolve(__dirname, '../..');
const LS_DIR = path.join(ROOT, 'packages/license-server');
const APP_DIST = path.join(ROOT, 'packages/proxy/dist/licenseE2E.js');
const VERIFIER = path.join(ROOT, 'scripts/verify-license-server.js');
const APP_VERSION: string = JSON.parse(fs.readFileSync(path.join(ROOT, 'packages/proxy/package.json'), 'utf8')).version;

// ─────────────────────────────────────────────────────────────────────────────
// Helpers: ports, env
// ─────────────────────────────────────────────────────────────────────────────

/** Listen on the first free port in 16050-16099 on loopback. */
async function listenInRange(server: http.Server): Promise<number> {
    for (let port = 16050; port <= 16099; port++) {
        const ok = await new Promise<boolean>(resolve => {
            const onError = () => resolve(false);
            server.once('error', onError);
            server.listen(port, '127.0.0.1', () => { server.off('error', onError); resolve(true); });
        });
        if (ok) return port;
    }
    throw new Error('no free port in 16050-16099');
}

const closeServer = (s: http.Server) => new Promise<void>(r => { s.closeAllConnections?.(); s.close(() => r()); });

/** A loopback port in range that nothing is listening on (for "network failure" cases). */
async function deadPort(): Promise<number> {
    const s = http.createServer();
    const port = await listenInRange(s);
    await closeServer(s);
    return port;
}

async function withEnv<T>(overrides: Record<string, string | undefined>, fn: () => Promise<T>): Promise<T> {
    const saved: Record<string, string | undefined> = {};
    for (const [k, v] of Object.entries(overrides)) {
        saved[k] = process.env[k];
        if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
    try { return await fn(); } finally {
        for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    }
}

const readBody = (req: http.IncomingMessage) => new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
});

// ─────────────────────────────────────────────────────────────────────────────
// Fake Upstash REST (in-memory) on a local port
// ─────────────────────────────────────────────────────────────────────────────

const UPSTASH_TOKEN = 'upstash-test-token';

function createFakeUpstash() {
    let h = new Map<string, Map<string, string>>();
    let s = new Map<string, Set<string>>();
    let z = new Map<string, Map<string, number>>();
    const hash = (k: string) => h.get(k) ?? h.set(k, new Map()).get(k)!;
    const num = (v: string) => (v === '+inf' ? Infinity : Number(v));
    const run = ([cmd, key, ...a]: string[]): unknown => {
        switch (cmd) {
            case 'HSET': for (let i = 0; i < a.length; i += 2) hash(key).set(a[i], a[i + 1]); return 1;
            case 'HSETNX': if (hash(key).has(a[0])) return 0; hash(key).set(a[0], a[1]); return 1;
            case 'HGET': return h.get(key)?.get(a[0]) ?? null;
            case 'HGETALL': return [...(h.get(key) ?? new Map())].flat();
            case 'EXISTS': return h.has(key) ? 1 : 0;
            case 'SADD': (s.get(key) ?? s.set(key, new Set()).get(key)!).add(a[0]); return 1;
            case 'SMEMBERS': return [...(s.get(key) ?? [])];
            case 'ZADD': (z.get(key) ?? z.set(key, new Map()).get(key)!).set(a[1], Number(a[0])); return 1;
            case 'ZCARD': return z.get(key)?.size ?? 0;
            case 'ZCOUNT': return [...(z.get(key) ?? new Map()).values()].filter(v => v >= num(a[0]) && v <= num(a[1])).length;
            case 'ZRANGEBYSCORE': return [...(z.get(key) ?? new Map())].filter(([, v]) => v >= num(a[0]) && v <= num(a[1])).map(([m]) => m);
            default: throw new Error(`fake redis: ${cmd} not implemented`);
        }
    };
    let writes = 0;
    const server = http.createServer(async (req, res) => {
        const body = await readBody(req);
        if (req.headers.authorization !== `Bearer ${UPSTASH_TOKEN}`) { res.writeHead(401).end('{"error":"unauthorized"}'); return; }
        if (req.method !== 'POST' || req.url !== '/pipeline') { res.writeHead(404).end('{"error":"not found"}'); return; }
        const cmds = JSON.parse(body.toString()) as string[][];
        const out = cmds.map(c => {
            try {
                if (/^(HSET|HSETNX|SADD|ZADD)$/.test(c[0])) writes++;
                return { result: run(c) };
            } catch (e: any) { return { error: e.message }; }
        });
        res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(out));
    });
    return {
        server,
        reset() { h = new Map(); s = new Map(); z = new Map(); writes = 0; },
        /** Deterministic dump of everything stored, to prove a run changed nothing. */
        dump: () => JSON.stringify({
            h: [...h].map(([k, m]) => [k, [...m]]).sort(), s: [...s].map(([k, m]) => [k, [...m]]).sort(), z: [...z].map(([k, m]) => [k, [...m]]).sort(),
        }),
        writeCount: () => writes,
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// Fake Resend: captures what would have been emailed
// ─────────────────────────────────────────────────────────────────────────────

const RESEND_KEY = 're_test_not_a_real_key';
interface SentEmail { from: string; to: string[]; subject: string; html: string }

function createFakeResend() {
    const sent: SentEmail[] = [];
    let failNext = 0;
    const server = http.createServer(async (req, res) => {
        const body = await readBody(req);
        if (req.method !== 'POST' || req.url !== '/emails') { res.writeHead(404).end('{}'); return; }
        if (req.headers.authorization !== `Bearer ${RESEND_KEY}`) {
            res.writeHead(401, { 'Content-Type': 'application/json' }).end(JSON.stringify({ name: 'missing_api_key', message: 'bad key', statusCode: 401 }));
            return;
        }
        if (failNext > 0) {
            failNext--;
            res.writeHead(500, { 'Content-Type': 'application/json' }).end(JSON.stringify({ name: 'application_error', message: 'simulated Resend outage', statusCode: 500 }));
            return;
        }
        sent.push(JSON.parse(body.toString()));
        res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ id: `email_${sent.length}` }));
    });
    return {
        server, sent,
        reset() { sent.length = 0; failNext = 0; },
        failNext(n: number) { failNext = n; },
    };
}

/** LLMO1 key in a captured email (the key is the only such token in the body). */
const keyFromEmail = (mail: SentEmail): string => {
    const m = /LLMO1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/.exec(mail.html);
    if (!m) throw new Error('no LLMO1 key in email');
    return m[0];
};

// ─────────────────────────────────────────────────────────────────────────────
// The adapter: Vercel-style routing (vercel.json only) in front of the Web handlers
// ─────────────────────────────────────────────────────────────────────────────

interface VercelRoute { src: string; dest: string }
type WebHandler = (req: Request) => Promise<Response>;

// Lazy loaders: handler modules (and `resend`, which reads RESEND_BASE_URL at load) are only imported
// on first request, after beforeAll has set the environment.
const handlerLoaders = import.meta.glob('../../packages/license-server/api/**/*.ts', { import: 'default' }) as Record<string, () => Promise<WebHandler>>;

const readRoutes = (): VercelRoute[] => JSON.parse(fs.readFileSync(path.join(LS_DIR, 'vercel.json'), 'utf8')).routes;

const MIME: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'application/javascript', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };

function createAdapter() {
    const routes = readRoutes().map(r => ({ re: new RegExp(`^${r.src}$`), dest: r.dest }));
    const log: { method: string; path: string; status: number }[] = [];

    const server = http.createServer(async (req, res) => {
        const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
        let status = 500;
        try {
            const route = routes.find(r => r.re.test(url.pathname));
            if (route) {
                const dest = url.pathname.replace(route.re, route.dest); // supports $1 captures like Vercel
                const loader = handlerLoaders[`../../packages/license-server${dest}`];
                if (!loader) throw new Error(`route ${route.re} -> ${dest}: no such function file`);
                const handler = await loader();
                const body = ['GET', 'HEAD'].includes(req.method || 'GET') ? undefined : await readBody(req);
                const headers = new Headers();
                for (const [k, v] of Object.entries(req.headers)) if (v !== undefined) headers.set(k, Array.isArray(v) ? v.join(', ') : v);
                const response = await handler(new Request(url, { method: req.method, headers, body }));
                status = response.status;
                const outHeaders: Record<string, string> = {};
                response.headers.forEach((v, k) => { outHeaders[k] = v; });
                res.writeHead(status, outHeaders).end(Buffer.from(await response.arrayBuffer()));
            } else {
                // Not a function route: Vercel serves public/ files. Anything else is a 404.
                const rel = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname).replace(/^\/+/, '');
                const file = path.resolve(LS_DIR, 'public', rel);
                if (file.startsWith(path.join(LS_DIR, 'public') + path.sep) && fs.existsSync(file) && fs.statSync(file).isFile()) {
                    status = 200;
                    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' }).end(fs.readFileSync(file));
                } else {
                    status = 404;
                    res.writeHead(404, { 'Content-Type': 'text/plain' }).end('NOT_FOUND');
                }
            }
        } catch (err: any) {
            status = 500;
            res.writeHead(500, { 'Content-Type': 'text/plain' }).end(`FUNCTION_INVOCATION_FAILED: ${err.message}`);
        }
        log.push({ method: req.method || '', path: url.pathname, status });
    });
    return { server, log };
}

// ─────────────────────────────────────────────────────────────────────────────
// The app side: compiled bundle
// ─────────────────────────────────────────────────────────────────────────────

interface AppApi {
    activateLicense(key: string): Promise<{ success: boolean; message: string }>;
    getLicenseInfo(force?: boolean): Promise<{ isPro: boolean; status: string; limits: { maxProjects: number; logRetentionDays: number }; integrityMismatch?: boolean }>;
    revalidateLicense(force?: boolean): Promise<void>;
    getMachineId(): string;
    licenseServerUrl(): string;
    sendPingIfDue(): Promise<boolean>;
    __setLicensePublicKeyForTests(pem: string): void;
    initDb(dbPath?: string): unknown;
    closeDb(): void;
    getSetting(key: string): string | null;
    updateSetting(key: string, value: string): void;
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared fixtures
// ─────────────────────────────────────────────────────────────────────────────

const OWNER_TOKEN = 'owner-token-0123456789abcdef';
const LS_SECRET = 'ls-webhook-secret';
const RZP_SECRET = 'rzp-webhook-secret';
const LEGACY_SECRET = 'legacy-signing-secret';
const DEV_SECRET = 'dev-secret-change-in-prod'; // the public fallback in src/keyGenerator.ts

const serverKeys = crypto.generateKeyPairSync('ed25519');
const SERVER_PRIVATE_PEM = serverKeys.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const SERVER_PUBLIC_PEM = serverKeys.publicKey.export({ type: 'spki', format: 'pem' }).toString();

const MANAGED_ENV = [
    'LICENSE_PRIVATE_KEY', 'LEMONSQUEEZY_WEBHOOK_SECRET', 'LEMONSQUEEZY_SIGNING_SECRET', 'RAZORPAY_WEBHOOK_SECRET',
    'RESEND_API_KEY', 'RESEND_BASE_URL', 'EMAIL_FROM', 'KV_REST_API_URL', 'KV_REST_API_TOKEN',
    'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN', 'ADMIN_TOKEN',
    'LICENSE_SIGNING_SECRET', 'LICENSE_SECRET', 'ALLOW_LEGACY_DEV_SECRET',
    'LLM_OBSERVER_LICENSE_SERVER', 'LICENSE_SERVER_URL', 'LLM_OBSERVER_DATA_DIR', 'LLM_OBSERVER_SKIP_MIGRATION_BACKUP',
];

const upstash = createFakeUpstash();
const resend = createFakeResend();
const adapter = createAdapter();
let base = '';          // adapter base URL
let tmpRoot = '';
let app: AppApi;
const savedEnv: Record<string, string | undefined> = {};
let dbCounter = 0;

/** Env of a correctly configured deployment. */
const goodEnv = (): Record<string, string | undefined> => ({
    LICENSE_PRIVATE_KEY: SERVER_PRIVATE_PEM,
    LEMONSQUEEZY_WEBHOOK_SECRET: LS_SECRET,
    RAZORPAY_WEBHOOK_SECRET: RZP_SECRET,
    LICENSE_SIGNING_SECRET: LEGACY_SECRET,
    ADMIN_TOKEN: OWNER_TOKEN,
});

/** Start the app on a brand-new database (the app module keeps a singleton). */
function freshAppDb(): void {
    app.closeDb();
    app.initDb(path.join(tmpRoot, `app-${++dbCounter}.db`));
}

// request helpers --------------------------------------------------------------------------------

const hmac = (body: string, secret: string) => crypto.createHmac('sha256', secret).update(body).digest('hex');

async function call(method: string, p: string, init: { body?: string; headers?: Record<string, string> } = {}) {
    const res = await fetch(`${base}${p}`, { method, body: init.body, headers: init.headers });
    const text = await res.text();
    let json: any; try { json = JSON.parse(text); } catch { /* not JSON */ }
    return { status: res.status, headers: res.headers, text, json };
}

async function lsWebhook(event: string, data: object, opts: { signature?: string | null; secret?: string } = {}) {
    const body = JSON.stringify({ data });
    const headers: Record<string, string> = { 'x-event-name': event, 'Content-Type': 'application/json' };
    if (opts.signature !== null) headers['x-signature'] = opts.signature ?? hmac(body, opts.secret ?? LS_SECRET);
    return call('POST', '/webhook/lemonsqueezy', { body, headers });
}

async function rzpWebhook(payload: object, opts: { signature?: string | null; secret?: string } = {}) {
    const body = JSON.stringify(payload);
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (opts.signature !== null) headers['x-razorpay-signature'] = opts.signature ?? hmac(body, opts.secret ?? RZP_SECRET);
    return call('POST', '/webhook/razorpay', { body, headers });
}

const validate = (body: object, extraHeaders: Record<string, string> = {}) =>
    call('POST', '/license/validate', { body: JSON.stringify(body), headers: { 'Content-Type': 'application/json', ...extraHeaders } });

const adminReport = (token: string | null = OWNER_TOKEN) =>
    call('GET', '/admin/report', { headers: token === null ? {} : { Authorization: `Bearer ${token}` } });

const decodePayload = (key: string) => JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString());

// ─────────────────────────────────────────────────────────────────────────────

beforeAll(async () => {
    if (!fs.existsSync(APP_DIST)) {
        throw new Error(`${path.relative(ROOT, APP_DIST)} is missing - build the app first: npm run build --workspace=@llm-observer/proxy`);
    }
    for (const k of MANAGED_ENV) savedEnv[k] = process.env[k];
    for (const k of MANAGED_ENV) delete process.env[k];

    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'llmo-license-e2e-'));

    const upstashPort = await listenInRange(upstash.server);
    const resendPort = await listenInRange(resend.server);
    const adapterPort = await listenInRange(adapter.server);
    base = `http://127.0.0.1:${adapterPort}`;

    Object.assign(process.env, {
        // Read once, when the resend package / emailService first load (lazily, on the first webhook)
        RESEND_API_KEY: RESEND_KEY,
        RESEND_BASE_URL: `http://127.0.0.1:${resendPort}`,
        EMAIL_FROM: 'licenses@example.test',
        KV_REST_API_URL: `http://127.0.0.1:${upstashPort}`,
        KV_REST_API_TOKEN: UPSTASH_TOKEN,
        // App side
        LLM_OBSERVER_LICENSE_SERVER: base,
        LLM_OBSERVER_DATA_DIR: tmpRoot,
        LLM_OBSERVER_SKIP_MIGRATION_BACKUP: '1',
        ...Object.fromEntries(Object.entries(goodEnv()).filter(([, v]) => v !== undefined)),
    });

    app = createRequire(import.meta.url)(APP_DIST) as AppApi;
    app.__setLicensePublicKeyForTests(SERVER_PUBLIC_PEM);
});

afterAll(async () => {
    try { app?.closeDb(); } catch { /* ignore */ }
    await Promise.all([adapter.server, upstash.server, resend.server].map(s => s.listening ? closeServer(s) : undefined));
    for (const k of MANAGED_ENV) { if (savedEnv[k] === undefined) delete process.env[k]; else process.env[k] = savedEnv[k]; }
    if (tmpRoot) fs.rmSync(tmpRoot, { recursive: true, force: true });
});

/** Start a describe block from an empty store and mailbox. */
const clean = () => { upstash.reset(); resend.reset(); };

// ═════════════════════════════════════════════════════════════════════════════
// Routing config
// ═════════════════════════════════════════════════════════════════════════════

describe('vercel.json routing', () => {
    const routes = readRoutes();
    const apiFiles = (function walk(dir: string): string[] {
        return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e =>
            e.isDirectory() ? walk(path.join(dir, e.name)) : e.name.endsWith('.ts') ? [path.relative(LS_DIR, path.join(dir, e.name)).split(path.sep).join('/')] : []);
    })(path.join(LS_DIR, 'api'));

    it('every route destination is a file that exists', () => {
        expect(routes.length).toBeGreaterThan(0);
        for (const r of routes) expect(fs.existsSync(path.join(LS_DIR, r.dest)), `${r.src} -> ${r.dest}`).toBe(true);
    });

    it('every api/*.ts function is reachable through a route', () => {
        const dests = new Set(routes.map(r => r.dest.replace(/^\//, '')));
        expect(apiFiles.length).toBeGreaterThanOrEqual(7);
        for (const f of apiFiles) expect(dests.has(f), `${f} has no route in vercel.json`).toBe(true);
    });

    it('has no duplicate or shadowed route sources', () => {
        const srcs = routes.map(r => r.src);
        expect(new Set(srcs).size).toBe(srcs.length);
    });

    it('serves each route end to end (no 404/500 from the config itself)', async () => {
        for (const r of routes) {
            // The handler may refuse an empty GET (405) or POST (400/401/503) - what matters is that routing
            // reached it, which a 404 or FUNCTION_INVOCATION_FAILED would show.
            const res = await call('GET', r.src);
            expect([200, 204, 400, 401, 405, 503], `${r.src} -> ${res.status}`).toContain(res.status);
            expect(res.text).not.toContain('FUNCTION_INVOCATION_FAILED');
        }
    });

    it('does not expose function source or unrouted paths', async () => {
        expect((await call('GET', '/nope')).status).toBe(404);
        expect((await call('GET', '/api/health.ts')).status).toBe(404);   // only vercel.json routes count
        expect((await call('GET', '/../src/signing.ts')).status).toBe(404);
        expect((await call('GET', '/%2e%2e/src/signing.ts')).status).toBe(404);
    });

    it('serves /admin.html from public/', async () => {
        const res = await call('GET', '/admin.html');
        expect(res.status).toBe(200);
        expect(res.headers.get('content-type')).toMatch(/text\/html/);
        expect(res.text).toBe(fs.readFileSync(path.join(LS_DIR, 'public/admin.html'), 'utf8'));
        expect(res.text.toLowerCase()).toContain('<html');
    });
});

// ═════════════════════════════════════════════════════════════════════════════
// Request hygiene on the handlers
// ═════════════════════════════════════════════════════════════════════════════

describe('/health', () => {
    it('reports every flag true on a fully configured deployment', async () => {
        const res = await call('GET', '/health');
        expect(res.status).toBe(200);
        expect(res.json).toMatchObject({ status: 'ok', service: 'llm-observer-license-server' });
        expect(Object.keys(res.json.env).length).toBeGreaterThanOrEqual(7);
        for (const [flag, v] of Object.entries(res.json.env)) expect(v, flag).toBe(true);
    });

    it('shows which settings are missing without leaking their values', async () => {
        const res = await withEnv({ RAZORPAY_WEBHOOK_SECRET: undefined, ADMIN_TOKEN: undefined }, () => call('GET', '/health'));
        expect(res.json.env.hasRZPSecret).toBe(false);
        expect(res.json.env.hasAdminToken).toBe(false);
        expect(res.json.env.hasLSSecret).toBe(true);
        expect(res.text).not.toContain(LS_SECRET);
        expect(res.text).not.toContain(SERVER_PRIVATE_PEM.slice(30, 60));
    });
});

describe('webhook authentication', () => {
    beforeEach(clean);
    const lsCreated = { id: '7001', attributes: { user_email: 'sig@example.test', total: 900, currency: 'usd' } };
    const rzpActivated = { event: 'subscription.activated', payload: { subscription: { entity: { id: 'sub_SIG' } }, payment: { entity: { email: 'sig@example.test', amount: 29900, currency: 'INR' } } } };

    it('rejects missing, malformed and wrong signatures with 401 and issues nothing', async () => {
        for (const signature of [null, '', 'not-hex-at-all', '00'.repeat(32), hmac('{}', LS_SECRET), hmac(JSON.stringify({ data: lsCreated }), 'someone-elses-secret')]) {
            const res = await lsWebhook('subscription_created', lsCreated, { signature });
            expect(res.status, `ls signature=${signature}`).toBe(401);
        }
        for (const signature of [null, '', 'zz', '00'.repeat(32), hmac(JSON.stringify(rzpActivated), 'someone-elses-secret')]) {
            const res = await rzpWebhook(rzpActivated, { signature });
            expect(res.status, `rzp signature=${signature}`).toBe(401);
        }
        // A genuine signature for a different body must not authorise this one
        const other = JSON.stringify({ data: { id: '1', attributes: {} } });
        expect((await lsWebhook('subscription_created', lsCreated, { signature: hmac(other, LS_SECRET) })).status).toBe(401);
        expect(resend.sent).toHaveLength(0);
        expect(JSON.parse(upstash.dump()).s).toEqual([]);
    });

    it('answers 503 (not 200, not a key) when the webhook secret is not configured', async () => {
        const ls = await withEnv({ LEMONSQUEEZY_WEBHOOK_SECRET: undefined }, () => lsWebhook('subscription_created', lsCreated));
        expect(ls.status).toBe(503);
        const rzp = await withEnv({ RAZORPAY_WEBHOOK_SECRET: undefined }, () => rzpWebhook(rzpActivated));
        expect(rzp.status).toBe(503);
        // A correctly "signed" request with the empty secret must not work either
        const empty = await withEnv({ RAZORPAY_WEBHOOK_SECRET: undefined }, () => rzpWebhook(rzpActivated, { secret: '' }));
        expect(empty.status).toBe(503);
        expect(resend.sent).toHaveLength(0);
    });

    it('accepts the older LEMONSQUEEZY_SIGNING_SECRET name', async () => {
        const res = await withEnv({ LEMONSQUEEZY_WEBHOOK_SECRET: undefined, LEMONSQUEEZY_SIGNING_SECRET: 'old-name-secret' },
            () => lsWebhook('subscription_created', lsCreated, { secret: 'old-name-secret' }));
        expect(res.status).toBe(200);
        expect(resend.sent).toHaveLength(1);
    });

    it('answers 503 and retries later when signing is not configured (no key emailed)', async () => {
        const res = await withEnv({ LICENSE_PRIVATE_KEY: undefined }, () => lsWebhook('subscription_created', lsCreated));
        expect(res.status).toBe(503);
        expect(res.json).toMatchObject({ reason: 'signing_not_configured' });
        expect(resend.sent).toHaveLength(0);
    });

    it('rejects non-POST methods', async () => {
        expect((await call('GET', '/webhook/lemonsqueezy')).status).toBe(405);
        expect((await call('GET', '/webhook/razorpay')).status).toBe(405);
    });
});

describe('/admin/report authentication', () => {
    beforeEach(clean);
    it('401 without a token and with a wrong token; 200 JSON with the right one', async () => {
        expect((await adminReport(null)).status).toBe(401);
        expect((await adminReport('')).status).toBe(401);
        expect((await adminReport('owner-token-0123456789abcdeX')).status).toBe(401);
        expect((await adminReport(OWNER_TOKEN.slice(0, -1))).status).toBe(401);
        const ok = await adminReport();
        expect(ok.status).toBe(200);
        expect(ok.headers.get('content-type')).toMatch(/application\/json/);
        expect(ok.json).toMatchObject({ customers: [], installs: { total_ever: 0 } });
    });

    it('503 when ADMIN_TOKEN is unset or too short, and when storage is not configured', async () => {
        expect((await withEnv({ ADMIN_TOKEN: undefined }, () => adminReport(''))).status).toBe(503);
        expect((await withEnv({ ADMIN_TOKEN: 'short' }, () => adminReport('short'))).status).toBe(503);
        expect((await withEnv({ KV_REST_API_URL: undefined, KV_REST_API_TOKEN: undefined }, () => adminReport())).status).toBe(503);
    });

    it('rejects POST', async () => {
        expect((await call('POST', '/admin/report', { headers: { Authorization: `Bearer ${OWNER_TOKEN}` } })).status).toBe(405);
    });
});

describe('/license/validate and /telemetry/ping input handling', () => {
    beforeEach(clean);
    it('400 JSON for garbage, bad JSON and missing keys', async () => {
        for (const body of ['not json', '{"license_key": 42}', '{}', '[]']) {
            const res = await call('POST', '/license/validate', { body, headers: { 'Content-Type': 'application/json' } });
            expect(res.status, body).toBe(400);
            expect(res.json).toMatchObject({ valid: false });
        }
        const res = await validate({ license_key: 'definitely-not-a-key' });
        expect(res.status).toBe(400);
        expect(res.headers.get('content-type')).toMatch(/application\/json/);
    });

    it('answers a CORS preflight and sends CORS headers on errors', async () => {
        const pre = await call('OPTIONS', '/license/validate', { headers: { Origin: 'http://localhost:3000', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type' } });
        expect(pre.status).toBe(204);
        expect(pre.headers.get('access-control-allow-origin')).toBe('*');
        expect(pre.headers.get('access-control-allow-methods')).toMatch(/POST/);
        expect(pre.headers.get('access-control-allow-headers')).toMatch(/content-type/i);
        expect((await validate({ license_key: 'x' }, { Origin: 'http://localhost:3000' })).headers.get('access-control-allow-origin')).toBe('*');
    });

    it('telemetry ping rejects invalid bodies with 400 and stores nothing', async () => {
        const good = { install_id: crypto.randomUUID(), version: '2.0.2', os: 'linux', tier: 'free' };
        for (const bad of [{}, { ...good, install_id: 'not-a-uuid' }, { ...good, tier: 'gold' }, { ...good, version: 'x'.repeat(40) }, { ...good, os: '' }]) {
            const res = await call('POST', '/telemetry/ping', { body: JSON.stringify(bad), headers: { 'Content-Type': 'application/json' } });
            expect(res.status, JSON.stringify(bad)).toBe(400);
        }
        expect((await call('POST', '/telemetry/ping', { body: 'nope' })).status).toBe(400);
        expect(JSON.parse(upstash.dump())).toEqual({ h: [], s: [], z: [] });
    });
});

// ═════════════════════════════════════════════════════════════════════════════
// The purchase -> activation -> cancellation -> expiry story, app and server together
// ═════════════════════════════════════════════════════════════════════════════

describe('Lemon Squeezy subscription lifecycle (app + server over HTTP)', () => {
    const SUB = 'ls-sub-4242';
    const EMAIL = 'buyer@example.test';
    let key = '';

    beforeAll(() => {
        clean();
        freshAppDb();
    });

    it('a signed purchase webhook emails exactly one LLMO1 key to the buyer', async () => {
        const res = await lsWebhook('subscription_created', { id: '4242', attributes: { user_email: EMAIL, total: 900, currency: 'usd' } });
        expect(res.status).toBe(200);
        expect(res.json).toEqual({ received: true, activated: true });
        expect(resend.sent).toHaveLength(1);
        const mail = resend.sent[0];
        expect(mail.to).toEqual([EMAIL]);
        expect(mail.from).toBe('licenses@example.test');
        key = keyFromEmail(mail);
        expect(key.startsWith('LLMO1.')).toBe(true);
        expect(decodePayload(key)).toMatchObject({ v: 1, sub: 'ls:4242', plan: 'pro' });
        expect(mail.html).toContain('USD 9.00');
    });

    it('a repeat delivery of the same webhook sends no second email', async () => {
        const res = await lsWebhook('subscription_created', { id: '4242', attributes: { user_email: EMAIL, total: 900, currency: 'usd' } });
        expect(res.status).toBe(200);
        expect(res.json).toMatchObject({ action: 'already_issued' });
        expect(resend.sent).toHaveLength(1);
    });

    it('the app activates the key: signature checked offline, server told machine id and version', async () => {
        const requestsBefore = adapter.log.filter(r => r.path === '/license/validate').length;
        const result = await app.activateLicense(key);
        expect(result.success).toBe(true);
        expect(adapter.log.filter(r => r.path === '/license/validate').length).toBe(requestsBefore + 1);

        const info = await app.getLicenseInfo(true);
        expect(info).toMatchObject({ isPro: true, status: 'active' });
        expect(info.limits.maxProjects).toBeGreaterThan(1);
        expect(app.getSetting('license_key')).toBe(key);
        expect(app.getSetting('license_status')).toBe('active');
    });

    it('/admin/report lists the customer with one device (this machine, this app version)', async () => {
        const res = await adminReport();
        expect(res.status).toBe(200);
        expect(res.json.customers).toHaveLength(1);
        const c = res.json.customers[0];
        expect(c).toMatchObject({ sub: `ls:4242`, email: EMAIL, provider: 'lemonsqueezy', status: 'active', plan: 'pro', amount: '9.00', currency: 'USD' });
        expect(c.activations).toHaveLength(1);
        expect(c.activations[0]).toMatchObject({ machine_id: app.getMachineId(), version: APP_VERSION });
        expect(app.getMachineId()).toMatch(/^[0-9a-f]{32}$/);
    });

    it('re-activating on the same machine does not add a second device', async () => {
        await app.activateLicense(key);
        expect((await adminReport()).json.customers[0].activations).toHaveLength(1);
        await validate({ license_key: key, machine_id: 'another-laptop', version: '2.0.2' });
        expect((await adminReport()).json.customers[0].activations).toHaveLength(2);
    });

    it('payment_success keeps the customer active', async () => {
        const res = await lsWebhook('subscription_payment_success', { id: 'inv-1', attributes: { subscription_id: 4242 } });
        expect(res.json).toMatchObject({ action: 'status_updated', status: 'active' });
        expect((await adminReport()).json.customers[0].status).toBe('active');
    });

    it('cancelled: the key stays valid until the period ends', async () => {
        await lsWebhook('subscription_cancelled', { id: '4242', attributes: {} });
        const res = await validate({ license_key: key });
        expect(res.status).toBe(200);
        expect(res.json).toMatchObject({ valid: true, tier: 'pro', status: 'cancelled' });
        expect((await adminReport()).json.customers[0].status).toBe('cancelled');

        await app.revalidateLicense(true);
        expect(app.getSetting('license_status')).toBe('active');
        expect(await app.getLicenseInfo(true)).toMatchObject({ isPro: true, status: 'active' });
    });

    it('expired + network failure: the app stays Pro (a failed check never downgrades)', async () => {
        await lsWebhook('subscription_expired', { id: '4242', attributes: {} });
        const checkedAt = app.getSetting('license_checked_at');
        const port = await deadPort();
        await withEnv({ LLM_OBSERVER_LICENSE_SERVER: `http://127.0.0.1:${port}` }, async () => {
            expect(app.licenseServerUrl()).toBe(`http://127.0.0.1:${port}`);
            await app.revalidateLicense(true);
        });
        expect(app.getSetting('license_status')).toBe('active');
        expect(app.getSetting('license_checked_at')).toBe(checkedAt);
        expect(await app.getLicenseInfo(true)).toMatchObject({ isPro: true });
    });

    it('expired + reachable server: revalidation drops the app to Free', async () => {
        const res = await validate({ license_key: key });
        expect(res.status).toBe(403);
        expect(res.json).toMatchObject({ valid: false, revoked: true });

        await app.revalidateLicense(true);
        expect(app.getSetting('license_status')).toBe('cancelled');
        const info = await app.getLicenseInfo(true);
        expect(info).toMatchObject({ isPro: false, status: 'cancelled' });
        expect(info.limits.maxProjects).toBe(1);
        expect((await adminReport()).json.customers[0].status).toBe('expired');
    });

    it('an expired key can no longer be activated on a new install', async () => {
        freshAppDb();
        const result = await app.activateLicense(key);
        expect(result.success).toBe(false);
        expect(result.message).toMatch(/subscription has ended/i);
        expect(await app.getLicenseInfo(true)).toMatchObject({ isPro: false });
    });

    it('a renewal (payment_success) re-enables the key', async () => {
        await lsWebhook('subscription_payment_success', { id: 'inv-2', attributes: { subscription_id: 4242 } });
        expect((await validate({ license_key: key })).status).toBe(200);
        expect((await app.activateLicense(key)).success).toBe(true);
        expect(await app.getLicenseInfo(true)).toMatchObject({ isPro: true });
    });

    it('status events for subscriptions we never issued do not create customers', async () => {
        await lsWebhook('subscription_expired', { id: '999999', attributes: {} });
        expect((await adminReport()).json.customers.map((c: any) => c.sub)).toEqual(['ls:4242']);
    });
});

describe('failure handling around issuing', () => {
    beforeEach(clean);
    it('an email outage returns 500 so the provider retries; the retry succeeds and issues one key', async () => {
        resend.failNext(1);
        const data = { id: '5150', attributes: { user_email: 'retry@example.test', total: 900, currency: 'USD' } };
        const first = await lsWebhook('subscription_created', data);
        expect(first.status).toBe(500);
        expect(first.json).toMatchObject({ action: 'email_failed' });
        expect(resend.sent).toHaveLength(0);
        expect((await adminReport()).json.customers).toHaveLength(0); // not marked active, so a retry will issue

        const retry = await lsWebhook('subscription_created', data);
        expect(retry.status).toBe(200);
        expect(resend.sent).toHaveLength(1);
        expect((await adminReport()).json.customers).toHaveLength(1);
    });

    it('a purchase without an email address is reported, not silently dropped', async () => {
        const res = await lsWebhook('subscription_created', { id: '5151', attributes: { total: 900 } });
        expect(res.status).toBe(400);
        expect(res.json).toMatchObject({ reason: 'no_email' });
        expect(resend.sent).toHaveLength(0);
    });

    it('unknown events are acknowledged and ignored', async () => {
        const res = await lsWebhook('order_created', { id: '1', attributes: { user_email: 'x@example.test' } });
        expect(res.json).toMatchObject({ action: 'ignored' });
        expect(resend.sent).toHaveLength(0);
    });
});

describe('forged and foreign keys', () => {
    beforeEach(clean);
    const foreign = crypto.generateKeyPairSync('ed25519');
    const forge = (sub: string, signer = foreign.privateKey) => {
        const body = Buffer.from(JSON.stringify({ v: 1, sub, plan: 'pro', iat: Math.floor(Date.now() / 1000) })).toString('base64url');
        return `LLMO1.${body}.${crypto.sign(null, Buffer.from(`LLMO1.${body}`), signer).toString('base64url')}`;
    };

    beforeAll(() => freshAppDb());

    it('the app rejects a key signed by anyone else, without even asking the server', async () => {
        const before = adapter.log.length;
        const result = await app.activateLicense(forge('ls:1'));
        expect(result.success).toBe(false);
        expect(result.message).toMatch(/invalid license key/i);
        expect(adapter.log.length).toBe(before);
        expect(await app.getLicenseInfo(true)).toMatchObject({ isPro: false });
        expect(app.getSetting('license_key')).toBeNull();
    });

    it('the app rejects tampered, truncated and unsigned LLMO1-shaped keys', async () => {
        const good = forge('ls:2', serverKeys.privateKey);
        const [p, body, sig] = good.split('.');
        const tamperedBody = Buffer.from(JSON.stringify({ v: 1, sub: 'ls:other', plan: 'pro', iat: 1 })).toString('base64url');
        for (const k of [`${p}.${tamperedBody}.${sig}`, `${p}.${body}`, `${p}.${body}.${crypto.randomBytes(64).toString('base64url')}`, `${p}.${body}.`, 'LLMO1.']) {
            expect((await app.activateLicense(k)).success, k.slice(0, 30)).toBe(false);
        }
        expect((await app.getLicenseInfo(true)).isPro).toBe(false);
    });

    it('the server rejects the same keys with 400 and records nothing', async () => {
        const good = forge('ls:3', serverKeys.privateKey);
        expect((await validate({ license_key: good, machine_id: 'm1' })).status).toBe(200); // control: genuine key is accepted
        upstash.reset();
        const [p, body] = good.split('.');
        for (const k of [forge('ls:3'), `${p}.${body}.${crypto.randomBytes(64).toString('base64url')}`, `${p}.${body}`, 'LLMO1.a.b']) {
            const res = await validate({ license_key: k, machine_id: 'attacker' });
            expect(res.status, k.slice(0, 30)).toBe(400);
            expect(res.json.valid).toBe(false);
        }
        expect(upstash.writeCount()).toBe(0);
    });

    it('the server cannot verify any LLMO1 key when it has no signing key (fails closed)', async () => {
        const good = forge('ls:4', serverKeys.privateKey);
        const res = await withEnv({ LICENSE_PRIVATE_KEY: undefined }, () => validate({ license_key: good }));
        expect(res.status).toBe(400);
    });

    it('a genuine key still activates while the license server is down (offline verification)', async () => {
        const good = forge('ls:5', serverKeys.privateKey);
        const port = await deadPort();
        const result = await withEnv({ LLM_OBSERVER_LICENSE_SERVER: `http://127.0.0.1:${port}` }, () => app.activateLicense(good));
        expect(result.success).toBe(true);
        expect(await app.getLicenseInfo(true)).toMatchObject({ isPro: true });
    });
});

describe('legacy PRO_ keys', () => {
    beforeEach(clean);
    beforeAll(() => freshAppDb());
    const legacyKey = (secrets: { LICENSE_SIGNING_SECRET?: string; LICENSE_SECRET?: string }, sub = 'sub12345678') =>
        withEnv({ LICENSE_SIGNING_SECRET: secrets.LICENSE_SIGNING_SECRET, LICENSE_SECRET: secrets.LICENSE_SECRET },
            async () => generateLicenseKey({ provider: 'lemonsqueezy', subscriptionId: sub, customerId: 'c' }));

    it('a key signed with LICENSE_SIGNING_SECRET validates and activates the app', async () => {
        const key = await legacyKey({ LICENSE_SIGNING_SECRET: LEGACY_SECRET });
        expect(key).toMatch(/^PRO_LS_[A-F0-9]{8}_SUB12345678$/);
        const res = await validate({ license_key: key, machine_id: 'legacy-box', version: '1.9.0' });
        expect(res.status).toBe(200);
        expect(res.json).toMatchObject({ valid: true, tier: 'pro' });

        freshAppDb();
        const result = await app.activateLicense(key);
        expect(result.success).toBe(true);
        expect(await app.getLicenseInfo(true)).toMatchObject({ isPro: true, status: 'active' });
    });

    it('the older LICENSE_SECRET name is honoured too', async () => {
        const key = await legacyKey({ LICENSE_SECRET: 'older-name-secret' }, 'subolder');
        const res = await withEnv({ LICENSE_SIGNING_SECRET: undefined, LICENSE_SECRET: 'older-name-secret' }, () => validate({ license_key: key }));
        expect(res.status).toBe(200);
    });

    it('a key signed with the public dev secret is rejected, by server and app', async () => {
        const forged = await legacyKey({}, 'forged01'); // no secret configured while generating = the public fallback
        const res = await validate({ license_key: forged });
        expect(res.status).toBe(400);
        expect(res.json.valid).toBe(false);

        freshAppDb();
        const result = await app.activateLicense(forged);
        expect(result.success).toBe(false);
        expect(result.message).toMatch(/invalid or forged/i);
        expect(await app.getLicenseInfo(true)).toMatchObject({ isPro: false });
    });

    it('a key with a tampered fingerprint or sub id is rejected', async () => {
        const key = await legacyKey({ LICENSE_SIGNING_SECRET: LEGACY_SECRET }, 'realsub1');
        const [a, b, fp, sub] = key.split('_');
        for (const k of [`${a}_${b}_${fp}_OTHERSUB`, `${a}_${b}_00000000_${sub}`, `${a}_RZP_${fp}_${sub}`]) {
            expect((await validate({ license_key: k })).status, k).toBe(400);
        }
    });

    it('the dev-secret key is accepted only when ALLOW_LEGACY_DEV_SECRET=true', async () => {
        const forged = await legacyKey({}, 'oldcust1');
        const allowed = await withEnv({ ALLOW_LEGACY_DEV_SECRET: 'true' }, () => validate({ license_key: forged }));
        expect(allowed.status).toBe(200);
        const notTrue = await withEnv({ ALLOW_LEGACY_DEV_SECRET: '1' }, () => validate({ license_key: forged }));
        expect(notTrue.status).toBe(400);
        // Opting in does not weaken keys made with the real secret
        const real = await legacyKey({ LICENSE_SIGNING_SECRET: LEGACY_SECRET }, 'realsub2');
        expect((await withEnv({ ALLOW_LEGACY_DEV_SECRET: 'true' }, () => validate({ license_key: real }))).status).toBe(200);
    });

    it('with no legacy secret configured at all, the public dev secret is what validates (why /health flags it)', async () => {
        const forged = await legacyKey({}, 'nosecret1');
        const res = await withEnv({ LICENSE_SIGNING_SECRET: undefined, LICENSE_SECRET: undefined }, () => validate({ license_key: forged }));
        expect(res.status).toBe(200); // documents the current behaviour: the verifier script reports this as a FAIL
        expect(DEV_SECRET).toBe('dev-secret-change-in-prod');
    });
});

describe('Razorpay', () => {
    beforeEach(clean);
    it('a one-time payment (payment.captured) issues and emails a key; the key validates', async () => {
        const res = await rzpWebhook({ event: 'payment.captured', payload: { payment: { entity: { id: 'pay_ONE', order_id: 'order_ONE', email: 'upi@example.test', amount: 29900, currency: 'INR' } } } });
        expect(res.status).toBe(200);
        expect(res.json).toEqual({ received: true, activated: true });
        expect(resend.sent).toHaveLength(1);
        expect(resend.sent[0].to).toEqual(['upi@example.test']);
        const key = keyFromEmail(resend.sent[0]);
        expect(decodePayload(key).sub).toBe('rzp:order_ONE');
        expect((await validate({ license_key: key, machine_id: 'upi-box', version: APP_VERSION })).status).toBe(200);

        const c = (await adminReport()).json.customers;
        expect(c).toHaveLength(1);
        expect(c[0]).toMatchObject({ provider: 'razorpay', email: 'upi@example.test', amount: '299.00', currency: 'INR', status: 'active' });

        // delivered twice by Razorpay: still one email
        await rzpWebhook({ event: 'payment.captured', payload: { payment: { entity: { id: 'pay_ONE', order_id: 'order_ONE', email: 'upi@example.test', amount: 29900, currency: 'INR' } } } });
        expect(resend.sent).toHaveLength(1);
    });

    it('a subscription charge (payment.captured with an invoice) does not issue a key', async () => {
        const viaInvoice = await rzpWebhook({ event: 'payment.captured', payload: { payment: { entity: { id: 'pay_REC1', order_id: 'order_REC1', invoice_id: 'inv_1', email: 'sub@example.test', amount: 29900, currency: 'INR' } } } });
        expect(viaInvoice.json).toMatchObject({ action: 'ignored', reason: 'subscription_charge' });
        const viaSubscription = await rzpWebhook({ event: 'payment.captured', payload: { subscription: { entity: { id: 'sub_REC' } }, payment: { entity: { id: 'pay_REC2', order_id: 'order_REC2', email: 'sub@example.test', amount: 29900, currency: 'INR' } } } });
        expect(viaSubscription.json).toMatchObject({ action: 'ignored', reason: 'subscription_charge' });
        expect(resend.sent).toHaveLength(0);
        expect((await adminReport()).json.customers).toHaveLength(0);
    });

    it('subscription.activated issues once; halted/cancelled/completed expire it; charged re-activates it', async () => {
        const sub = { id: 'sub_LIFE' };
        const activated = { event: 'subscription.activated', payload: { subscription: { entity: sub }, payment: { entity: { email: 'life@example.test', amount: 29900, currency: 'INR' } } } };
        expect((await rzpWebhook(activated)).json).toEqual({ received: true, activated: true });
        const key = keyFromEmail(resend.sent[0]);
        expect((await rzpWebhook(activated)).json).toMatchObject({ action: 'already_issued' });
        expect(resend.sent).toHaveLength(1);

        await rzpWebhook({ event: 'subscription.halted', payload: { subscription: { entity: sub } } });
        expect((await validate({ license_key: key })).status).toBe(403);
        await rzpWebhook({ event: 'subscription.charged', payload: { subscription: { entity: sub } } });
        expect((await validate({ license_key: key })).status).toBe(200);
    });

    it('a payment with no email is left for manual delivery, with a 200 so Razorpay stops retrying', async () => {
        const res = await rzpWebhook({ event: 'payment.captured', payload: { payment: { entity: { id: 'pay_NOMAIL', order_id: 'order_NOMAIL', amount: 100, currency: 'INR' } } } });
        expect(res.status).toBe(200);
        expect(res.json).toMatchObject({ action: 'pending_manual_delivery' });
        expect(resend.sent).toHaveLength(0);
    });
});

describe('opt-in telemetry', () => {
    beforeAll(() => { clean(); freshAppDb(); });

    it('sends nothing until the user opts in', async () => {
        const pingsBefore = adapter.log.filter(r => r.path === '/telemetry/ping').length;
        expect(await app.sendPingIfDue()).toBe(false);
        expect((await adminReport()).json.installs).toMatchObject({ total_ever: 0, active_7d: 0 });
        expect(adapter.log.filter(r => r.path === '/telemetry/ping').length).toBe(pingsBefore);
    });

    it('after opt-in the daily ping appears in installs, once, with no identifying extras', async () => {
        app.updateSetting('telemetry_opt_in', 'true');
        expect(await app.sendPingIfDue()).toBe(true);
        const { installs } = (await adminReport()).json;
        expect(installs).toMatchObject({ total_ever: 1, active_7d: 1, active_30d: 1 });
        expect(installs.by_tier).toEqual({ free: 1 });
        expect(installs.by_version).toEqual({ [APP_VERSION]: 1 });
        expect(installs.by_os).toEqual({ [process.platform]: 1 });

        // already sent today
        expect(await app.sendPingIfDue()).toBe(false);
        expect((await adminReport()).json.installs.total_ever).toBe(1);

        // The stored record holds only the documented fields (+ timestamps), keyed by the random install id
        const installId = app.getSetting('telemetry_install_id')!;
        expect(installId).toMatch(/^[0-9a-f-]{36}$/);
        const dump = JSON.parse(upstash.dump());
        const record = Object.fromEntries(dump.h.find(([k]: [string]) => k === `install:${installId}`)[1]);
        expect(Object.keys(record).sort()).toEqual(['first_seen', 'last_seen', 'os', 'tier', 'version']);
    });

    it('the tier in the ping follows the licence (Pro after activation)', async () => {
        await lsWebhook('subscription_created', { id: '8800', attributes: { user_email: 'pinger@example.test', total: 900, currency: 'USD' } });
        const key = keyFromEmail(resend.sent[0]);
        expect((await app.activateLicense(key)).success).toBe(true);
        app.updateSetting('telemetry_last_ping_at', ''); // pretend a day has passed
        expect(await app.sendPingIfDue()).toBe(true);
        const { installs } = (await adminReport()).json;
        expect(installs.total_ever).toBe(1); // same install id, updated in place
        expect(installs.by_tier).toEqual({ pro: 1 });
    });

    it('a failed ping (server unreachable) is swallowed and retried later', async () => {
        app.updateSetting('telemetry_last_ping_at', '');
        const port = await deadPort();
        const sent = await withEnv({ LLM_OBSERVER_LICENSE_SERVER: `http://127.0.0.1:${port}` }, () => app.sendPingIfDue());
        expect(sent).toBe(false);
        expect(app.getSetting('telemetry_last_ping_at')).toBe('');
    });
});

// ═════════════════════════════════════════════════════════════════════════════
// scripts/verify-license-server.js against the adapter
// ═════════════════════════════════════════════════════════════════════════════

describe('scripts/verify-license-server.js', () => {
    const TOKEN_ENV = 'LLMO_E2E_ADMIN_TOKEN';
    beforeAll(clean);

    async function runVerifier(args: string[], env: Record<string, string> = {}) {
        try {
            const { stdout, stderr } = await execFileAsync(process.execPath, [VERIFIER, ...args], {
                env: { PATH: process.env.PATH ?? '', ...env }, timeout: 60_000,
            });
            return { code: 0, stdout, stderr, all: stdout + stderr };
        } catch (e: any) {
            return { code: typeof e.code === 'number' ? e.code : -1, stdout: String(e.stdout ?? ''), stderr: String(e.stderr ?? ''), all: String(e.stdout ?? '') + String(e.stderr ?? '') };
        }
    }
    const lines = (out: string, tag: 'PASS' | 'FAIL' | 'SKIP' | 'WARN') => out.split('\n').filter(l => l.startsWith(tag));

    it('all green against a correctly configured deployment: exit 0, no failures, token never printed', async () => {
        // make the report non-empty so a leaked customer record would show up in output
        await lsWebhook('subscription_created', { id: '9900', attributes: { user_email: 'leakcheck@example.test', total: 900, currency: 'USD' } });
        const before = upstash.dump();

        const r = await runVerifier([base, '--admin-token-env', TOKEN_ENV], { [TOKEN_ENV]: OWNER_TOKEN });
        expect(r.all).not.toContain(OWNER_TOKEN);
        expect(r.all).not.toContain('leakcheck@example.test');
        expect(lines(r.all, 'FAIL'), r.all).toEqual([]);
        expect(r.code, r.all).toBe(0);
        const pass = lines(r.all, 'PASS').join('\n');
        for (const what of ['/health', 'garbage', 'unsigned', 'telemetry', '/webhook/lemonsqueezy', '/webhook/razorpay', 'without a token', 'with the token', '/admin.html', 'preflight', 'dev secret']) {
            expect(pass, `missing PASS for ${what}\n${r.all}`).toContain(what);
        }
        expect(r.all).toMatch(/0 failed/);
        expect(lines(r.all, 'SKIP')).toEqual([]);

        // read-only: the store is byte-for-byte what it was, and no email went out
        expect(upstash.dump()).toBe(before);
        expect(resend.sent).toHaveLength(1); // the setup purchase only
    });

    it('without --admin-token-env it skips the authenticated check and still passes', async () => {
        const r = await runVerifier([base]);
        expect(r.code, r.all).toBe(0);
        expect(lines(r.all, 'SKIP').join('\n')).toMatch(/admin/i);
        expect(lines(r.all, 'PASS').join('\n')).toContain('without a token');
    });

    it('broken config: exits non-zero and names what is wrong', async () => {
        const r = await withEnv({
            RAZORPAY_WEBHOOK_SECRET: undefined,   // -> 503 on /webhook/razorpay
            RESEND_API_KEY: undefined,            // -> hasResendKey false
            LICENSE_SIGNING_SECRET: undefined,    // -> hasLegacySigningSecret false and a forgeable PRO_ key
            ADMIN_TOKEN: undefined,               // -> /admin/report 503
        }, () => runVerifier([base, '--admin-token-env', TOKEN_ENV], { [TOKEN_ENV]: OWNER_TOKEN }));
        expect(r.code).toBe(1);
        const fail = lines(r.all, 'FAIL').join('\n');
        expect(fail).toMatch(/hasResendKey/);
        expect(fail).toMatch(/hasRZPSecret/);
        expect(fail).toMatch(/hasLegacySigningSecret/);
        expect(fail).toMatch(/hasAdminToken/);
        expect(fail).toMatch(/RAZORPAY_WEBHOOK_SECRET/);          // 503 on the webhook = secret unset
        expect(fail).toMatch(/ADMIN_TOKEN/);
        expect(fail).toMatch(/dev secret|forg/i);                // dev-secret PRO_ key accepted
        // the healthy parts still pass, so the owner can see what works
        const pass = lines(r.all, 'PASS').join('\n');
        expect(pass).toContain('/webhook/lemonsqueezy');
        expect(pass).toContain('/admin.html');
        expect(r.all).not.toContain(OWNER_TOKEN);
        expect(r.all).toMatch(/[1-9]\d* failed/);
    });

    it('fails when the admin token is wrong, without printing it', async () => {
        const wrong = 'wrong-token-0123456789abcdef';
        const r = await runVerifier([base, '--admin-token-env', TOKEN_ENV], { [TOKEN_ENV]: wrong });
        expect(r.code).toBe(1);
        expect(lines(r.all, 'FAIL').join('\n')).toMatch(/with the token/);
        expect(r.all).not.toContain(wrong);
        expect(r.all).not.toContain(OWNER_TOKEN);
    });

    it('fails (and does not echo the argument) when the named env var is not set', async () => {
        const r = await runVerifier([base, '--admin-token-env', 'SECRETLOOKING_value_123456']);
        expect(r.code).toBe(1);
        expect(lines(r.all, 'FAIL').join('\n')).toMatch(/admin/i);
        expect(r.all).not.toContain('SECRETLOOKING_value_123456');
    });

    it('fails every check against a server that says 200 to everything', async () => {
        const yes = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'application/json' }).end('{"ok":true,"env":{"hasX":true}}'); });
        const port = await listenInRange(yes);
        try {
            const r = await runVerifier([`http://127.0.0.1:${port}`, '--admin-token-env', TOKEN_ENV], { [TOKEN_ENV]: OWNER_TOKEN });
            expect(r.code).toBe(1);
            const fail = lines(r.all, 'FAIL').join('\n');
            for (const what of ['garbage', 'unsigned', 'telemetry', '/webhook/lemonsqueezy', '/webhook/razorpay', 'without a token']) {
                expect(fail, `expected FAIL for ${what}\n${r.all}`).toContain(what);
            }
            expect(r.all).not.toContain(OWNER_TOKEN);
        } finally { await closeServer(yes); }
    });

    it('fails cleanly when nothing is listening', async () => {
        const r = await runVerifier([`http://127.0.0.1:${await deadPort()}`]);
        expect(r.code).toBe(1);
        expect(lines(r.all, 'FAIL').length).toBeGreaterThan(0);
        expect(r.all).not.toMatch(/at .*\.js:\d+/); // no stack trace dump
    });

    it('prints usage and exits 2 without a base URL or with a bad one', async () => {
        for (const args of [[], ['not-a-url'], ['ftp://example.test']]) {
            const r = await runVerifier(args);
            expect(r.code, args.join(' ')).toBe(2);
            expect(r.all).toMatch(/usage/i);
        }
        expect((await runVerifier([base, '--admin-token-env'])).code).toBe(2);
    });

    it('handles a trailing slash on the base URL', async () => {
        const r = await runVerifier([`${base}/`]);
        expect(r.code, r.all).toBe(0);
    });
});
