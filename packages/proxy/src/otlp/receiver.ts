import http from 'http';
import zlib from 'zlib';
import { isHostAllowed } from '../security/localGuard';
import { mapLogs, mapMetrics } from './mapper';
import { ingestUsage } from './store';

/**
 * The OTLP/HTTP receiver. Opt-in, loopback only, JSON only.
 *
 * Claude Code can push OpenTelemetry metrics and events; this accepts the http/json encoding on the
 * standard paths (/v1/metrics, /v1/logs, /v1/traces) and maps usage to the sessions table (store.ts).
 * http/protobuf is answered with 415 and the exact env var to switch, because Claude Code can emit
 * JSON and a protobuf decoder is not worth carrying.
 */

export const MAX_BODY_BYTES = 4 * 1024 * 1024;
/** After refusing an oversized upload we read (and discard) at most this much more, so the client sees the 413. */
const MAX_DRAIN_BYTES = 64 * 1024 * 1024;

const PROTOBUF_HINT =
    'This receiver only accepts OTLP over HTTP with JSON bodies. ' +
    'Set OTEL_EXPORTER_OTLP_PROTOCOL=http/json in the environment of the tool that sends telemetry.';

export interface ReceiverStats {
    logsRequests: number;
    metricsRequests: number;
    tracesRequests: number;
    rejectedRequests: number;
    recordsStored: number;
    recordsIgnored: number;
    lastReceivedAt: string | null;
}

export const newStats = (): ReceiverStats => ({
    logsRequests: 0, metricsRequests: 0, tracesRequests: 0, rejectedRequests: 0,
    recordsStored: 0, recordsIgnored: 0, lastReceivedAt: null,
});

function reply(res: http.ServerResponse, status: number, body: unknown, extra: Record<string, string> = {}): void {
    const text = JSON.stringify(body);
    res.writeHead(status, {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(text),
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        ...extra,
    });
    res.end(text);
}

class BodyTooLarge extends Error {}

/** Collect the request body, failing as soon as it exceeds the limit. */
function readBody(req: http.IncomingMessage): Promise<Buffer> {
    return new Promise((resolve, reject) => {
        const chunks: Buffer[] = [];
        let size = 0;
        let done = false;
        req.on('data', (chunk: Buffer) => {
            if (done) return;
            size += chunk.length;
            if (size > MAX_BODY_BYTES) {
                done = true;
                reject(new BodyTooLarge());
                return;
            }
            chunks.push(chunk);
        });
        req.on('end', () => { if (!done) { done = true; resolve(Buffer.concat(chunks)); } });
        req.on('error', err => { if (!done) { done = true; reject(err); } });
        req.on('aborted', () => { if (!done) { done = true; reject(new Error('aborted')); } });
    });
}

function gunzip(buf: Buffer): Promise<Buffer> {
    return new Promise((resolve, reject) => {
        zlib.gunzip(buf, { maxOutputLength: MAX_BODY_BYTES }, (err, out) => (err ? reject(err) : resolve(out)));
    });
}

/** Refuse an oversized upload: answer now, keep draining (bounded) so the client reads the answer, then close. */
function refuseTooLarge(req: http.IncomingMessage, res: http.ServerResponse, stats: ReceiverStats): void {
    stats.rejectedRequests++;
    reply(res, 413, { error: `Request body exceeds the ${MAX_BODY_BYTES / (1024 * 1024)} MB limit.` }, { Connection: 'close' });
    let drained = 0;
    req.on('data', (c: Buffer) => { drained += c.length; if (drained > MAX_DRAIN_BYTES) req.destroy(); });
    req.on('error', () => { /* client went away */ });
    req.resume();
}

