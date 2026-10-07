// ── Mocks must be registered before importing anything that uses them ────────
const settingsStore: Record<string, string> = {};

jest.mock('@llm-observer/database', () => ({
    getDb: () => ({
        prepare: (sql: string) => ({
            all: () => {
                if (sql.includes('FROM sessions')) {
                    return [{
                        provider: 'claude-code', model: 'claude-sonnet-5', sessions: 3, agentic_sessions: 3,
                        input_tokens: 36644, output_tokens: 101661,
                        cache_read_tokens: 18128598, cache_write_tokens: 714059,
                        estimated_cost_usd: 11.3578, avg_cache_hit_rate: 0.99
                    }];
                }
                if (sql.includes('FROM tool_usage_daily')) {
                    return [{ tool_name: 'Bash', calls: 188 }, { tool_name: 'Read', calls: 57 }];
                }
                return [];
            },
            get: () => ({ c: 1 })
        })
    }),
    getSetting: (k: string) => settingsStore[k] ?? null,
    updateSetting: (k: string, v: string) => { settingsStore[k] = v; },
    encrypt: (v: string) => `enc:${v}`,
    decrypt: (v: string) => v.replace(/^enc:/, '')
}));

// The analyst calls the Messages API with plain fetch (no SDK is installed
// with the published CLI, the desktop sidecar or Docker).
const mockFetch = jest.fn();
const jsonResponse = (status: number, body: unknown) => ({
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
    json: async () => body
});

import express from 'express';
import request from 'supertest';
import optimizeRoutes from '../routes/optimize.routes';

const app = express();
app.use(express.json());
app.use('/api/optimize', optimizeRoutes);

