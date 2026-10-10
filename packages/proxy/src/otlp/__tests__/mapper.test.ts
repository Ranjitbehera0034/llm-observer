/**
 * Mapper tests. The primary inputs are payloads RECORDED from Claude Code 2.1.294 (scrubbed of ids,
 * see fixtures/otlp/README.md). Payloads for situations the recordings cannot show are built with
 * the helpers and are labelled synthetic in the test names.
 */
import { mapLogs, mapMetrics } from '../mapper';
import { loadFixture, DELTA_SESSION, CUMULATIVE_SESSION, apiRequestLogs } from './helpers';

describe('mapLogs (recorded Claude Code 2.1.294 payloads)', () => {
    it('turns the recorded api_request event into one usage record with Claude Code\'s own cost', () => {
        const { records } = mapLogs(loadFixture('delta', '04-logs-api-request.json'));
        expect(records).toHaveLength(1);
        expect(records[0]).toMatchObject({
            sessionId: DELTA_SESSION,
            kind: 'event',
            accumulate: 'sum',
            model: 'claude-sonnet-5-5',
            inputTokens: 2,
            outputTokens: 4,
            cacheReadTokens: 24341,
            cacheWriteTokens: 8308,
            costUsd: 0.038144199999999996,
        });
        // keyed by the API request id when the payload has one
        expect(records[0].key).toBe('req:req_SCRUBBED00000005');
        expect(records[0].occurredAt).toBe('2026-10-08T07:07:34.869Z');
    });

    it('ignores every other recorded event (assistant_response, plugin_loaded, user_prompt, ...)', () => {
        const startup = mapLogs(loadFixture('delta', '01-logs-startup.json'));
        expect(startup.records).toEqual([]);
        expect(startup.ignored).toBeGreaterThan(0);
        const all = mapLogs(loadFixture('delta', '04-logs-api-request.json'));
        expect(all.records).toHaveLength(1); // the assistant_response next to it is not usage
        expect(all.ignored).toBe(1);
    });

    it('falls back to timestamp + prompt.id + sequence when there is no request id (synthetic)', () => {
        const payload = apiRequestLogs([{ sessionId: 's1', promptId: 'p1', timestamp: '2026-10-08T07:00:00.000Z', sequence: 7, costUsd: 0.5 }]);
        const { records } = mapLogs(payload);
        expect(records[0].key).toBe('evt:2026-10-08T07:00:00.000Z|p1|7');
    });

    it('leaves cost null when the event carries none, so the session can be flagged unpriced (synthetic)', () => {
        const { records } = mapLogs(apiRequestLogs([{ sessionId: 's1', requestId: 'r1', timestamp: '2026-10-08T07:00:00.000Z' }]));
        expect(records[0].costUsd).toBeNull();
    });

    it('accepts int64 counts encoded as JSON strings and uses cost_usd_micros when cost_usd is absent (synthetic)', () => {
        const payload = apiRequestLogs([{ sessionId: 's1', requestId: 'r1', timestamp: '2026-10-08T07:00:00.000Z' }]);
        const attrs = payload.resourceLogs[0].scopeLogs[0].logRecords[0].attributes;
        attrs.find((a: any) => a.key === 'input_tokens').value = { intValue: '123' };
        attrs.push({ key: 'cost_usd_micros', value: { intValue: '2500' } });
        const { records } = mapLogs(payload);
        expect(records[0].inputTokens).toBe(123);
        expect(records[0].costUsd).toBeCloseTo(0.0025, 10);
    });

    it('drops records without a usable session id, with negative or non-finite numbers (synthetic)', () => {
        const payload = apiRequestLogs([
            { sessionId: '', requestId: 'r0', timestamp: '2026-10-08T07:00:00.000Z' },
            { sessionId: 'has spaces and /slashes', requestId: 'r1', timestamp: '2026-10-08T07:00:00.000Z' },
            { sessionId: 'ok', requestId: 'r2', timestamp: '2026-10-08T07:00:00.000Z', input: -5 },
            { sessionId: 'ok', requestId: 'r3', timestamp: '2026-10-08T07:00:00.000Z', costUsd: Number.NaN },
        ]);
        expect(mapLogs(payload).records).toEqual([]);
    });

    it('survives garbage input', () => {
        for (const bad of [null, undefined, 42, 'x', [], {}, { resourceLogs: 5 }, { resourceLogs: [{ scopeLogs: [{ logRecords: [null, 1, {}] }] }] }]) {
            expect(mapLogs(bad as any).records).toEqual([]);
        }
    });
});

