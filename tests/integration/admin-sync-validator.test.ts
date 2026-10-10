/// <reference types="vite/client" />
/**
 * scripts/validate-admin-sync.js against a LOCAL FAKE vendor server.
 *
 * What is real here: the script itself (run as a child process, the way the owner will run it), the
 * compiled pollers inside packages/proxy/dist/syncValidate.js (syncUsage / syncCost, the response
 * normalisers, node-fetch), and a real SQLite database in a temp dir.
 *
 * What is faked: the vendors. A local HTTP server answers the four admin endpoints. Its bodies are
 * built from the SYNTHETIC fixtures in packages/proxy/src/__tests__/fixtures (written from the vendors'
 * published API docs, never captured from a live admin key), re-dated to "today" where a test needs
 * today's bucket, plus a few deliberately broken responses. So these tests prove the tool and the
 * code paths work end to end; they cannot prove the real vendors answer the way the docs say. That is
 * what running the script with a live key (docs/RELEASE_CHECKLIST.md) is for.
 *
 * Needs `npm run build:ci` (or `npm run build --workspace=@llm-observer/proxy`) first, like the rest of
 * tests/integration that runs against dist/.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';

const ROOT = path.resolve(__dirname, '../..');
const SCRIPT = path.join(ROOT, 'scripts/validate-admin-sync.js');
const DIST = path.join(ROOT, 'packages/proxy/dist/syncValidate.js');
const FIXTURES = path.join(ROOT, 'packages/proxy/src/__tests__/fixtures');
const RECORDED_DEFAULT = path.join(FIXTURES, 'recorded');
const nodeRequire = createRequire(__filename);

// Looks like a real admin key but is made up for these tests.
const A_KEY = 'sk-ant-admin01-TESTONLYkeyAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const O_KEY = 'sk-admin-TESTONLYkeyBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';

// -----------------------------------------------------------------------------
// Fake vendor server
// -----------------------------------------------------------------------------

interface Reply { status?: number; json?: unknown; raw?: string }
type Handler = (req: { n: number; url: URL; headers: http.IncomingHttpHeaders }) => Reply;
interface Seen { path: string; query: URLSearchParams; headers: http.IncomingHttpHeaders; method: string }

const PATHS = {
    aUsage: '/v1/organizations/usage_report/messages',
    aCost: '/v1/organizations/cost_report',
    oUsage: '/v1/organization/usage/completions',
    oCost: '/v1/organization/costs',
};

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

class FakeVendors {
    server = http.createServer((req, res) => this.handle(req, res));
    port = 0;
    seen: Seen[] = [];
    private handlers = new Map<string, Handler>();
    private counts = new Map<string, number>();

    async start() { this.port = await listenInRange(this.server); }
    stop() { return closeServer(this.server); }
    get base() { return `http://127.0.0.1:${this.port}`; }
    reset() { this.seen = []; this.handlers.clear(); this.counts.clear(); }
    on(p: string, h: Handler) { this.handlers.set(p, h); return this; }

    private handle(req: http.IncomingMessage, res: http.ServerResponse) {
        const url = new URL(req.url || '/', this.base);
        this.seen.push({ path: url.pathname, query: url.searchParams, headers: req.headers, method: req.method || '' });
        const h = this.handlers.get(url.pathname);
        if (!h) { res.writeHead(404, { 'content-type': 'application/json' }); res.end('{"error":"no route"}'); return; }
        const n = (this.counts.get(url.pathname) ?? 0) + 1;
        this.counts.set(url.pathname, n);
        const r = h({ n, url, headers: req.headers });
        if (r.raw !== undefined) { res.writeHead(r.status ?? 200, { 'content-type': 'text/html' }); res.end(r.raw); return; }
        res.writeHead(r.status ?? 200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(r.json));
    }
}

// -----------------------------------------------------------------------------
// Synthetic bodies (dates relative to now so "today" exists)
// -----------------------------------------------------------------------------

const DAY_MS = 86_400_000;
const utcMidnight = (offsetDays: number) => {
    const d = new Date(); d.setUTCHours(0, 0, 0, 0);
    return d.getTime() + offsetDays * DAY_MS;
};
const isoDay = (off: number) => new Date(utcMidnight(off)).toISOString().split('T')[0];
const rfc = (off: number) => `${isoDay(off)}T00:00:00Z`;
const epoch = (off: number) => utcMidnight(off) / 1000;

// Identifying values the redaction must remove from saved recordings.
const SECRET_STRINGS = [
    'apikey_01AbCdEfGhIjKlMnOpQr', 'wrkspc_01SecretWorkspaceName', 'alice@acme-corp.example', 'alice laptop key',
    'proj_AbCdEf123456SecretProj', 'user-ZzYyXx999SecretUser', 'key_abc123def456SecretKey', 'cursor_AbC123SecretLookingCursor',
    'org-AcmeCorpSecretOrg',
];

const aUsageResult = (model: string, i: number, o: number, cr: number, cw: number) => ({
    account_id: null,
    api_key_id: 'apikey_01AbCdEfGhIjKlMnOpQr',
    cache_creation: { ephemeral_1h_input_tokens: cw, ephemeral_5m_input_tokens: 0 },
    cache_read_input_tokens: cr,
    context_window: null,
    inference_geo: null,
    model,
    output_tokens: o,
    server_tool_use: { web_search_requests: 0 },
    service_account_id: null,
    service_tier: null,
    uncached_input_tokens: i,
    workspace_id: 'wrkspc_01SecretWorkspaceName',
    created_by_email: 'alice@acme-corp.example',
    api_key_name: 'alice laptop key',
});
const aCostResult = (model: string | null, cents: string, tokenType: string, desc: string) => ({
    amount: cents, context_window: null, cost_type: model ? 'tokens' : 'web_search', currency: 'USD', description: desc,
    inference_geo: null, model, service_tier: 'standard', token_type: model ? tokenType : null, workspace_id: 'wrkspc_01SecretWorkspaceName',
});
const aBucket = (off: number, results: unknown[]) => ({ starting_at: rfc(off), ending_at: rfc(off + 1), results });

const SONNET = 'claude-sonnet-4-20250514';
const HAIKU = 'claude-3-5-haiku-20241022';

/** Anthropic: usage over two pages (2 days, then today), cost in one page. Today has cost. */
function anthropicScenario(f: FakeVendors, opts: { cursor?: string } = {}) {
    const cursor = opts.cursor ?? 'cursor_AbC123SecretLookingCursor';
    f.on(PATHS.aUsage, ({ url }) => {
        if (!url.searchParams.has('page')) {
            return { json: { data: [aBucket(-2, [aUsageResult(SONNET, 10000, 5000, 2000, 500), aUsageResult(HAIKU, 3000, 800, 0, 0)]), aBucket(-1, [aUsageResult(SONNET, 700, 300, 0, 0)])], has_more: true, next_page: cursor } };
        }
        if (url.searchParams.get('page') !== cursor) return { status: 400, json: { error: 'bad cursor' } };
        return { json: { data: [aBucket(0, [aUsageResult(SONNET, 40, 20, 0, 0)])], has_more: false, next_page: null } };
    });
    f.on(PATHS.aCost, () => ({
        json: {
            data: [
                aBucket(-2, [aCostResult(SONNET, '150.5', 'uncached_input_tokens', 'Claude Sonnet 4 Usage - Input Tokens'), aCostResult(SONNET, '250', 'output_tokens', 'Claude Sonnet 4 Usage - Output Tokens'), aCostResult(HAIKU, '20', 'uncached_input_tokens', 'Claude 3.5 Haiku Usage - Input Tokens')]),
                aBucket(-1, [aCostResult(SONNET, '12', 'uncached_input_tokens', 'Claude Sonnet 4 Usage - Input Tokens')]),
                aBucket(0, [aCostResult(SONNET, '3.5', 'uncached_input_tokens', 'Claude Sonnet 4 Usage - Input Tokens')]),
            ],
            has_more: false, next_page: null,
        },
    }));
}