describe('AI Analyst', () => {
    const realFetch = (global as any).fetch;
    beforeEach(() => {
        mockFetch.mockReset();
        (global as any).fetch = mockFetch;
        for (const k of Object.keys(settingsStore)) delete settingsStore[k];
    });

    it('reports unconfigured, rejects admin keys and garbage, accepts a standard key', async () => {
        let res = await request(app).get('/api/optimize/ai/key');
        expect(res.body.configured).toBe(false);

        res = await request(app).post('/api/optimize/ai/key').send({ apiKey: 'sk-ant-admin-xyz' });
        expect(res.status).toBe(400);
        expect(res.body.error).toContain('Admin keys');

        res = await request(app).post('/api/optimize/ai/key').send({ apiKey: 'not-a-key' });
        expect(res.status).toBe(400);

        res = await request(app).post('/api/optimize/ai/key').send({ apiKey: 'sk-ant-api-valid-key' });
        expect(res.status).toBe(200);
        expect(res.body.configured).toBe(true);
        // stored encrypted, never plaintext
        expect(settingsStore['ai_analyst_api_key']).toBe('enc:sk-ant-api-valid-key');
    });

    afterAll(() => { (global as any).fetch = realFetch; });

    it('refuses to analyze without a key', async () => {
        const res = await request(app).post('/api/optimize/ai/analyze');
        expect(res.status).toBe(400);
        expect(res.body.error).toContain('API key');
    });

    it('runs an analysis: sends aggregates only, returns structured recommendations', async () => {
        await request(app).post('/api/optimize/ai/key').send({ apiKey: 'sk-ant-api-valid-key' });

        mockFetch.mockResolvedValueOnce(jsonResponse(200, {
            model: 'claude-opus-4-8',
            stop_reason: 'end_turn',
            content: [{
                type: 'text',
                text: JSON.stringify({
                    summary: 'Cache reads dominate your spend.',
                    recommendations: [{
                        title: 'Keep prompt caching healthy',
                        detail: '99% cache hit rate is excellent; protect it.',
                        category: 'caching',
                        estimated_monthly_savings_usd: 0
                    }]
                })
            }]
        }));

        const res = await request(app).post('/api/optimize/ai/analyze');
        expect(res.status).toBe(200);
        expect(res.body.result.summary).toContain('Cache reads');
        expect(res.body.result.recommendations).toHaveLength(1);
        expect(res.body.result.recommendations[0].category).toBe('caching');

        // Privacy: the request body contains aggregates, never prompts/paths
        expect(mockFetch).toHaveBeenCalledTimes(1);
        const [url, init] = mockFetch.mock.calls[0];
        expect(url).toBe('https://api.anthropic.com/v1/messages');
        expect(init.method).toBe('POST');
        expect(init.headers['x-api-key']).toBe('sk-ant-api-valid-key');
        expect(init.headers['anthropic-version']).toBe('2023-06-01');
        expect(init.headers['content-type']).toBe('application/json');
        const callArg = JSON.parse(init.body);
        expect(callArg.max_tokens).toBe(16000);
        expect(typeof callArg.system).toBe('string');
        expect(callArg.model).toBe('claude-opus-4-8');
        const sent = JSON.stringify(callArg.messages);
        expect(sent).toContain('cache_read_tokens');
        expect(sent).not.toContain('/Users/');

        // Result is persisted and retrievable
        const last = await request(app).get('/api/optimize/ai/last');
        expect(last.body.result.summary).toContain('Cache reads');
    });

    it('surfaces an API error response (invalid key, rate limit, overload) as 502 with the API message', async () => {
        await request(app).post('/api/optimize/ai/key').send({ apiKey: 'sk-ant-api-valid-key' });

        mockFetch.mockResolvedValueOnce(jsonResponse(401, { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } }));
        let res = await request(app).post('/api/optimize/ai/analyze');
        expect(res.status).toBe(502);
        expect(res.body.error).toContain('401');
        expect(res.body.error).toContain('invalid x-api-key');

        mockFetch.mockResolvedValueOnce(jsonResponse(429, { type: 'error', error: { type: 'rate_limit_error', message: 'Number of requests has exceeded your rate limit' } }));
        res = await request(app).post('/api/optimize/ai/analyze');
        expect(res.status).toBe(502);
        expect(res.body.error).toContain('429');
        expect(res.body.error).toContain('rate limit');

        mockFetch.mockResolvedValueOnce(jsonResponse(529, { type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } }));
        res = await request(app).post('/api/optimize/ai/analyze');
        expect(res.status).toBe(502);
        expect(res.body.error).toContain('overloaded');
    });

    it('surfaces a network failure as 502 without crashing', async () => {
        await request(app).post('/api/optimize/ai/key').send({ apiKey: 'sk-ant-api-valid-key' });
        mockFetch.mockRejectedValueOnce(new TypeError('fetch failed'));
        const res = await request(app).post('/api/optimize/ai/analyze');
        expect(res.status).toBe(502);
        expect(res.body.error).toContain('fetch failed');
    });

    it('reports a refusal or truncation from the model as 502', async () => {
        await request(app).post('/api/optimize/ai/key').send({ apiKey: 'sk-ant-api-valid-key' });
        mockFetch.mockResolvedValueOnce(jsonResponse(200, { model: 'claude-opus-4-8', stop_reason: 'max_tokens', content: [] }));
        const res = await request(app).post('/api/optimize/ai/analyze');
        expect(res.status).toBe(502);
        expect(res.body.error).toContain('truncated');
    });

    it('does not depend on @anthropic-ai/sdk at all (it is not installed with the CLI, sidecar or Docker)', () => {
        const fs = require('fs');
        const path = require('path');
        const src = fs.readFileSync(path.join(__dirname, '..', 'services', 'aiAnalyst.ts'), 'utf8');
        expect(src).not.toMatch(/@anthropic-ai\/sdk/);
        const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'package.json'), 'utf8'));
        expect(Object.keys(pkg.dependencies || {})).not.toContain('@anthropic-ai/sdk');
    });

    it('honours LLM_OBSERVER_ANTHROPIC_BASE_URL (dev/test override)', async () => {
        await request(app).post('/api/optimize/ai/key').send({ apiKey: 'sk-ant-api-valid-key' });
        process.env.LLM_OBSERVER_ANTHROPIC_BASE_URL = 'http://127.0.0.1:1/';
        try {
            mockFetch.mockRejectedValueOnce(new TypeError('fetch failed'));
            await request(app).post('/api/optimize/ai/analyze');
            expect(mockFetch.mock.calls[0][0]).toBe('http://127.0.0.1:1/v1/messages');
        } finally {
            delete process.env.LLM_OBSERVER_ANTHROPIC_BASE_URL;
        }
    });
});
