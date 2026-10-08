import { createHash } from 'crypto';

/**
 * Maps OTLP/JSON payloads sent by Claude Code to usage records.
 *
 * PRIVACY RULE: this file reads a fixed allowlist of numeric usage fields plus identifiers needed for
 * deduplication (session id, request id, timestamps, model name). It never copies an attribute bag, so
 * prompt text, responses, tool parameters/inputs, file paths and user identity (email, account, org)
 * cannot reach the database even when the tool is configured to emit them.
 *
 * Field names were checked against payloads recorded from Claude Code 2.1.294 (fixtures/otlp) and the
 * official monitoring documentation (https://code.claude.com/docs/en/monitoring-usage).
 */

export interface UsageRecord {
    sessionId: string;
    /** 'event' = one API request (claude_code.api_request); 'metric' = one counter data point. */
    kind: 'event' | 'metric';
    /** Unique per request / per series window; the same export delivered twice yields the same keys. */
    key: string;
    /** 'sum': every key is new usage (events, delta counters). 'max': cumulative counter, keep the latest value. */
    accumulate: 'sum' | 'max';
    model: string | null;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
    /** As reported by Claude Code (USD). null = the payload carried no cost. */
    costUsd: number | null;
    startedAt: string;
    occurredAt: string;
}

export interface MapResult {
    records: UsageRecord[];
    /** Log records / metric data points that were looked at and are not usage (or were unusable). */
    ignored: number;
}

const SESSION_ID = /^[A-Za-z0-9._:-]{1,128}$/;
const MAX_COUNT = 1e12;
const MAX_COST_USD = 1e6;
const EVENT_PREFIX = 'claude_code.';

const TOKEN_METRIC = 'claude_code.token.usage';
const COST_METRIC = 'claude_code.cost.usage';

type Scalar = string | number | boolean;
type Attrs = Map<string, Scalar>;

const isObj = (v: unknown): v is Record<string, any> => typeof v === 'object' && v !== null && !Array.isArray(v);
const arr = (v: unknown): any[] => (Array.isArray(v) ? v : []);

/** OTLP KeyValue list -> Map of scalar values only (arrays/kvlists are dropped on purpose). */
function readAttrs(list: unknown): Attrs {
    const out: Attrs = new Map();
    for (const kv of arr(list)) {
        if (!isObj(kv) || typeof kv.key !== 'string' || !isObj(kv.value)) continue;
        const v = kv.value;
        if (typeof v.stringValue === 'string') out.set(kv.key, v.stringValue);
        else if (v.intValue !== undefined && (typeof v.intValue === 'number' || typeof v.intValue === 'string')) {
            const n = Number(v.intValue);
            if (Number.isFinite(n)) out.set(kv.key, n);
        } else if (typeof v.doubleValue === 'number') out.set(kv.key, v.doubleValue);
        else if (typeof v.boolValue === 'boolean') out.set(kv.key, v.boolValue);
    }
    return out;
}

/** A non-negative whole count; strings are accepted because proto3 JSON writes int64 as a string. */
function toCount(v: Scalar | undefined): number | null {
    if (v === undefined || typeof v === 'boolean') return null;
    const n = typeof v === 'number' ? v : (v.trim() === '' ? NaN : Number(v));
    if (!Number.isFinite(n) || n < 0 || n > MAX_COUNT) return null;
    return Math.round(n);
}

function toCost(v: Scalar | undefined): number | null {
    if (v === undefined || typeof v === 'boolean') return null;
    const n = typeof v === 'number' ? v : (v.trim() === '' ? NaN : Number(v));
    if (!Number.isFinite(n) || n < 0 || n > MAX_COST_USD) return null;
    return n;
}

function str(v: Scalar | undefined, max = 200): string | null {
    if (typeof v !== 'string' || v === '') return null;
    return v.length > max ? v.slice(0, max) : v;
}

function validSessionId(v: Scalar | undefined): string | null {
    return typeof v === 'string' && SESSION_ID.test(v) ? v : null;
}

