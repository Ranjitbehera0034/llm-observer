/**
 * Integration tests for the OTLP receiver: a real http server on a loopback port, a real migrated SQLite
 * database file, the real Claude Code log parser reading a log file from a temp HOME.
 * Payloads are the recordings in fixtures/otlp (Claude Code 2.1.294) unless a test says "synthetic".
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import zlib from 'zlib';
import { initDb, closeDb, getDb, updateSetting } from '@llm-observer/database';
import { createOtlpManager, OTLP_SETTING, DEFAULT_OTLP_PORT, MAX_BODY_BYTES, resolveOtlpPort, OtlpManager } from '../manager';
import * as claudeParser from '../../parsers/claude';
import {
    loadFixture, fixturePath, postJson, send, isListening, freePort, apiRequestLogs, gzipJson,
    DELTA_SESSION, CUMULATIVE_SESSION,
} from './helpers';

let tmp: string;
let manager: OtlpManager | null = null;
let port: number;
let home: string;

const sessionRows = (sessionId: string) =>
    getDb().prepare(`SELECT * FROM sessions WHERE provider = 'claude-code' AND session_id = ?`).all(sessionId) as any[];
const onlySession = (sessionId: string) => {
    const rows = sessionRows(sessionId);
    expect(rows).toHaveLength(1);
    return rows[0];
};
const tokens = (r: any) => [r.input_tokens, r.output_tokens, r.cache_read_tokens, r.cache_write_tokens];

async function startReceiver() {
    port = await freePort();
    manager = createOtlpManager({ port });
    updateSetting(OTLP_SETTING, 'true');
    await manager.reconcile();
    expect(await isListening(port)).toBe(true);
}

beforeEach(() => {
    closeDb();
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'llmo-otlp-'));
    jest.spyOn(console, 'log').mockImplementation(() => {});
    initDb(path.join(tmp, 'data.db'));
    // The parser finds the logs through os.homedir(); Jest's process.env is a copy, so mock the call itself.
    home = path.join(tmp, 'home');
    fs.mkdirSync(home, { recursive: true });
    jest.spyOn(os, 'homedir').mockReturnValue(home);
});

afterEach(async () => {
    if (manager) { await manager.stop(); manager = null; }
    closeDb();
    jest.restoreAllMocks();
});

describe('opt-in lifecycle', () => {
    it('defaults to port 4318 and honours LLM_OBSERVER_OTLP_PORT', () => {
        expect(DEFAULT_OTLP_PORT).toBe(4318);
        expect(resolveOtlpPort({})).toBe(4318);
        expect(resolveOtlpPort({ LLM_OBSERVER_OTLP_PORT: '16215' })).toBe(16215);
        expect(resolveOtlpPort({ LLM_OBSERVER_OTLP_PORT: 'banana' })).toBe(4318);
        expect(resolveOtlpPort({ LLM_OBSERVER_OTLP_PORT: '70000' })).toBe(4318);
    });

    it('is OFF by default: nothing listens until the setting is "true"', async () => {
        port = await freePort();
        manager = createOtlpManager({ port });
        await manager.reconcile();
        expect(manager.status().listening).toBe(false);
        expect(await isListening(port)).toBe(false);

        updateSetting(OTLP_SETTING, 'false');
        await manager.reconcile();
        expect(await isListening(port)).toBe(false);
    });

    it('starts and stops at runtime when the setting flips, binding 127.0.0.1 only', async () => {
        await startReceiver();
        expect(manager!.status()).toMatchObject({ listening: true, host: '127.0.0.1', port });
        expect((await send(port, { method: 'GET', path: '/health' })).status).toBe(200);

        updateSetting(OTLP_SETTING, 'false');
        await manager!.reconcile();
        expect(manager!.status().listening).toBe(false);
        expect(await isListening(port)).toBe(false);

        updateSetting(OTLP_SETTING, 'true');
        await manager!.reconcile();
        expect(await isListening(port)).toBe(true);
    });

    it('reconcile is idempotent and reports a busy port instead of throwing', async () => {
        await startReceiver();
        await manager!.reconcile();
        await manager!.reconcile();
        expect(await isListening(port)).toBe(true);

        const second = createOtlpManager({ port });
        await second.reconcile();
        expect(second.status().listening).toBe(false);
        expect(second.status().lastError).toMatch(/already in use|EADDRINUSE/i);
        await second.stop();
    });
});

describe('request hygiene', () => {
    beforeEach(startReceiver);

    it('rejects any request with an Origin header (403), even a same-looking one', async () => {
        for (const origin of ['https://evil.example', 'http://localhost:3000', 'null']) {
            const r = await postJson(port, '/v1/logs', {}, { Origin: origin });
            expect(r.status).toBe(403);
        }
        expect((await send(port, { method: 'OPTIONS', path: '/v1/logs', headers: { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'POST' } })).status).toBe(403);
        expect((await postJson(port, '/v1/logs', {}, { 'Sec-Fetch-Site': 'cross-site' })).status).toBe(403);
    });

    it('rejects a non-loopback Host with 421 (DNS rebinding)', async () => {
        const r = await postJson(port, '/v1/logs', {}, { Host: `attacker.example:${port}` });
        expect(r.status).toBe(421);
        expect((await postJson(port, '/v1/logs', {}, { Host: `localhost:${port}` })).status).toBe(200);
        expect((await postJson(port, '/v1/logs', {}, { Host: `[::1]:${port}` })).status).toBe(200);
    });

    it('answers http/protobuf with 415 and tells the user which env var to set', async () => {
        const r = await send(port, { path: '/v1/metrics', headers: { 'Content-Type': 'application/x-protobuf' }, body: Buffer.from([0x0a, 0x00]) });
        expect(r.status).toBe(415);
        expect(r.body).toContain('OTEL_EXPORTER_OTLP_PROTOCOL=http/json');
        expect((await send(port, { path: '/v1/logs', headers: { 'Content-Type': 'text/plain' }, body: 'x' })).status).toBe(415);
    });

    it('returns 400 for invalid JSON, 405 for wrong methods, 404 for unknown paths', async () => {
        expect((await send(port, { path: '/v1/logs', headers: { 'Content-Type': 'application/json' }, body: '{not json' })).status).toBe(400);
        expect((await send(port, { method: 'GET', path: '/v1/logs' })).status).toBe(405);
        expect((await postJson(port, '/v1/nothing', {})).status).toBe(404);
    });

    it('accepts the traces path with 200 and ignores it', async () => {
        const r = await postJson(port, '/v1/traces', { resourceSpans: [{ scopeSpans: [{ spans: [{ name: 'x', attributes: [{ key: 'session.id', value: { stringValue: 'trace-session' } }] }] }] }] });
        expect(r.status).toBe(200);
        expect(getDb().prepare('SELECT COUNT(*) AS n FROM sessions').get()).toEqual({ n: 0 });
        expect(getDb().prepare('SELECT COUNT(*) AS n FROM otlp_usage').get()).toEqual({ n: 0 });
    });

    it('accepts Content-Encoding: gzip, refuses other encodings, and rejects a corrupt gzip body', async () => {
        const gz = await send(port, { path: '/v1/logs', headers: { 'Content-Type': 'application/json', 'Content-Encoding': 'gzip' }, body: gzipJson(loadFixture('delta', '04-logs-api-request.json')) });
        expect(gz.status).toBe(200);
        expect(onlySession(DELTA_SESSION).input_tokens).toBe(2);

        const br = await send(port, { path: '/v1/logs', headers: { 'Content-Type': 'application/json', 'Content-Encoding': 'br' }, body: Buffer.from('x') });
        expect(br.status).toBe(415);
        const bad = await send(port, { path: '/v1/logs', headers: { 'Content-Type': 'application/json', 'Content-Encoding': 'gzip' }, body: Buffer.from('not gzip at all') });
        expect(bad.status).toBe(400);
    });

    it('enforces the 4 MB limit on the wire size and on the decompressed size', async () => {
        expect(MAX_BODY_BYTES).toBe(4 * 1024 * 1024);

        // plain body over the limit
        const big = Buffer.alloc(MAX_BODY_BYTES + 1, 0x20);
        const tooBig = await send(port, { path: '/v1/logs', headers: { 'Content-Type': 'application/json' }, body: big });
        expect(tooBig.status).toBe(413);
        // same without a Content-Length (chunked): cut off while reading
        const chunked = await send(port, { path: '/v1/logs', headers: { 'Content-Type': 'application/json' }, body: big, chunked: true });
        expect(chunked.status).toBe(413);

        // a tiny gzip that inflates past the limit (zip bomb)
        const bomb = zlib.gzipSync(Buffer.alloc(MAX_BODY_BYTES + 1024, 0x20));
        expect(bomb.length).toBeLessThan(64 * 1024);
        const bombed = await send(port, { path: '/v1/logs', headers: { 'Content-Type': 'application/json', 'Content-Encoding': 'gzip' }, body: bomb });
        expect(bombed.status).toBe(413);

        // a body just under the limit is fine
        const pad = 'x'.repeat(MAX_BODY_BYTES - 4096);
        const ok = apiRequestLogs([{ sessionId: 'big-ok', requestId: 'r1', timestamp: '2026-10-08T07:00:00.000Z', costUsd: 0.1, extra: { padding: pad } }]);
        expect((await postJson(port, '/v1/logs', ok)).status).toBe(200);
        expect(onlySession('big-ok').input_tokens).toBe(10);
    });
});

describe('mapping to sessions (recorded payloads)', () => {
    beforeEach(startReceiver);

    it('creates one claude-code session with Claude Code\'s reported cost; events and metrics do not add up twice', async () => {
        expect((await postJson(port, '/v1/metrics', loadFixture('delta', '03-metrics-usage.json'))).status).toBe(200);
        // metrics only: totals come from the counters
        let row = onlySession(DELTA_SESSION);
        expect(tokens(row)).toEqual([2, 4, 24341, 8308]);

        // the same requests now arrive as events: they take over, nothing is added on top
        expect((await postJson(port, '/v1/logs', loadFixture('delta', '04-logs-api-request.json'))).status).toBe(200);
        row = onlySession(DELTA_SESSION);
        expect(tokens(row)).toEqual([2, 4, 24341, 8308]);
        expect(row.estimated_cost_usd).toBeCloseTo(0.0381442, 10);
        expect(row).toMatchObject({
            provider: 'claude-code', tool: 'Claude Code', source: 'otlp', cost_source: 'reported',
            is_estimated: 0, model_primary: 'claude-sonnet-5-5', message_count: 1,
        });
        expect(row.started_at).toBeTruthy();
    });

    it('delivering the same export twice does not change totals (events, delta metrics)', async () => {
        for (const [file, route] of [['04-logs-api-request.json', '/v1/logs'], ['03-metrics-usage.json', '/v1/metrics']] as const) {
            await postJson(port, route, loadFixture('delta', file));
            const first = JSON.stringify(onlySession(DELTA_SESSION));
            await postJson(port, route, loadFixture('delta', file));
            await postJson(port, route, loadFixture('delta', file));
            expect(JSON.stringify(onlySession(DELTA_SESSION))).toBe(first);
            getDb().prepare('DELETE FROM sessions').run();
            getDb().prepare('DELETE FROM otlp_usage').run();
        }
    });

    it('delta metrics from later windows add up, cumulative metrics replace instead of adding', async () => {
        // delta: a second, different window adds
        const first = loadFixture('delta', '03-metrics-usage.json');
        const second = loadFixture('delta', '03-metrics-usage.json');
        for (const m of second.resourceMetrics[0].scopeMetrics[0].metrics)
            for (const p of m.sum.dataPoints) { p.startTimeUnixNano = p.timeUnixNano; p.timeUnixNano = String(BigInt(p.timeUnixNano) + 60_000_000_000n); }
        await postJson(port, '/v1/metrics', first);
        await postJson(port, '/v1/metrics', second);
        expect(tokens(onlySession(DELTA_SESSION))).toEqual([4, 8, 48682, 16616]);

        // cumulative: same series, growing value => latest value, delivered twice => unchanged
        const c1 = loadFixture('cumulative', '03-metrics-usage.json');
        await postJson(port, '/v1/metrics', c1);
        await postJson(port, '/v1/metrics', c1);
        expect(tokens(onlySession(CUMULATIVE_SESSION))).toEqual([2, 4, 25372, 7277]);
        const c2 = loadFixture('cumulative', '03-metrics-usage.json');
        for (const m of c2.resourceMetrics[0].scopeMetrics[0].metrics)
            for (const p of m.sum.dataPoints) { p.asDouble = p.asDouble * 2; p.timeUnixNano = String(BigInt(p.timeUnixNano) + 60_000_000_000n); }
        await postJson(port, '/v1/metrics', c2);
        expect(tokens(onlySession(CUMULATIVE_SESSION))).toEqual([4, 8, 50744, 14554]);
        // an out-of-order older cumulative export cannot lower the total
        await postJson(port, '/v1/metrics', c1);
        expect(tokens(onlySession(CUMULATIVE_SESSION))).toEqual([4, 8, 50744, 14554]);
    });

    it('sums many distinct requests and flags a session unpriced when events carry no cost (synthetic)', async () => {
        await postJson(port, '/v1/logs', apiRequestLogs([
            { sessionId: 'multi', requestId: 'a', timestamp: '2026-10-08T07:00:00.000Z', input: 1, output: 2, cacheRead: 3, cacheCreation: 4, costUsd: 0.25 },
            { sessionId: 'multi', requestId: 'b', timestamp: '2026-10-08T07:00:10.000Z', input: 10, output: 20, cacheRead: 30, cacheCreation: 40, costUsd: 0.5 },
        ]));
        let row = onlySession('multi');
        expect(tokens(row)).toEqual([11, 22, 33, 44]);
        expect(row.estimated_cost_usd).toBeCloseTo(0.75, 10);
        expect(row.cost_source).toBe('reported');
        expect(row.message_count).toBe(2);
        expect(row.duration_seconds).toBe(10);

        await postJson(port, '/v1/logs', apiRequestLogs([{ sessionId: 'multi', requestId: 'c', timestamp: '2026-10-08T07:00:20.000Z', input: 1, output: 1, cacheRead: 0, cacheCreation: 0 }]));
        row = onlySession('multi');
        expect(row).toMatchObject({ is_estimated: 1, cost_source: 'unpriced' });
    });
});

describe('OTLP and the log parser never double count', () => {
    const writeClaudeLog = () => {
        const dir = path.join(home, '.claude', 'projects', '-home-user-project');
        fs.mkdirSync(dir, { recursive: true });
        fs.copyFileSync(fixturePath('log', `${CUMULATIVE_SESSION}.jsonl`), path.join(dir, `${CUMULATIVE_SESSION}.jsonl`));
    };
    const sendCumulative = async () => {
        await postJson(port, '/v1/logs', loadFixture('cumulative', '02-logs-api-request.json'));
        await postJson(port, '/v1/metrics', loadFixture('cumulative', '03-metrics-usage.json'));
    };

    beforeEach(async () => {
        await startReceiver();
    });

    it('OTLP first, then the log parser: one session, the parser takes it over, same totals', async () => {
        await sendCumulative();
        let row = onlySession(CUMULATIVE_SESSION);
        expect(row.source).toBe('otlp');
        expect(tokens(row)).toEqual([2, 4, 25372, 7277]);

        writeClaudeLog();
        await claudeParser.parse();

        row = onlySession(CUMULATIVE_SESSION);
        expect(row.source).toBe('log');
        expect(row.file_path).toContain(`${CUMULATIVE_SESSION}.jsonl`);
        expect(tokens(row)).toEqual([2, 4, 25372, 7277]); // overwritten, not 4/8/50744/14554
        expect(row.cost_source).not.toBe('reported'); // the parser's own pricing, no longer Claude Code's number
        expect(getDb().prepare('SELECT COUNT(*) AS n FROM sessions').get()).toEqual({ n: 1 });
    });

    it('log parser first, then OTLP: the parser row is untouched and nothing is stored for it', async () => {
        writeClaudeLog();
        await claudeParser.parse();
        const before = JSON.stringify(onlySession(CUMULATIVE_SESSION));

        await sendCumulative();
        await sendCumulative();

        expect(JSON.stringify(onlySession(CUMULATIVE_SESSION))).toBe(before);
        expect(onlySession(CUMULATIVE_SESSION).source).toBe('log');
        expect(getDb().prepare('SELECT COUNT(*) AS n FROM otlp_usage WHERE session_id = ?').get(CUMULATIVE_SESSION)).toEqual({ n: 0 });
    });

    it('OTLP data that arrives after the parser took a session over is dropped, and earlier ledger rows are cleaned up', async () => {
        await sendCumulative();
        expect((getDb().prepare('SELECT COUNT(*) AS n FROM otlp_usage WHERE session_id = ?').get(CUMULATIVE_SESSION) as any).n).toBeGreaterThan(0);
        writeClaudeLog();
        await claudeParser.parse();
        await sendCumulative();
        expect(onlySession(CUMULATIVE_SESSION).source).toBe('log');
        expect(getDb().prepare('SELECT COUNT(*) AS n FROM otlp_usage WHERE session_id = ?').get(CUMULATIVE_SESSION)).toEqual({ n: 0 });
    });
});

describe('privacy: nothing but usage numbers reaches the database', () => {
    beforeEach(startReceiver);

    const SENTINELS = [
        'SENTINEL_PROMPT_TEXT', 'SENTINEL_RESPONSE_TEXT', 'SENTINEL_TOOL_PARAMS', 'SENTINEL_TOOL_INPUT',
        'SENTINEL_BASH_COMMAND', 'sentinel.person@example.invalid', 'SENTINEL_ORG_ID', 'SENTINEL_HOST_PATH', 'SENTINEL_ERROR_TEXT',
    ];

    const dumpEverything = (): string => {
        const db = getDb();
        const parts: string[] = [];
        for (const t of db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`).all() as { name: string }[]) {
            parts.push(JSON.stringify(db.prepare(`SELECT * FROM "${t.name}"`).all()));
        }
        db.pragma('wal_checkpoint(TRUNCATE)');
        for (const f of ['data.db', 'data.db-wal']) {
            const p = path.join(tmp, f);
            if (fs.existsSync(p)) parts.push(fs.readFileSync(p).toString('latin1'));
        }
        return parts.join('\n');
    };

    it('drops prompt, response, tool and identity attributes even when the tool was told to include them (synthetic payloads)', async () => {
        const payload = apiRequestLogs([{
            sessionId: 'priv-1', requestId: 'priv-r1', promptId: 'priv-p1', timestamp: '2026-10-08T07:00:00.000Z', costUsd: 0.01,
            extra: {
                prompt: 'SENTINEL_PROMPT_TEXT', prompt_text: 'SENTINEL_PROMPT_TEXT', response: 'SENTINEL_RESPONSE_TEXT',
                tool_parameters: '{"command":"SENTINEL_BASH_COMMAND"}', tool_input: 'SENTINEL_TOOL_INPUT', error: 'SENTINEL_ERROR_TEXT',
                'user.email': 'sentinel.person@example.invalid', 'organization.id': 'SENTINEL_ORG_ID', 'workspace.host_paths': '/home/SENTINEL_HOST_PATH',
            },
        }]);
        // the other event types Claude Code emits, carrying content, in the same export
        const records = payload.resourceLogs[0].scopeLogs[0].logRecords;
        const mk = (name: string, extra: Record<string, string>) => ({
            timeUnixNano: '1791443254869000000', body: { stringValue: `claude_code.${name}` },
            attributes: [{ key: 'session.id', value: { stringValue: 'priv-1' } }, { key: 'event.name', value: { stringValue: name } },
                ...Object.entries(extra).map(([key, v]) => ({ key, value: { stringValue: v } }))],
        });
        records.push(
            mk('user_prompt', { prompt: 'SENTINEL_PROMPT_TEXT', prompt_text: 'SENTINEL_PROMPT_TEXT' }),
            mk('assistant_response', { response: 'SENTINEL_RESPONSE_TEXT' }),
            mk('tool_result', { tool_name: 'Bash', tool_input: 'SENTINEL_TOOL_INPUT', tool_parameters: 'SENTINEL_BASH_COMMAND' }),
        );
        const metrics = loadFixture('delta', '03-metrics-usage.json');
        for (const m of metrics.resourceMetrics[0].scopeMetrics[0].metrics)
            for (const p of m.sum.dataPoints) {
                p.attributes.find((a: any) => a.key === 'session.id').value.stringValue = 'priv-1';
                p.attributes.push({ key: 'user.email', value: { stringValue: 'sentinel.person@example.invalid' } }, { key: 'tool_parameters', value: { stringValue: 'SENTINEL_TOOL_PARAMS' } });
            }

        expect((await postJson(port, '/v1/logs', payload)).status).toBe(200);
        expect((await postJson(port, '/v1/metrics', metrics)).status).toBe(200);
        expect((await postJson(port, '/v1/traces', { resourceSpans: [{ note: 'SENTINEL_PROMPT_TEXT' }] })).status).toBe(200);

        const row = onlySession('priv-1');
        expect(row.input_tokens).toBe(10); // the event was stored...
        const dump = dumpEverything();
        for (const s of SENTINELS) expect(dump).not.toContain(s); // ...without any of the content
        expect(row.raw_metadata_json).toBeNull();
        expect(row.tool_calls_json).toBe('{}');
    });
});