describe('mapMetrics (recorded Claude Code 2.1.294 payloads)', () => {
    it('maps delta token and cost counters; session.count and active_time are not usage', () => {
        expect(mapMetrics(loadFixture('delta', '02-metrics-session-count.json')).records).toEqual([]);
        expect(mapMetrics(loadFixture('delta', '05-metrics-active-time.json')).records).toEqual([]);

        const { records } = mapMetrics(loadFixture('delta', '03-metrics-usage.json'));
        expect(records).toHaveLength(5);
        expect(records.every(r => r.kind === 'metric' && r.sessionId === DELTA_SESSION && r.model === 'claude-sonnet-5-5')).toBe(true);
        expect(records.every(r => r.accumulate === 'sum')).toBe(true); // delta temporality => each point is new usage
        const total = (f: 'inputTokens' | 'outputTokens' | 'cacheReadTokens' | 'cacheWriteTokens') => records.reduce((n, r) => n + r[f], 0);
        expect(total('inputTokens')).toBe(2);
        expect(total('outputTokens')).toBe(4);
        expect(total('cacheReadTokens')).toBe(24341);
        expect(total('cacheWriteTokens')).toBe(8308);
        expect(records.reduce((n, r) => n + (r.costUsd ?? 0), 0)).toBeCloseTo(0.0381442, 10);
        expect(new Set(records.map(r => r.key)).size).toBe(5); // distinct keys per series
    });

    it('marks cumulative counters so the store keeps the latest value instead of summing', () => {
        const { records } = mapMetrics(loadFixture('cumulative', '03-metrics-usage.json'));
        expect(records).toHaveLength(5);
        expect(records.every(r => r.accumulate === 'max' && r.sessionId === CUMULATIVE_SESSION)).toBe(true);
    });

    it('gives the same data point the same key every time, and different windows different keys for delta', () => {
        const a = mapMetrics(loadFixture('delta', '03-metrics-usage.json')).records.map(r => r.key);
        const b = mapMetrics(loadFixture('delta', '03-metrics-usage.json')).records.map(r => r.key);
        expect(a).toEqual(b);

        const later = loadFixture('delta', '03-metrics-usage.json');
        for (const m of later.resourceMetrics[0].scopeMetrics[0].metrics)
            for (const p of m.sum.dataPoints) p.timeUnixNano = String(BigInt(p.timeUnixNano) + 60_000_000_000n);
        const c = mapMetrics(later).records.map(r => r.key);
        expect(c.some(k => a.includes(k))).toBe(false);
    });

    it('ignores metrics with unspecified temporality rather than risk double counting (synthetic)', () => {
        const p = loadFixture('delta', '03-metrics-usage.json');
        for (const m of p.resourceMetrics[0].scopeMetrics[0].metrics) m.sum.aggregationTemporality = 0;
        expect(mapMetrics(p).records).toEqual([]);
    });

    it('survives garbage input', () => {
        for (const bad of [null, 1, [], {}, { resourceMetrics: [{ scopeMetrics: [{ metrics: [null, { name: 'claude_code.token.usage' }] }] }] }]) {
            expect(mapMetrics(bad as any).records).toEqual([]);
        }
    });
});

describe('privacy: mapper output', () => {
    it('never carries prompt, response, tool or identity attributes through (synthetic payload with sentinels)', () => {
        const payload = apiRequestLogs([{
            sessionId: 's-priv', requestId: 'r-priv', timestamp: '2026-10-08T07:00:00.000Z', costUsd: 1,
            extra: {
                prompt: 'SENTINEL_PROMPT_TEXT', prompt_text: 'SENTINEL_PROMPT_TEXT', response: 'SENTINEL_RESPONSE',
                tool_parameters: '{"command":"SENTINEL_TOOL_PARAMS"}', tool_input: 'SENTINEL_TOOL_INPUT',
                'user.email': 'sentinel@example.invalid', 'workspace.host_paths': '/home/SENTINEL_PATH',
            },
        }]);
        const out = JSON.stringify(mapLogs(payload).records);
        expect(out).not.toMatch(/SENTINEL|sentinel/);
        expect(out).toContain('s-priv');
    });
});