const oUsageResult = (model: string, i: number, o: number, cached: number, req: number) => ({
    object: 'organization.usage.completions.result', input_tokens: i, output_tokens: o, input_cached_tokens: cached,
    input_audio_tokens: 0, output_audio_tokens: 0, num_model_requests: req,
    project_id: 'proj_AbCdEf123456SecretProj', user_id: 'user-ZzYyXx999SecretUser', api_key_id: 'key_abc123def456SecretKey', model, batch: null,
});
const oCostResult = (lineItem: string, value: number) => ({
    object: 'organization.costs.result', amount: { value, currency: 'usd' }, line_item: lineItem, project_id: 'proj_AbCdEf123456SecretProj',
});
const oBucket = (off: number, results: unknown[]) => ({ object: 'bucket', start_time: epoch(off), end_time: epoch(off + 1), results });
const GPT = 'gpt-4o-2024-08-06';

/** OpenAI: usage over two pages, costs as "<model>, input" / "<model>, output" line items. */
function openaiScenario(f: FakeVendors, opts: { lineItemPrefix?: string } = {}) {
    const cursor = 'cursor_AbC123SecretLookingCursor';
    const li = (suffix: string) => `${opts.lineItemPrefix ?? ''}${GPT}, ${suffix}`;
    f.on(PATHS.oUsage, ({ url }) => {
        if (!url.searchParams.has('page')) return { json: { object: 'page', data: [oBucket(-1, [oUsageResult(GPT, 1000, 500, 800, 5)])], has_more: true, next_page: cursor } };
        if (url.searchParams.get('page') !== cursor) return { status: 400, json: { error: 'bad cursor' } };
        return { json: { object: 'page', data: [oBucket(0, [oUsageResult(GPT, 200, 100, 0, 2)])], has_more: false, next_page: null } };
    });
    f.on(PATHS.oCost, () => ({
        json: { object: 'page', data: [oBucket(-1, [oCostResult(li('input'), 0.04), oCostResult(li('output'), 0.02)]), oBucket(0, [oCostResult(li('input'), 0.01)])], has_more: false, next_page: null },
    }));
}

const fixture = (name: string) => JSON.parse(fs.readFileSync(path.join(FIXTURES, name), 'utf8'));

// -----------------------------------------------------------------------------
// Running the script
// -----------------------------------------------------------------------------

