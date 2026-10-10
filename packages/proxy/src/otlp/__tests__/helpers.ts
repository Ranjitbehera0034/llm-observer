import fs from 'fs';
import path from 'path';

/** fixtures/otlp at the repository root (see its README.md for provenance). */
export const FIXTURE_DIR = path.join(__dirname, '../../../../../fixtures/otlp');

export const fixturePath = (...parts: string[]) => path.join(FIXTURE_DIR, ...parts);
export const loadFixture = (...parts: string[]): any => JSON.parse(fs.readFileSync(fixturePath(...parts), 'utf8'));

/** The scrubbed session ids the fixtures use (README.md): delta capture, cumulative capture. */
export const DELTA_SESSION = '5e55d3a1-0000-4000-8000-000000000001';
export const CUMULATIVE_SESSION = '5e55d3a1-0000-4000-8000-000000000002';

// --- OTLP/JSON builders for payloads the real captures cannot give us (many requests, prompt text, ...) ---
const attr = (key: string, v: string | number | boolean) => ({
    key,
    value: typeof v === 'string' ? { stringValue: v }
        : typeof v === 'boolean' ? { boolValue: v }
        : Number.isInteger(v) ? { intValue: v } : { doubleValue: v },
});

export interface SyntheticRequest {
    sessionId: string;
    requestId?: string;
    promptId?: string;
    timestamp: string;
    sequence?: number;
    model?: string;
    input?: number;
    output?: number;
    cacheRead?: number;
    cacheCreation?: number;
    costUsd?: number;
    extra?: Record<string, string | number | boolean>;
}

/** Shaped like the real claude_code.api_request record in fixtures/otlp/delta/04-logs-api-request.json. */
export function apiRequestLogs(requests: SyntheticRequest[]): any {
    return {
        resourceLogs: [{
            resource: { attributes: [attr('service.name', 'claude-code'), attr('service.version', '2.1.294')] },
            scopeLogs: [{
                scope: { name: 'com.anthropic.claude_code.events', version: '2.1.294' },
                logRecords: requests.map((r, i) => ({
                    timeUnixNano: String(Date.parse(r.timestamp) * 1_000_000),
                    observedTimeUnixNano: String(Date.parse(r.timestamp) * 1_000_000),
                    body: { stringValue: 'claude_code.api_request' },
                    attributes: [
                        attr('session.id', r.sessionId),
                        attr('event.name', 'api_request'),
                        attr('event.timestamp', r.timestamp),
                        attr('event.sequence', r.sequence ?? i),
                        ...(r.promptId ? [attr('prompt.id', r.promptId)] : []),
                        attr('model', r.model ?? 'claude-sonnet-5-5'),
                        attr('input_tokens', r.input ?? 10),
                        attr('output_tokens', r.output ?? 5),
                        attr('cache_read_tokens', r.cacheRead ?? 100),
                        attr('cache_creation_tokens', r.cacheCreation ?? 20),
                        ...(r.costUsd === undefined ? [] : [attr('cost_usd', r.costUsd)]),
                        ...(r.requestId ? [attr('request_id', r.requestId)] : []),
                        ...Object.entries(r.extra ?? {}).map(([k, v]) => attr(k, v)),
                    ],
                })),
            }],
        }],
    };
}

export function gzipJson(obj: unknown): Buffer {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require('zlib').gzipSync(Buffer.from(JSON.stringify(obj)));
}

// --- real-HTTP helpers ---
import http from 'http';
import net from 'net';

export interface HttpResult { status: number; headers: http.IncomingHttpHeaders; body: string }

/** One request to 127.0.0.1:<port>. Headers (including Host and Origin) are sent exactly as given. */
export function send(port: number, opts: { method?: string; path: string; headers?: Record<string, string>; body?: Buffer | string; chunked?: boolean }): Promise<HttpResult> {
    return new Promise((resolve, reject) => {
        let result: HttpResult | null = null;
        const req = http.request({
            host: '127.0.0.1', port, method: opts.method ?? 'POST', path: opts.path,
            headers: {
                Connection: 'close',
                ...(opts.body !== undefined && !opts.chunked ? { 'Content-Length': String(Buffer.byteLength(opts.body)) } : {}),
                ...(opts.headers ?? {}),
            },
            agent: false,
        }, res => {
            const chunks: Buffer[] = [];
            res.on('data', c => chunks.push(c));
            res.on('end', () => { result = { status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }; resolve(result); });
            res.on('error', () => { if (!result) reject(new Error('response error')); });
        });
        // A server that answers 413 early may reset the socket while the client is still writing:
        // the status it already sent is what the test asserts on.
        req.on('error', err => { if (!result) reject(err); });
        if (opts.body !== undefined) req.write(opts.body);
        req.end();
    });
}

export const postJson = (port: number, urlPath: string, payload: unknown, headers: Record<string, string> = {}) =>
    send(port, { path: urlPath, headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(payload) });

export function isListening(port: number): Promise<boolean> {
    return new Promise(resolve => {
        const s = net.connect({ host: '127.0.0.1', port });
        s.once('connect', () => { s.destroy(); resolve(true); });
        s.once('error', () => resolve(false));
    });
}

/**
 * A free port inside the 16210-16249 range reserved for this lane's tests. Jest runs test files in parallel
 * workers, so each worker gets its own slice of 5 ports (JEST_WORKER_ID is 1-based) and rotates through it:
 * two files never pick the same port, and two calls in one test never return the same one.
 */
const SLICE = 5;
let cursor = 0;
export async function freePort(): Promise<number> {
    const worker = Number(process.env.JEST_WORKER_ID || '1') - 1;
    const base = 16210 + (worker % 8) * SLICE;
    for (let i = 0; i < SLICE; i++) {
        const port = base + (cursor++ % SLICE);
        const ok = await new Promise<boolean>(resolve => {
            const s = net.createServer();
            s.once('error', () => resolve(false));
            s.listen(port, '127.0.0.1', () => s.close(() => resolve(true)));
        });
        if (ok) return port;
    }
    throw new Error(`no free port in ${base}-${base + SLICE - 1}`);
}
