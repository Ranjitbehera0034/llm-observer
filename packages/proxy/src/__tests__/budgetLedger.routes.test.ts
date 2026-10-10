/**
 * K1: the kill switch must count spend that the database cannot see yet.
 *
 * Everything here runs the REAL chain: createApp() (localGuard, JSON parsing, request context,
 * budgetGuard, rateLimitGuard, route dispatch) and the real handleProxyRequest, in front of a
 * mock upstream that answers after a delay. The only substitution is the OpenAI provider's base
 * URL (it is a constant), pointed at the mock upstream, and the token-bucket rate limiter (100 requests
 * per project per minute would otherwise answer some of these bursts with its own 429): it passes
 * everything through unless a test switches on `mockRateLimitRefuses` to prove that a request refused
 * by a LATER guard gives its reservation back.
 *
 * Ports used: 16150 (mock upstream), 16151 (proxy app), 16159 (nothing listens: connection refused).
 *
 * Arithmetic used by the assertions. A request admitted when spent_i is what the guard sees:
 *   blocked if spent_i >= limit                                   (layer 1)
 *   blocked if spent_i >= limit - buffer                          (layer 2)
 *   blocked if spent_i >= 0.6 * limit && spent_i + e >= limit     (layer 3, estimate e)
 * With every in-flight request reserved at its estimate e, spent_i = (i - 1) * e, so with
 * limit = (K + 0.5) * e exactly K requests are admitted and the (K+1)th is refused. The
 * documented tolerance is therefore ZERO extra admissions while every actual cost <= its estimate;
 * overshoot only appears once an actual cost exceeds its estimate (see the last describe block).
 */
import http from 'http';
import request from 'supertest';

let mockRateLimitRefuses = false;
jest.mock('../rateLimitGuard', () => ({
    rateLimitGuard: (_req: any, res: any, next: any) => {
        if (mockRateLimitRefuses) return res.status(429).json({ error: { type: 'rate_limited' } });
        next();
    },
}));

import { initDb, getDb, seedPricing, createBudgetLimit } from '@llm-observer/database';
import { createApp } from '../app';
import { OpenAIProvider } from '../providers/openai';
import { refreshPricingCache } from '../utils/pricing';
import { _getCacheForTest } from '../budgetGuard';
import { internalLogger } from '../internalLogger';
import { estimateRequestTokens, estimateRequestCost, extractMaxOutputTokens } from '../services/costEstimator';

const UPSTREAM_PORT = 16150;
const PROXY_PORT = 16151;
const DEAD_PORT = 16159;
const BASE = `http://127.0.0.1:${PROXY_PORT}`;

// Loaded lazily so a missing module fails the assertion that needs it, not the whole file.
const ledger = (): any => require('../services/spendLedger').spendLedger;

interface UpstreamMode {
    delayMs: number;
    status: number;
    promptTokens: number;
    completionTokens: number;
    stream: boolean;
    /** send headers and part of a body, then kill the socket */
    dropMidResponse?: boolean;
}
const DEFAULT_MODE: UpstreamMode = { delayMs: 250, status: 200, promptTokens: 5, completionTokens: 10, stream: false };
let mode: UpstreamMode = { ...DEFAULT_MODE };
let upstreamHits = 0;
/** Upstream responses still being produced. Tests that abort clients leave some behind; the next test must not inherit them. */
let upstreamActive = 0;