/** Unix nanoseconds (string or number) -> ISO 8601, or null when absent / not a plausible date. */
function nanosToIso(v: unknown): string | null {
    if (v === undefined || v === null || v === '' || v === '0' || v === 0) return null;
    try {
        const ms = Number(BigInt(typeof v === 'number' ? Math.trunc(v) : String(v)) / 1_000_000n);
        const d = new Date(ms);
        if (Number.isNaN(d.getTime()) || d.getUTCFullYear() < 2000 || d.getUTCFullYear() > 2200) return null;
        return d.toISOString();
    } catch {
        return null;
    }
}

function isoOrNull(v: Scalar | undefined): string | null {
    if (typeof v !== 'string') return null;
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

const hash = (parts: unknown[]) => createHash('sha1').update(JSON.stringify(parts)).digest('hex').slice(0, 32);

// ---------------------------------------------------------------------------------------------------
// Logs (events)
// ---------------------------------------------------------------------------------------------------

export function mapLogs(payload: unknown): MapResult {
    const records: UsageRecord[] = [];
    let ignored = 0;
    if (!isObj(payload)) return { records, ignored };

    for (const rl of arr(payload.resourceLogs)) {
        if (!isObj(rl)) continue;
        const resourceAttrs = readAttrs(isObj(rl.resource) ? rl.resource.attributes : undefined);
        for (const sl of arr(rl.scopeLogs)) {
            if (!isObj(sl)) continue;
            for (const rec of arr(sl.logRecords)) {
                if (!isObj(rec)) { ignored++; continue; }
                const attrs = readAttrs(rec.attributes);
                const rawName = str(attrs.get('event.name')) ?? (isObj(rec.body) ? str(rec.body.stringValue) : null) ?? '';
                const name = rawName.startsWith(EVENT_PREFIX) ? rawName.slice(EVENT_PREFIX.length) : rawName;
                if (name !== 'api_request') { ignored++; continue; }

                const sessionId = validSessionId(attrs.get('session.id') ?? resourceAttrs.get('session.id'));
                if (!sessionId) { ignored++; continue; }

                const input = toCount(attrs.get('input_tokens') ?? 0);
                const output = toCount(attrs.get('output_tokens') ?? 0);
                const cacheRead = toCount(attrs.get('cache_read_tokens') ?? 0);
                const cacheWrite = toCount(attrs.get('cache_creation_tokens') ?? 0);
                if (input === null || output === null || cacheRead === null || cacheWrite === null) { ignored++; continue; }

                let cost = attrs.has('cost_usd') ? toCost(attrs.get('cost_usd')) : null;
                if (attrs.has('cost_usd') && cost === null) { ignored++; continue; } // present but garbage: do not guess
                if (cost === null && attrs.has('cost_usd_micros')) {
                    const micros = toCount(attrs.get('cost_usd_micros'));
                    if (micros !== null) cost = micros / 1_000_000;
                }

                const occurredAt = isoOrNull(attrs.get('event.timestamp')) ?? nanosToIso(rec.timeUnixNano) ?? nanosToIso(rec.observedTimeUnixNano) ?? new Date().toISOString();
                const requestId = str(attrs.get('request_id'));
                const key = requestId
                    ? `req:${requestId}`
                    : `evt:${str(attrs.get('event.timestamp')) ?? occurredAt}|${str(attrs.get('prompt.id')) ?? ''}|${attrs.get('event.sequence') ?? ''}`;

                records.push({
                    sessionId, kind: 'event', key, accumulate: 'sum', model: str(attrs.get('model'), 100),
                    inputTokens: input, outputTokens: output, cacheReadTokens: cacheRead, cacheWriteTokens: cacheWrite,
                    costUsd: cost, startedAt: occurredAt, occurredAt,
                });
            }
        }
    }
    return { records, ignored };
}

// ---------------------------------------------------------------------------------------------------
// Metrics
// ---------------------------------------------------------------------------------------------------

const TEMPORALITY_DELTA = 1;
const TEMPORALITY_CUMULATIVE = 2;

function temporalityOf(v: unknown): number {
    if (v === 1 || v === 'AGGREGATION_TEMPORALITY_DELTA') return TEMPORALITY_DELTA;
    if (v === 2 || v === 'AGGREGATION_TEMPORALITY_CUMULATIVE') return TEMPORALITY_CUMULATIVE;
    return 0; // unspecified: cannot tell increments from running totals, so do not count it
}

const TOKEN_FIELDS: Record<string, 'inputTokens' | 'outputTokens' | 'cacheReadTokens' | 'cacheWriteTokens'> = {
    input: 'inputTokens',
    output: 'outputTokens',
    cacheRead: 'cacheReadTokens',
    cacheCreation: 'cacheWriteTokens',
};

export function mapMetrics(payload: unknown): MapResult {
    const records: UsageRecord[] = [];
    let ignored = 0;
    if (!isObj(payload)) return { records, ignored };

    for (const rm of arr(payload.resourceMetrics)) {
        if (!isObj(rm)) continue;
        const resourceAttrs = readAttrs(isObj(rm.resource) ? rm.resource.attributes : undefined);
        for (const sm of arr(rm.scopeMetrics)) {
            if (!isObj(sm)) continue;
            for (const metric of arr(sm.metrics)) {
                if (!isObj(metric) || typeof metric.name !== 'string') continue;
                const isTokens = metric.name === TOKEN_METRIC;
                const isCost = metric.name === COST_METRIC;
                const points = isObj(metric.sum) ? arr(metric.sum.dataPoints) : [];
                if (!isTokens && !isCost) { ignored += points.length || 1; continue; }

                const sum = metric.sum;
                const temporality = isObj(sum) ? temporalityOf(sum.aggregationTemporality) : 0;
                if (!isObj(sum) || temporality === 0 || sum.isMonotonic === false) { ignored += points.length || 1; continue; }

                for (const dp of points) {
                    if (!isObj(dp)) { ignored++; continue; }
                    const attrs = readAttrs(dp.attributes);
                    const sessionId = validSessionId(attrs.get('session.id') ?? resourceAttrs.get('session.id'));
                    const raw = dp.asDouble !== undefined ? dp.asDouble : dp.asInt;
                    const value = isTokens ? toCount(raw) : toCost(raw);
                    if (!sessionId || value === null) { ignored++; continue; }

                    const base = {
                        sessionId, kind: 'metric' as const, model: str(attrs.get('model'), 100),
                        inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: null as number | null,
                    };
                    if (isTokens) {
                        const field = TOKEN_FIELDS[String(attrs.get('type'))];
                        if (!field) { ignored++; continue; }
                        base[field] = value;
                    } else {
                        base.costUsd = value;
                    }

                    const occurredAt = nanosToIso(dp.timeUnixNano) ?? new Date().toISOString();
                    const startedAt = nanosToIso(dp.startTimeUnixNano) ?? occurredAt;
                    // The series identity is every attribute (type, model, query_source, effort, ...), hashed so no
                    // attribute value is stored. A delta point is identified by its window as well; a cumulative
                    // series keeps one key for its whole lifetime and the store keeps the largest value.
                    const series = [...attrs.entries()].sort(([a], [b]) => (a < b ? -1 : 1));
                    const key = temporality === TEMPORALITY_DELTA
                        ? `m:${hash([metric.name, series, String(dp.startTimeUnixNano ?? ''), String(dp.timeUnixNano ?? '')])}`
                        : `m:${hash([metric.name, series, String(dp.startTimeUnixNano ?? '')])}`;

                    records.push({
                        ...base, key, accumulate: temporality === TEMPORALITY_DELTA ? 'sum' : 'max', startedAt, occurredAt,
                    });
                }
            }
        }
    }
    return { records, ignored };
}