interface RunResult { code: number; stdout: string; stderr: string }

function run(args: string[], env: Record<string, string>, tmp: string): Promise<RunResult> {
    // Explicit environment: nothing from the runner's own env (which could hold real keys) is inherited.
    const fullEnv: Record<string, string> = { PATH: process.env.PATH || '', HOME: tmp, TMPDIR: tmp, TEMP: tmp, TMP: tmp, ...env };
    return new Promise(resolve => {
        execFile(process.execPath, [SCRIPT, ...args], { env: fullEnv, timeout: 90_000, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
            const code = err ? ((err as any).code as number) ?? 1 : 0;
            resolve({ code: typeof code === 'number' ? code : 1, stdout, stderr });
        });
    });
}

/** All regular files under a directory, recursively (the temp DB, saved recordings, ...). */
function walk(dir: string): string[] {
    const out: string[] = [];
    if (!fs.existsSync(dir)) return out;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) out.push(...walk(p)); else out.push(p);
    }
    return out;
}
function filesContaining(dir: string, needle: string): string[] {
    return walk(dir).filter(f => fs.readFileSync(f).includes(needle));
}

// -----------------------------------------------------------------------------

describe('scripts/validate-admin-sync.js against a fake vendor server', () => {
    const fake = new FakeVendors();
    let tmp: string;
    let recordedBefore: string[];

    const envFor = (extra: Record<string, string> = {}) => ({
        ANTHROPIC_ADMIN_KEY: A_KEY,
        OPENAI_ADMIN_KEY: O_KEY,
        LLM_OBSERVER_ANTHROPIC_ADMIN_BASE_URL: fake.base,
        LLM_OBSERVER_OPENAI_ADMIN_BASE_URL: fake.base,
        ...extra,
    });
    const onlyAnthropic = (extra: Record<string, string> = {}) => { const e = envFor(extra); delete (e as any).OPENAI_ADMIN_KEY; return e; };
    const onlyOpenAI = (extra: Record<string, string> = {}) => { const e = envFor(extra); delete (e as any).ANTHROPIC_ADMIN_KEY; return e; };

    /** The key must not be anywhere a user or a repo could see it. */
    function expectNoKey(r: RunResult) {
        for (const k of [A_KEY, O_KEY]) {
            expect(r.stdout).not.toContain(k);
            expect(r.stderr).not.toContain(k);
            expect(filesContaining(tmp, k)).toEqual([]);
        }
    }

    beforeAll(async () => {
        expect(fs.existsSync(DIST), `${DIST} missing: run "npm run build:ci" first`).toBe(true);
        await fake.start();
        recordedBefore = fs.readdirSync(RECORDED_DEFAULT).sort();
    });
    afterAll(async () => {
        await fake.stop();
        // Nothing in the tests may have written into the repo's recorded/ directory.
        expect(fs.readdirSync(RECORDED_DEFAULT).sort()).toEqual(recordedBefore);
    });
    beforeEach(() => {
        fake.reset();
        tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'validate-admin-sync-test-'));
    });
    afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

    // ---- PASS paths ----------------------------------------------------------

    it('Anthropic, documented nested shape, paginated, today included: PASS, exit 0', async () => {
        anthropicScenario(fake);
        const out = path.join(tmp, 'rec');
        const r = await run(['--save', '--out-dir', out, '--keep-db'], onlyAnthropic(), tmp);

        expect(r.stderr).toBe('');
        expect(r.code).toBe(0);
        expect(r.stdout).toMatch(/^# Admin-API sync validation: PASS/m);
        expect(r.stdout).toMatch(/^## Anthropic: PASS/m);
        expect(r.stdout).toMatch(/^## OpenAI: not run/m);
        expect(r.stdout).toMatch(/\| Requests succeeded \| PASS \|/);
        expect(r.stdout).toMatch(/\| Response shape recognised \| PASS \|[^\n]*usage page 1: data, has_more, next_page/);
        expect(r.stdout).toMatch(/\| Pagination followed \| PASS \| usage: 2 pages/);
        expect(r.stdout).toMatch(/\| Rows stored \| PASS \| 4 usage_records rows/);
        expect(r.stdout).toMatch(/\| Tokens per day match the raw responses \| PASS \|/);
        expect(r.stdout).toMatch(/\| USD per day match the raw responses \| PASS \|/);
        expect(r.stdout).toMatch(/\| Cost stamped on every usage row \| PASS \|/);
        expect(r.stdout).toMatch(/\| Today's bucket has cost \| PASS \|/);
        expect(r.stdout).toMatch(/\| Second poll adds no rows \| PASS \| second poll added 0 rows \(4 -> 4\)/);
        // Per-day table: independent raw sums against stored.
        expect(r.stdout).toContain(`| ${isoDay(-2)} | 13000/5800/2000/500 | 13000/5800/2000/500 | 4.205000 | 4.205000 | PASS |`);
        expect(r.stdout).toContain(`| ${isoDay(0)} | 40/20/0/0 | 40/20/0/0 | 0.035000 | 0.035000 | PASS |`);
        // Checklist row to paste.
        // A run against a fake server is loudly NOT a live run and offers nothing to paste into the checklist.
        expect(r.stdout).toMatch(/NOT A LIVE-VENDOR RUN/);
        expect(r.stdout).toMatch(/Nothing to paste: this was not a live-vendor run/);
        expect(r.stdout).not.toMatch(/<your name>/);

        // The requests were the pollers' own, read-only, with the key only in the vendor's header.
        expect(fake.seen.every(s => s.method === 'GET')).toBe(true);
        expect(fake.seen.filter(s => s.path === PATHS.aUsage).length).toBe(4); // 2 pages x 2 polls
        for (const s of fake.seen) {
            expect(s.headers['x-api-key']).toBe(A_KEY);
            expect(s.headers['anthropic-version']).toBe('2023-06-01');
        }
        expect(fake.seen.find(s => s.path === PATHS.aUsage)!.query.get('group_by[]')).toBe('model');
        expect(fake.seen.find(s => s.path === PATHS.aCost)!.query.get('group_by[]')).toBe('description');
        expect(fake.seen.some(s => s.path.includes('openai') || s.path === PATHS.oUsage)).toBe(false);

        // Recordings: saved, redacted, labelled as NOT a vendor recording (override base URL).
        const dir = path.join(out, `anthropic-${isoDay(0)}`);
        expect(fs.readdirSync(dir).sort()).toEqual(['cost-1.json', 'meta.json', 'usage-1.json', 'usage-2.json']);
        const meta = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8'));
        expect(meta.provider).toBe('anthropic');
        expect(meta.source).toMatch(/NOT a vendor recording/);
        expect(meta.pages).toEqual({ usage: 2, cost: 1 });
        expect(JSON.stringify(meta)).not.toContain(A_KEY);

        const saved = Object.fromEntries(['usage-1', 'usage-2', 'cost-1'].map(n => [n, fs.readFileSync(path.join(dir, `${n}.json`), 'utf8')]));
        for (const text of Object.values(saved)) {
            for (const secret of SECRET_STRINGS) expect(text).not.toContain(secret);
            expect(text).not.toMatch(/@acme-corp/);
        }
        // Every number and the shape survive redaction.
        const u1 = JSON.parse(saved['usage-1']);
        expect(Object.keys(u1)).toEqual(['data', 'has_more', 'next_page']);
        expect(u1.has_more).toBe(true);
        expect(typeof u1.next_page).toBe('string');
        expect(u1.next_page).not.toBe('cursor_AbC123SecretLookingCursor');
        expect(u1.data[0].results[0].uncached_input_tokens).toBe(10000);
        expect(u1.data[0].results[0].cache_creation.ephemeral_1h_input_tokens).toBe(500);
        expect(u1.data[0].results[0].model).toBe(SONNET);
        expect(u1.data[0].results[0].api_key_id).toMatch(/fake/i);
        // Same real id -> same fake id, across results and across files.
        expect(u1.data[0].results[1].api_key_id).toBe(u1.data[0].results[0].api_key_id);
        expect(JSON.parse(saved['usage-2']).data[0].results[0].api_key_id).toBe(u1.data[0].results[0].api_key_id);
        const c1 = JSON.parse(saved['cost-1']);
        expect(c1.data[0].results[0].amount).toBe('150.5');
        expect(c1.data[0].results[0].description).toBe('Claude Sonnet 4 Usage - Input Tokens');

        // The real normalisers accept the redacted recordings (what the conformance test will do).
        const mod = nodeRequire(DIST);
        expect(() => mod.normalizeAnthropicUsage(u1)).not.toThrow();
        expect(() => mod.normalizeAnthropicUsage(JSON.parse(saved['usage-2']))).not.toThrow();
        expect(mod.normalizeAnthropicCost(c1).length).toBeGreaterThan(0);

        expectNoKey(r);
        // --keep-db leaves the temp database for inspection; the key is not in it.
        expect(walk(tmp).some(f => f.endsWith('data.db'))).toBe(true);
    }, 60_000);

    it('Anthropic, flat (legacy) shape: PASS; missing today bucket is a WARN, not a failure', async () => {
        fake.on(PATHS.aUsage, () => ({ json: fixture('anthropic-usage-report.flat.json') }));
        fake.on(PATHS.aCost, () => ({ json: fixture('anthropic-cost-report.flat.json') }));
        const r = await run([], onlyAnthropic(), tmp);

        expect(r.code).toBe(0);
        expect(r.stdout).toMatch(/^## Anthropic: PASS/m);
        expect(r.stdout).toMatch(/\| Rows stored \| PASS \| 1 usage_records row/);
        expect(r.stdout).toContain('| 2026-07-01 | 10000/5000/2000/500 | 10000/5000/2000/500 | 4.000000 | 4.000000 | PASS |');
        expect(r.stdout).toMatch(/\| Today's bucket has cost \| WARN \|/);
        expect(r.stdout).toMatch(/\| Second poll adds no rows \| PASS \|/);
        expectNoKey(r);
    }, 60_000);

    it('Anthropic nested fixture verbatim: non-model cost lines (web search) are a WARN naming the amount', async () => {
        fake.on(PATHS.aUsage, () => ({ json: fixture('anthropic-usage-report.nested.json') }));
        fake.on(PATHS.aCost, () => ({ json: fixture('anthropic-cost-report.nested.json') }));
        const r = await run([], onlyAnthropic(), tmp);

        expect(r.code).toBe(0);
        expect(r.stdout).toMatch(/\| USD per day match the raw responses \| WARN \|[^\n]*0\.05/);
        expect(r.stdout).toContain('| 2026-07-01 | 13000/5800/2000/500 | 13000/5800/2000/500 | 4.255000 | 4.205000 | WARN |');
    }, 60_000);

    it('OpenAI nested, paginated, cost line items "<model>, input/output": PASS', async () => {
        openaiScenario(fake);
        const r = await run(['--keep-db'], onlyOpenAI(), tmp);

        expect(r.code).toBe(0);
        expect(r.stdout).toMatch(/^## OpenAI: PASS/m);
        expect(r.stdout).toMatch(/^## Anthropic: not run/m);
        expect(r.stdout).toMatch(/\| Pagination followed \| PASS \| usage: 2 pages/);
        expect(r.stdout).toMatch(/\| Rows stored \| PASS \| 2 usage_records rows/);
        // OpenAI input_tokens already include the cached ones; total = input + output.
        expect(r.stdout).toContain(`| ${isoDay(-1)} | 1000/500/800/0 | 1000/500/800/0 | 0.060000 | 0.060000 | PASS |`);
        expect(r.stdout).toMatch(/\| Today's bucket has cost \| PASS \|/);
        for (const s of fake.seen) expect(s.headers.authorization).toBe(`Bearer ${O_KEY}`);
        expect(fake.seen.find(s => s.path === PATHS.oUsage)!.query.get('group_by[]')).toBe('model');
        expect(fake.seen.find(s => s.path === PATHS.oCost)!.query.get('group_by[]')).toBe('line_item');
        expectNoKey(r);
    }, 60_000);

    it('OpenAI flat fixtures: PASS', async () => {
        fake.on(PATHS.oUsage, () => ({ json: fixture('openai-usage-completions.flat.json') }));
        fake.on(PATHS.oCost, () => ({ json: fixture('openai-costs.flat.json') }));
        const r = await run([], onlyOpenAI(), tmp);
        expect(r.code).toBe(0);
        expect(r.stdout).toMatch(/^## OpenAI: PASS/m);
        expect(r.stdout).toContain('| 2026-07-01 | 1000/500/800/0 | 1000/500/800/0 | 0.060000 | 0.060000 | PASS |');
    }, 60_000);

    it('runs both providers in one invocation', async () => {
        anthropicScenario(fake);
        openaiScenario(fake);
        const r = await run([], envFor(), tmp);
        expect(r.code).toBe(0);
        expect(r.stdout).toMatch(/^# Admin-API sync validation: PASS/m);
        expect(r.stdout).toMatch(/^## Anthropic: PASS/m);
        expect(r.stdout).toMatch(/^## OpenAI: PASS/m);
        expectNoKey(r);
    }, 60_000);

    // ---- FAIL paths ----------------------------------------------------------

    it('HTTP 401 (and a body that echoes the key): FAIL, exit 1, key never printed', async () => {
        fake.on(PATHS.aUsage, () => ({ status: 401, json: { type: 'error', error: { type: 'authentication_error', message: `invalid x-api-key ${A_KEY}` } } }));
        fake.on(PATHS.aCost, () => ({ status: 401, json: { error: 'unauthorized' } }));
        fake.on(PATHS.oUsage, () => ({ status: 401, json: { error: { message: `Incorrect API key provided: ${O_KEY}.` } } }));
        fake.on(PATHS.oCost, () => ({ status: 401, json: { error: 'unauthorized' } }));
        const r = await run(['--save', '--out-dir', path.join(tmp, 'rec')], envFor(), tmp);

        expect(r.code).toBe(1);
        expect(r.stdout).toMatch(/^# Admin-API sync validation: FAIL/m);
        expect(r.stdout).toMatch(/^## Anthropic: FAIL/m);
        expect(r.stdout).toMatch(/^## OpenAI: FAIL/m);
        expect(r.stdout).toMatch(/\| Requests succeeded \| FAIL \|[^\n]*HTTP 401/);
        expect(r.stdout).toMatch(/key was rejected/i);
        expect(r.stdout).toMatch(/\| Rows stored \| FAIL \| 0 usage_records rows/);
        expect(r.stdout).toContain('[redacted]');
        expectNoKey(r);
        // Error bodies are never saved as recordings.
        expect(walk(path.join(tmp, 'rec')).filter(f => /usage-|cost-/.test(f))).toEqual([]);
    }, 60_000);

    it('a response that is JSON but not a known shape: rejected, FAIL, exact top-level keys, nothing stored', async () => {
        fake.on(PATHS.aUsage, () => ({ json: { data: { oops: true }, request_id: 'req_1', version: 3 } }));
        fake.on(PATHS.aCost, () => ({ json: { data: [], has_more: false } }));
        const r = await run(['--save', '--out-dir', path.join(tmp, 'rec')], onlyAnthropic(), tmp);

        expect(r.code).toBe(1);
        expect(r.stdout).toMatch(/\| Response shape recognised \| FAIL \|[^\n]*Unrecognised Anthropic usage report response/);
        expect(r.stdout).toMatch(/top-level keys seen \(usage page 1\): data, request_id, version/);
        expect(r.stdout).toMatch(/\| Rows stored \| FAIL \| 0 usage_records rows/);
        // The unrecognised body IS saved (redacted) so the normaliser can be fixed against it.
        const dir = path.join(tmp, 'rec', `anthropic-${isoDay(0)}`);
        expect(JSON.parse(fs.readFileSync(path.join(dir, 'usage-1.json'), 'utf8')).version).toBe(3);
        expectNoKey(r);
    }, 60_000);

    it('a 200 response that is not JSON at all (maintenance page): FAIL', async () => {
        fake.on(PATHS.oUsage, () => ({ raw: '<html><body>Down for maintenance</body></html>' }));
        fake.on(PATHS.oCost, () => ({ json: { data: [], has_more: false } }));
        const r = await run(['--save', '--out-dir', path.join(tmp, 'rec')], onlyOpenAI(), tmp);
        expect(r.code).toBe(1);
        expect(r.stdout).toMatch(/\| Response shape recognised \| FAIL \|[^\n]*not JSON/);
        expect(r.stdout).toMatch(/top-level keys seen \(usage page 1\): \(not JSON\)/);
        expect(walk(path.join(tmp, 'rec')).filter(f => /usage-/.test(f))).toEqual([]);
    }, 60_000);

    it('a cost report that fails (the poller swallows it): FAIL, because costs were never synced', async () => {
        anthropicScenario(fake);
        fake.on(PATHS.aCost, () => ({ status: 500, json: { error: 'boom' } }));
        const r = await run([], onlyAnthropic(), tmp);
        expect(r.code).toBe(1);
        expect(r.stdout).toMatch(/\| Requests succeeded \| FAIL \|[^\n]*cost[^\n]*HTTP 500/i);
        expect(r.stdout).toMatch(/\| Cost stamped on every usage row \| FAIL \|/);
    }, 60_000);

    it('OpenAI costs endpoint 404 (poller falls back to token estimates): FAIL, not vendor costs', async () => {
        openaiScenario(fake);
        fake.on(PATHS.oCost, () => ({ status: 404, json: { error: 'not found' } }));
        const r = await run([], onlyOpenAI(), tmp);
        expect(r.code).toBe(1);
        expect(r.stdout).toMatch(/\| Requests succeeded \| FAIL \|[^\n]*HTTP 404/);
        expect(r.stdout).toMatch(/estimat/i);
    }, 60_000);

    it('OpenAI cost line items that do not name the usage models: costs are never stamped -> FAIL', async () => {
        openaiScenario(fake, { lineItemPrefix: 'renamed-' });
        const r = await run([], onlyOpenAI(), tmp);
        expect(r.code).toBe(1);
        expect(r.stdout).toMatch(/\| Cost stamped on every usage row \| FAIL \|/);
        expect(r.stdout).toMatch(/\| USD per day match the raw responses \| FAIL \|/);
        expect(r.stdout).toMatch(/renamed-gpt-4o-2024-08-06/); // the unmatched line item is named
        expect(r.stdout).toContain(`| ${isoDay(-1)} | 1000/500/800/0 | 1000/500/800/0 | 0.060000 | 0.000000 | FAIL |`);
    }, 60_000);

    it('a second poll that adds rows (bucket timestamps that are not stable) is detected: FAIL', async () => {
        // Same bucket, spelled differently on the second poll: the pollers key rows on the exact text.
        let usageCalls = 0;
        fake.on(PATHS.aUsage, () => {
            usageCalls++;
            const start = usageCalls === 1 ? rfc(-1) : `${isoDay(-1)}T00:00:00.000Z`;
            return { json: { data: [{ starting_at: start, ending_at: rfc(0), results: [aUsageResult(SONNET, 5, 5, 0, 0)] }], has_more: false, next_page: null } };
        });
        fake.on(PATHS.aCost, () => ({ json: { data: [aBucket(-1, [aCostResult(SONNET, '100', 'uncached_input_tokens', 'Claude Sonnet 4 Usage - Input Tokens')])], has_more: false } }));
        const r = await run([], onlyAnthropic(), tmp);
        expect(r.code).toBe(1);
        expect(r.stdout).toMatch(/\| Second poll adds no rows \| FAIL \| second poll added 1 row \(1 -> 2\)/);
    }, 60_000);

    it('a has_more page without next_page is reported as a pagination FAIL', async () => {
        fake.on(PATHS.aUsage, () => ({ json: { data: [aBucket(-1, [aUsageResult(SONNET, 5, 5, 0, 0)])], has_more: true, next_page: null } }));
        fake.on(PATHS.aCost, () => ({ json: { data: [], has_more: false } }));
        const r = await run([], onlyAnthropic(), tmp);
        expect(r.code).toBe(1);
        expect(r.stdout).toMatch(/\| Pagination followed \| FAIL \|[^\n]*has_more/);
    }, 60_000);

    it('an unreachable vendor host: FAIL with the network error, exit 1', async () => {
        const dead = http.createServer();
        const port = await listenInRange(dead);
        await closeServer(dead);
        const r = await run([], onlyAnthropic({ LLM_OBSERVER_ANTHROPIC_ADMIN_BASE_URL: `http://127.0.0.1:${port}` }), tmp);
        expect(r.code).toBe(1);
        expect(r.stdout).toMatch(/\| Requests succeeded \| FAIL \|[^\n]*(ECONNREFUSED|network)/i);
        expectNoKey(r);
    }, 60_000);

    it('--strict turns WARN into FAIL', async () => {
        fake.on(PATHS.aUsage, () => ({ json: fixture('anthropic-usage-report.flat.json') }));
        fake.on(PATHS.aCost, () => ({ json: fixture('anthropic-cost-report.flat.json') }));
        const r = await run(['--strict'], onlyAnthropic(), tmp);
        expect(r.code).toBe(1);
        expect(r.stdout).toMatch(/^# Admin-API sync validation: FAIL/m);
    }, 60_000);

    // ---- usage / safety ------------------------------------------------------

    it('without any key in the environment: usage error, exit 2, names the variables', async () => {
        const r = await run([], { LLM_OBSERVER_ANTHROPIC_ADMIN_BASE_URL: fake.base }, tmp);
        expect(r.code).toBe(2);
        expect(r.stderr).toContain('ANTHROPIC_ADMIN_KEY');
        expect(r.stderr).toContain('OPENAI_ADMIN_KEY');
        expect(fake.seen).toEqual([]);
    });

    it('a key given on the command line is refused and never echoed', async () => {
        for (const args of [[`--key=${A_KEY}`], ['--anthropic-key', A_KEY], [A_KEY]]) {
            const r = await run(args, onlyAnthropic(), tmp);
            expect(r.code).toBe(2);
            expect(r.stdout + r.stderr).not.toContain(A_KEY);
            expect(r.stderr).toMatch(/environment/i);
        }
        expect(fake.seen).toEqual([]);
    });

    it('refuses plain http to a non-loopback host before sending any request (the key would travel in clear text)', async () => {
        const r = await run([], onlyAnthropic({ LLM_OBSERVER_ANTHROPIC_ADMIN_BASE_URL: 'http://api.anthropic.com.evil.example' }), tmp);
        expect(r.code).toBe(2);
        expect(r.stderr).toMatch(/https/);
        expectNoKey(r);
    });

    it('refuses to save non-vendor responses into the repo recorded/ directory', async () => {
        anthropicScenario(fake);
        const r = await run(['--save'], onlyAnthropic(), tmp);
        expect(r.code).toBe(2);
        expect(r.stderr).toMatch(/--out-dir/);
        expect(fake.seen).toEqual([]);
        expect(fs.readdirSync(RECORDED_DEFAULT).sort()).toEqual(recordedBefore);
    });

    it.each([['0'], ['32'], ['abc'], ['1.5']])('--days %s is a usage error', async (days) => {
        const r = await run(['--days', days], onlyAnthropic(), tmp);
        expect(r.code).toBe(2);
        expect(r.stderr).toMatch(/--days/);
    });

    it('--help prints usage, exit 0, and needs no key', async () => {
        const r = await run(['--help'], {}, tmp);
        expect(r.code).toBe(0);
        expect(r.stdout).toContain('ANTHROPIC_ADMIN_KEY');
    });
});

// -----------------------------------------------------------------------------
// Redaction, as a unit
// -----------------------------------------------------------------------------

describe('scripts/validate-admin-sync.js redaction', () => {
    const mod = nodeRequire(SCRIPT);

    it('replaces ids, emails and names with stable fakes and keeps every number, key and the shape', () => {
        const r = mod.createRedactor();
        const input = {
            object: 'page',
            data: [{
                start_time: 1782864000,
                results: [
                    { project_id: 'proj_real1', user_id: 'user-real2', api_key_id: 'key_real3', model: 'gpt-4o', input_tokens: 12, ratio: 0.5, flag: true, none: null, batch: null },
                    { project_id: 'proj_real1', user_id: 'user-other', api_key_id: 'key_real3', model: 'gpt-4o', input_tokens: 7 },
                ],
            }],
            has_more: true,
            next_page: 'page_opaque_real',
        };
        const out = r.redact(input);
        const text = JSON.stringify(out);
        for (const s of ['proj_real1', 'user-real2', 'key_real3', 'user-other', 'page_opaque_real']) expect(text).not.toContain(s);
        expect(out.data[0].start_time).toBe(1782864000);
        expect(out.data[0].results[0].input_tokens).toBe(12);
        expect(out.data[0].results[0].ratio).toBe(0.5);
        expect(out.data[0].results[0].flag).toBe(true);
        expect(out.data[0].results[0].none).toBeNull();
        expect(out.data[0].results[0].model).toBe('gpt-4o');
        expect(Object.keys(out.data[0].results[0])).toEqual(Object.keys(input.data[0].results[0]));
        // stable: same real value -> same fake; different real values -> different fakes
        expect(out.data[0].results[1].project_id).toBe(out.data[0].results[0].project_id);
        expect(out.data[0].results[1].user_id).not.toBe(out.data[0].results[0].user_id);
        expect(r.redact(input)).toEqual(out); // and stable across calls
    });

    it('redacts emails and key-like strings wherever they appear, and fine-tune model names', () => {
        const r = mod.createRedactor();
        const out = r.redact({
            data: [{ description: 'Usage for bob@corp.example (sk-ant-admin01-abcdefghijklmnop)', model: 'ft:gpt-4o-mini:acme-corp:support-bot:AbC123', unknown_field: 'something private', amount: '12.50', currency: 'USD', starting_at: '2026-07-01T00:00:00Z' }],
        });
        const text = JSON.stringify(out);
        expect(text).not.toContain('bob@corp.example');
        expect(text).not.toContain('sk-ant-admin01');
        expect(text).not.toContain('acme-corp');
        expect(text).not.toContain('support-bot');
        expect(text).not.toContain('something private');
        expect(out.data[0].model).toMatch(/^ft:gpt-4o-mini:/);
        expect(out.data[0].amount).toBe('12.50');
        expect(out.data[0].currency).toBe('USD');
        expect(out.data[0].starting_at).toBe('2026-07-01T00:00:00Z');
    });

    it('verify() refuses output that still holds an original value, an email or a key', () => {
        const r = mod.createRedactor();
        r.redact({ api_key_id: 'key_ABCDEFGH' });
        expect(() => r.verify('{"x":"key_ABCDEFGH"}', [])).toThrow(/redaction/i);
        expect(() => r.verify('{"x":"a@b.example"}', [])).toThrow(/redaction/i);
        expect(() => r.verify('{"x":"sk-abcdef123456"}', [])).toThrow(/redaction/i);
        expect(() => r.verify('{"x":"hello SECRETKEY99"}', ['SECRETKEY99'])).toThrow(/redaction/i);
        expect(() => r.verify('{"x":"api_key_id_fake_1"}', ['SECRETKEY99'])).not.toThrow();
    });

    it('scrub() removes the key, key-shaped strings and bearer tokens from any text', () => {
        const s = mod.makeScrubber(['sk-ant-admin01-REALKEYVALUE1234567890']);
        const out = s('boom sk-ant-admin01-REALKEYVALUE1234567890 and Bearer abc.def-ghi and sk-adm****wxyz and x-api-key: zzzz');
        expect(out).not.toContain('REALKEYVALUE');
        expect(out).not.toContain('abc.def-ghi');
        expect(out).not.toContain('sk-adm****wxyz');
        expect(out).toContain('[redacted]');
    });
});

describe('scripts/validate-admin-sync.js checklist lines', () => {
    const mod = nodeRequire(SCRIPT);
    const check = (name: string, status: string) => ({ name, status, detail: 'x' });
    const base = {
        today: '2026-10-08', startDay: '2026-10-06', days: 3, version: '2.0.2', notRun: [] as string[],
        baseNotes: ['Anthropic https://api.anthropic.com (default)'], opts: { save: true, strict: false }, tempDbPath: null, anyOverride: false,
    };

    it('a live PASS prints the row to paste, with the recording directory and the git add line', () => {
        const dir = path.join(ROOT, 'packages/proxy/src/__tests__/fixtures/recorded/anthropic-2026-10-08');
        const text = mod.renderReport({
            ...base,
            notRun: ['openai'],
            results: [{ provider: 'anthropic', status: 'PASS', checks: [check('Requests succeeded', 'PASS')], dayTable: [], rows: 5, days: 3, pollerLog: [], recording: { dir, files: ['usage-1.json'], error: null } }],
        });
        expect(text).toMatch(/^# Admin-API sync validation: PASS/m);
        expect(text).not.toMatch(/NOT A LIVE-VENDOR RUN/);
        expect(text).toContain('| 2026-10-08 | <your name> | PASS (3 days, 5 rows, tokens and attributable USD match the raw responses) | not run | validate-admin-sync.js 2.0.2; recordings: packages/proxy/src/__tests__/fixtures/recorded/anthropic-2026-10-08 |');
        expect(text).toContain('git add packages/proxy/src/__tests__/fixtures/recorded/anthropic-2026-10-08');
        expect(text).toMatch(/Compare the per-day USD/);
    });

    it('a FAIL names the failing checks in the row', () => {
        const text = mod.renderReport({
            ...base,
            notRun: ['anthropic'],
            opts: { save: false, strict: false },
            results: [{ provider: 'openai', status: 'FAIL', checks: [check('Requests succeeded', 'PASS'), check('Cost stamped on every usage row', 'FAIL')], dayTable: [], rows: 1, days: 1, pollerLog: [], recording: null }],
        });
        expect(text).toMatch(/^# Admin-API sync validation: FAIL/m);
        expect(text).toContain('| not run | FAIL (Cost stamped on every usage row) |');
        expect(text).toMatch(/line_item\` names match the usage \`model\` names: NO/);
        expect(text).toMatch(/No recordings were saved/);
    });

    it('a run with a base URL override never produces a row', () => {
        const text = mod.renderReport({ ...base, anyOverride: true, results: [{ provider: 'anthropic', status: 'PASS', checks: [], dayTable: [], rows: 1, days: 1, pollerLog: [], recording: null }] });
        expect(text).toMatch(/NOT A LIVE-VENDOR RUN/);
        expect(text).not.toContain('<your name>');
    });
});