const handleUpstream = (req: http.IncomingMessage, res: http.ServerResponse) => {
    upstreamActive++;
    let counted = true;
    const done = () => { if (counted) { counted = false; upstreamActive--; } };
    res.on('close', done);
    req.on('error', done);
    req.resume();
    req.on('end', () => {
        upstreamHits++;
        const m = { ...mode };
        const usage = { prompt_tokens: m.promptTokens, completion_tokens: m.completionTokens, total_tokens: m.promptTokens + m.completionTokens };
        if (m.dropMidResponse) {
            res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': '5000' });
            res.write('{"id":"c1",');
            setTimeout(() => res.socket?.destroy(), m.delayMs);
            return;
        }
        if (m.status >= 400) {
            setTimeout(() => {
                res.writeHead(m.status, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: { message: 'upstream failure' } }));
            }, m.delayMs);
            return;
        }
        if (m.stream) {
            res.writeHead(200, { 'Content-Type': 'text/event-stream' });
            res.write(`data: ${JSON.stringify({ id: 'c1', choices: [{ delta: { content: 'hi' } }] })}\n\n`);
            setTimeout(() => {
                res.write(`data: ${JSON.stringify({ id: 'c1', choices: [], usage })}\n\n`);
                res.write('data: [DONE]\n\n');
                res.end();
            }, m.delayMs);
            return;
        }
        setTimeout(() => {
            if (res.writableEnded || res.destroyed) return;
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ id: 'c1', choices: [{ message: { role: 'assistant', content: 'ok' } }], usage }));
        }, m.delayMs);
    });
};

const waitFor = async (cond: () => boolean, ms = 3000) => {
    const end = Date.now() + ms;
    while (!cond()) {
        if (Date.now() > end) throw new Error('waitFor timed out');
        await new Promise(r => setTimeout(r, 10));
    }
};

const addBudget = (over: Record<string, any>) => createBudgetLimit({
    name: 'test', scope: 'provider', scope_value: 'openai', period: 'daily', limit_usd: 1,
    warning_pct_1: 0.8, warning_pct_2: 0.9, kill_switch: true, safety_buffer_usd: 0.0001,
    estimate_multiplier: 3, is_active: true, ...over,
} as any);

const bodyFor = (model = 'gpt-4o-mini', extra: Record<string, any> = {}) =>
    ({ model, max_tokens: 2000, messages: [{ role: 'user', content: 'hello there' }], ...extra });

/** The estimate the guard will reserve for this body (same functions the guard calls). */
const estimateFor = (body: any, provider = 'openai') =>
    estimateRequestCost(provider, body.model, estimateRequestTokens(body), 3, extractMaxOutputTokens(body));

const post = (body: any) => request(BASE).post('/v1/openai/chat/completions').send(body);