export function createReceiverServer(stats: ReceiverStats): http.Server {
    const handler = async (req: http.IncomingMessage, res: http.ServerResponse): Promise<void> => {
        const reject = (status: number, body: unknown, extra?: Record<string, string>) => {
            stats.rejectedRequests++;
            reply(res, status, body, extra);
        };

        // DNS rebinding: only loopback names (plus anything the user allowed for the other ports).
        if (!isHostAllowed(req.headers.host)) {
            return reject(421, { error: 'Host not allowed. This receiver only answers to localhost, 127.0.0.1 and [::1].' });
        }
        // OTLP exporters are not browsers and never send an Origin. A browser page posting to this port
        // always does, so any Origin (or a browser's Sec-Fetch-Site) is refused, with no CORS headers.
        const fetchSite = req.headers['sec-fetch-site'];
        if (req.headers.origin !== undefined || (fetchSite !== undefined && fetchSite !== 'none')) {
            return reject(403, { error: 'Browser requests are not accepted by the OTLP receiver.' });
        }

        const urlPath = (req.url || '').split('?')[0];
        if (urlPath === '/health' && (req.method === 'GET' || req.method === 'HEAD')) {
            return reply(res, 200, { status: 'ok', service: 'llm-observer-otlp' });
        }
        const route = urlPath === '/v1/logs' ? 'logs' : urlPath === '/v1/metrics' ? 'metrics' : urlPath === '/v1/traces' ? 'traces' : null;
        if (!route) return reject(404, { error: 'Not found. Use POST /v1/metrics or /v1/logs.' });
        if (req.method !== 'POST') return reject(405, { error: 'Method not allowed.' }, { Allow: 'POST' });

        const declared = Number(req.headers['content-length']);
        if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return refuseTooLarge(req, res, stats);

        // Traces are accepted and ignored; they carry no usage we use. Everything else must be JSON.
        if (route !== 'traces') {
            const mediaType = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
            if (mediaType !== 'application/json') {
                req.resume();
                return reject(415, { error: PROTOBUF_HINT });
            }
        }
        const encoding = String(req.headers['content-encoding'] || 'identity').trim().toLowerCase();
        if (!['identity', 'gzip', 'x-gzip'].includes(encoding)) {
            req.resume();
            return reject(415, { error: `Content-Encoding "${encoding}" is not supported; use gzip or none.` });
        }

        let body: Buffer;
        try {
            body = await readBody(req);
            if (encoding !== 'identity') body = await gunzip(body);
        } catch (err: any) {
            if (err instanceof BodyTooLarge) return refuseTooLarge(req, res, stats);
            if (err && err.code === 'ERR_BUFFER_TOO_LARGE') return reject(413, { error: `Decompressed body exceeds the ${MAX_BODY_BYTES / (1024 * 1024)} MB limit.` }, { Connection: 'close' });
            return reject(400, { error: 'Could not read the request body (corrupt gzip or aborted upload).' });
        }

        stats.lastReceivedAt = new Date().toISOString();
        if (route === 'traces') {
            stats.tracesRequests++;
            return reply(res, 200, {});
        }

        let payload: unknown;
        try {
            payload = JSON.parse(body.toString('utf8'));
        } catch {
            return reject(400, { error: 'Body is not valid JSON.' });
        }

        try {
            const mapped = route === 'logs' ? mapLogs(payload) : mapMetrics(payload);
            const stored = ingestUsage(mapped.records);
            if (route === 'logs') stats.logsRequests++; else stats.metricsRequests++;
            stats.recordsStored += stored.accepted;
            stats.recordsIgnored += mapped.ignored + stored.skippedLogSessions;
        } catch (err) {
            console.error('[OTLP] Failed to store telemetry:', (err as Error).message);
            return reject(500, { error: 'Could not store telemetry.' });
        }
        // OTLP/JSON success response: an empty ExportServiceResponse.
        reply(res, 200, {});
    };

    const server = http.createServer((req, res) => {
        handler(req, res).catch(err => {
            console.error('[OTLP] Unexpected error:', err && err.message);
            if (!res.headersSent) reply(res, 500, { error: 'Internal error.' });
            else res.destroy();
        });
    });
    server.headersTimeout = 10_000;
    server.requestTimeout = 30_000;
    server.keepAliveTimeout = 5_000;
    return server;
}