describe('K1 kill switch counts queued and in-flight spend (createApp + mock upstream)', () => {
    let upstream: http.Server;
    let server: http.Server;
    let baseUrlSpy: jest.SpyInstance;

    beforeAll(async () => {
        initDb(':memory:');
        seedPricing();
        refreshPricingCache();
        upstream = http.createServer(handleUpstream);
        await new Promise<void>(r => upstream.listen(UPSTREAM_PORT, '127.0.0.1', r));
        server = http.createServer(createApp());
        await new Promise<void>(r => server.listen(PROXY_PORT, '127.0.0.1', r));
        baseUrlSpy = jest.spyOn(OpenAIProvider.prototype, 'getBaseUrl').mockReturnValue(`http://127.0.0.1:${UPSTREAM_PORT}`);
    });

    afterAll(async () => {
        baseUrlSpy.mockRestore();
        await internalLogger.flush();
        await new Promise<void>(r => { server.closeAllConnections?.(); server.close(() => r()); });
        await new Promise<void>(r => { upstream.closeAllConnections?.(); upstream.close(() => r()); });
    });

    beforeEach(async () => {
        await internalLogger.flush();
        const db = getDb();
        db.prepare('DELETE FROM requests').run();
        db.prepare('DELETE FROM budgets').run();
        db.prepare("INSERT OR IGNORE INTO projects (id, name) VALUES ('default', 'Default Project')").run();
        db.prepare("UPDATE projects SET daily_budget = NULL, kill_switch = 0, safety_buffer = 0.0001 WHERE id = 'default'").run();
        _getCacheForTest().clear();
        mode = { ...DEFAULT_MODE };
        upstreamHits = 0;
        try { ledger()._resetForTests(); } catch { /* module may not exist on the pre-fix code */ }
    });

    afterEach(async () => {
        // A request whose client gave up is still answered by the mock (default 250ms) and then logged. If that
        // happened after the next test's cleanup, its row (5 + 10 tokens = $6.75e-6) would leak into that test's
        // totals - seen on slower CI runners. Wait for every straggler, give back the reservations, then flush.
        const deadline = Date.now() + 5000;
        while ((upstreamActive > 0 || ledger().inFlight() > 0) && Date.now() < deadline) {
            await new Promise(r => setTimeout(r, 20));
        }
        await internalLogger.flush();
    });

    describe('(1) a burst of concurrent requests', () => {
        const N = 12;
        const K = 4;

        const burst = async (body: any) => {
            const results = await Promise.all(Array.from({ length: N }, () => post(body)));
            const admitted = results.filter(r => r.status === 200);
            const refused = results.filter(r => r.status === 429);
            return { results, admitted, refused };
        };

        it('provider budget: admits at most K of N, refuses the rest with the budget 429, leaves the ledger empty', async () => {
            const body = bodyFor();
            const e = estimateFor(body);
            addBudget({ scope: 'provider', scope_value: 'openai', limit_usd: e * (K + 0.5) });

            const { admitted, refused } = await burst(body);

            expect(admitted.length).toBeLessThanOrEqual(K);   // the headline claim
            expect(admitted.length).toBe(K);                  // and the derived tolerance is zero
            expect(refused.length).toBe(N - K);
            expect(upstreamHits).toBe(K);
            for (const r of refused) {
                expect(r.body.error).toMatchObject({ type: 'budget_insufficient', scope: 'provider', scope_value: 'openai' });
            }
            // the refused ones saw the admitted ones' reservations as spend
            expect(refused[0].body.error.spent_usd).toBeCloseTo(K * e, 9);

            expect(ledger().inFlight()).toBe(0);
            expect(ledger().totalReservedUsd()).toBe(0);
        });

        it('global budget: same bound', async () => {
            const body = bodyFor();
            const e = estimateFor(body);
            addBudget({ scope: 'global', scope_value: null, limit_usd: e * (K + 0.5) });
            const { admitted, refused } = await burst(body);
            expect(admitted.length).toBe(K);
            expect(refused.length).toBe(N - K);
            expect(ledger().inFlight()).toBe(0);
        });

        it('model budget: same bound', async () => {
            const body = bodyFor();
            const e = estimateFor(body);
            addBudget({ scope: 'model', scope_value: 'gpt-4o-mini', limit_usd: e * (K + 0.5) });
            const { admitted } = await burst(body);
            expect(admitted.length).toBe(K);
            expect(ledger().inFlight()).toBe(0);
        });

        it('the tightest of several matching budgets wins and a request is reserved once, not once per budget', async () => {
            const body = bodyFor();
            const e = estimateFor(body);
            addBudget({ name: 'g', scope: 'global', scope_value: null, limit_usd: e * 8.5 });
            addBudget({ name: 'm', scope: 'model', scope_value: 'gpt-4o-mini', limit_usd: e * 5.5 });
            addBudget({ name: 'p', scope: 'provider', scope_value: 'openai', limit_usd: e * 3.5 });
            const { admitted, refused } = await burst(body);
            expect(admitted.length).toBe(3);
            expect(refused[0].body.error.scope).toBe('provider');
            expect(ledger().inFlight()).toBe(0);
        });

        it('project-level (legacy) budget: same bound', async () => {
            const body = bodyFor();
            const e = estimateFor(body);
            getDb().prepare("UPDATE projects SET daily_budget = ?, kill_switch = 1, safety_buffer = 0.0001 WHERE id = 'default'").run(e * (K + 0.5));
            _getCacheForTest().clear();
            const { admitted, refused } = await burst(body);
            expect(admitted.length).toBe(K);
            expect(refused.length).toBe(N - K);
            expect(refused[0].body.error).toMatchObject({ type: 'budget_insufficient', scope: 'project' });
            expect(ledger().inFlight()).toBe(0);
        });

        it('unknown model: the estimate fallback is what is reserved', async () => {
            const body = bodyFor('zz-not-a-priced-model', { max_tokens: 1000 });
            const e = estimateFor(body);
            expect(e).toBeGreaterThan(0.05); // fallback ($15/$75 per M) proves no pricing row matched
            addBudget({ scope: 'global', scope_value: null, limit_usd: e * 2.5 });
            const { admitted } = await burst(body);
            expect(admitted.length).toBe(2);
            expect(ledger().inFlight()).toBe(0);
        });

        it('after the burst has completed its rows are queued, and still count', async () => {
            const body = bodyFor();
            const e = estimateFor(body);
            // actual cost of a response (5 in / 10 out tokens) is far below e: capacity returns as rows land
            addBudget({ scope: 'provider', scope_value: 'openai', limit_usd: e * (K + 0.5) });
            await burst(body);
            // Now try again: the K recorded rows are tiny, so a new request fits, and is not blocked by stale reservations
            const again = await post(body);
            expect(again.status).toBe(200);
        });
    });

    describe('(2) rows queued but not yet flushed count toward the limit', () => {
        const queuedRow = (cost: number) => ({
            id: `queued-${Math.random().toString(36).slice(2)}`, project_id: 'default', provider: 'openai', model: 'gpt-4o-mini',
            endpoint: '/v1/chat/completions', prompt_tokens: 1, completion_tokens: 1, total_tokens: 2, cost_usd: cost,
            latency_ms: 1, status_code: 200, status: 'success', created_at: new Date().toISOString(),
        } as any);

        it('blocks on queued spend, and does not double count once the batch flushes', async () => {
            addBudget({ scope: 'global', scope_value: null, limit_usd: 1, safety_buffer_usd: 0.05 });
            await internalLogger.add(queuedRow(0.99));
            expect((getDb().prepare("SELECT COUNT(*) AS n FROM requests WHERE status = 'success'").get() as any).n).toBe(0); // really unflushed

            const before = await post(bodyFor());
            expect(before.status).toBe(429);
            expect(before.body.error.spent_usd).toBeCloseTo(0.99, 9);

            await internalLogger.flush();
            expect((getDb().prepare("SELECT COUNT(*) AS n FROM requests WHERE status = 'success'").get() as any).n).toBe(1);

            const after = await post(bodyFor());
            expect(after.status).toBe(429);
            expect(after.body.error.spent_usd).toBeCloseTo(0.99, 9); // not 1.98
            expect(upstreamHits).toBe(0);
        });

        it('a completed proxied request is counted while its row is still queued', async () => {
            const body = bodyFor();
            const e = estimateFor(body);
            const actual = new OpenAIProvider().calculateCost('gpt-4o-mini', 5, 10).costUsd;
            expect(actual).toBeGreaterThan(0);
            // fits one estimate fresh, but not after the first request's real cost is recorded
            addBudget({ scope: 'global', scope_value: null, limit_usd: actual * 1.1 + 0, safety_buffer_usd: actual * 0.2 });
            const first = await post(body);
            expect(first.status).toBe(200);
            expect((getDb().prepare('SELECT COUNT(*) AS n FROM requests').get() as any).n).toBe(0); // queued, not in SQLite
            const second = await post(body);
            expect(second.status).toBe(429);
            expect(second.body.error.spent_usd).toBeCloseTo(actual, 12);
            expect(e).toBeGreaterThan(actual);
        });

        it('a streamed response is counted at its final cost (from the stream usage) while queued', async () => {
            mode = { ...DEFAULT_MODE, stream: true, delayMs: 120, promptTokens: 1000, completionTokens: 3000 };
            const body = bodyFor('gpt-4o-mini', { stream: true });
            const actual = new OpenAIProvider().calculateCost('gpt-4o-mini', 1000, 3000).costUsd;
            addBudget({ scope: 'global', scope_value: null, limit_usd: actual * 1.1, safety_buffer_usd: actual * 0.2 });

            const inflight = post(body).then(r => r);
            await waitFor(() => upstreamHits === 1);
            expect(ledger().inFlight()).toBe(1);
            const first = await inflight;
            expect(first.status).toBe(200);
            await waitFor(() => ledger().inFlight() === 0);

            const second = await post(body);
            expect(second.status).toBe(429);
            expect(second.body.error.spent_usd).toBeCloseTo(actual, 12);
        });
    });

    describe('(3) reservations are released', () => {
        it('while a request is in flight its estimate is reserved, and it is gone after success', async () => {
            const body = bodyFor();
            const e = estimateFor(body);
            addBudget({ scope: 'global', scope_value: null, limit_usd: 100 });
            mode = { ...DEFAULT_MODE, delayMs: 200 };
            const pending = post(body).then(r => r);
            await waitFor(() => upstreamHits === 1);
            expect(ledger().inFlight()).toBe(1);
            expect(ledger().totalReservedUsd()).toBeCloseTo(e, 12);
            await pending;
            expect(ledger().inFlight()).toBe(0);
        });

        it('on a client abort', async () => {
            const body = bodyFor();
            const e = estimateFor(body);
            addBudget({ scope: 'global', scope_value: null, limit_usd: e * 1.5 });
            mode = { ...DEFAULT_MODE, delayMs: 600 };

            const req = http.request({ host: '127.0.0.1', port: PROXY_PORT, path: '/v1/openai/chat/completions', method: 'POST', headers: { 'content-type': 'application/json' } });
            req.on('error', () => { /* expected: we destroy it */ });
            req.end(JSON.stringify(body));
            await waitFor(() => upstreamHits === 1);
            expect(ledger().inFlight()).toBe(1);

            // while it is in flight the budget (one estimate) is taken
            const blocked = await post(body);
            expect(blocked.status).toBe(429);

            req.destroy();
            await waitFor(() => ledger().inFlight() === 0, 3000);
            expect(ledger().totalReservedUsd()).toBe(0);

            // and the capacity is available again
            mode = { ...DEFAULT_MODE, delayMs: 10 };
            const next = await post(body);
            expect(next.status).toBe(200);
        });

        it('on an upstream 5xx', async () => {
            const body = bodyFor();
            const e = estimateFor(body);
            addBudget({ scope: 'global', scope_value: null, limit_usd: e * 1.5 });
            mode = { ...DEFAULT_MODE, status: 503, delayMs: 50 };
            const failed = await post(body);
            expect(failed.status).toBe(503);
            expect(ledger().inFlight()).toBe(0);
            expect(ledger().totalReservedUsd()).toBe(0);

            mode = { ...DEFAULT_MODE, delayMs: 10 };
            const next = await post(body);
            expect(next.status).toBe(200); // the failed attempt cost $0 and held nothing back
        });

        it('when the upstream drops the connection part-way through its response', async () => {
            const body = bodyFor();
            const e = estimateFor(body);
            addBudget({ scope: 'global', scope_value: null, limit_usd: e * 1.5 });
            mode = { ...DEFAULT_MODE, dropMidResponse: true, delayMs: 50 };
            await post(body).then(() => undefined, () => undefined); // the client sees an error or a truncated body, not a hang
            await waitFor(() => ledger().inFlight() === 0, 3000);
            expect(ledger().totalReservedUsd()).toBe(0);
        });

        it('on an unreachable upstream (502)', async () => {
            baseUrlSpy.mockReturnValue(`http://127.0.0.1:${DEAD_PORT}`);
            try {
                const body = bodyFor();
                const e = estimateFor(body);
                addBudget({ scope: 'global', scope_value: null, limit_usd: e * 1.5 });
                const failed = await post(body);
                expect(failed.status).toBe(502);
                expect(ledger().inFlight()).toBe(0);
            } finally {
                baseUrlSpy.mockReturnValue(`http://127.0.0.1:${UPSTREAM_PORT}`);
            }
        });

        it('when a later guard (the rate limiter) refuses the request, so it never reaches the upstream', async () => {
            const body = bodyFor();
            addBudget({ scope: 'global', scope_value: null, limit_usd: 100 });
            mockRateLimitRefuses = true;
            try {
                const res = await post(body);
                expect(res.status).toBe(429);
                expect(res.body.error.type).toBe('rate_limited');
            } finally {
                mockRateLimitRefuses = false;
            }
            expect(upstreamHits).toBe(0);
            await waitFor(() => ledger().inFlight() === 0, 1000);
            expect(ledger().totalReservedUsd()).toBe(0);
        });

        it('when the route itself rejects the request (malformed custom target)', async () => {
            addBudget({ scope: 'global', scope_value: null, limit_usd: 100 });
            const res = await request(BASE).post('/v1/custom/%E0%A4%A/chat').send(bodyFor());
            expect(res.status).toBeGreaterThanOrEqual(400);
            await waitFor(() => ledger().inFlight() === 0, 1000);
        });
    });

    describe('(5) a final cost above its estimate can overshoot by at most the difference', () => {
        it('sequential requests: recorded spend exceeds the limit by less than (actual - estimate) of the last admitted request', async () => {
            // No max_tokens, tiny prompt: the estimate assumes ~3x the input as output, the "model" answers far more.
            const body = { model: 'gpt-4o-mini', messages: [{ role: 'user', content: 'hello there' }] };
            const e = estimateFor(body);
            const actual = new OpenAIProvider().calculateCost('gpt-4o-mini', 5, 20_000).costUsd;
            expect(actual).toBeGreaterThan(e * 10);
            mode = { ...DEFAULT_MODE, delayMs: 20, promptTokens: 5, completionTokens: 20_000 };
            const limit = actual * 1.7;
            addBudget({ scope: 'global', scope_value: null, limit_usd: limit, safety_buffer_usd: 0.0000001 });

            const statuses: number[] = [];
            for (let i = 0; i < 4; i++) statuses.push((await post(body)).status);
            await internalLogger.flush();

            // 1st: spent 0 admitted. 2nd: spent = actual (0.59 of limit), admitted. 3rd: spent 2*actual > limit: refused.
            expect(statuses).toEqual([200, 200, 429, 429]);
            const recorded = (getDb().prepare('SELECT COALESCE(SUM(cost_usd), 0) AS s FROM requests').get() as any).s;
            const overshoot = recorded - limit;
            expect(overshoot).toBeGreaterThan(0);                 // it is real, and not hidden
            expect(overshoot).toBeLessThan(actual - e);           // the documented bound
        });

        it('concurrent requests: the overshoot is bounded by the sum of the (actual - estimate) differences of the admitted ones', async () => {
            const body = { model: 'gpt-4o-mini', messages: [{ role: 'user', content: 'hello there' }] };
            const e = estimateFor(body);
            const actual = new OpenAIProvider().calculateCost('gpt-4o-mini', 5, 20_000).costUsd;
            mode = { ...DEFAULT_MODE, delayMs: 100, promptTokens: 5, completionTokens: 20_000 };
            const limit = e * 6.5; // reservations alone would admit 6
            addBudget({ scope: 'global', scope_value: null, limit_usd: limit, safety_buffer_usd: 0.0000001 });

            const results = await Promise.all(Array.from({ length: 10 }, () => post(body)));
            await internalLogger.flush();
            const admitted = results.filter(r => r.status === 200).length;
            expect(admitted).toBe(6);
            // Only this test's rows: they alone answered with 20,000 completion tokens.
            const recorded = (getDb().prepare('SELECT COALESCE(SUM(cost_usd), 0) AS s FROM requests WHERE completion_tokens = 20000').get() as any).s;
            expect(recorded).toBeCloseTo(admitted * actual, 9);
            expect(recorded - limit).toBeLessThan(admitted * (actual - e));
        });
    });
});
