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

const mockCreate = jest.fn();
jest.mock('@anthropic-ai/sdk', () => {
    return jest.fn().mockImplementation(() => ({
        messages: { create: mockCreate }
    }));
});

import express from 'express';
import request from 'supertest';
import optimizeRoutes from '../routes/optimize.routes';

const app = express();
app.use(express.json());
app.use('/api/optimize', optimizeRoutes);

describe('AI Analyst', () => {
    beforeEach(() => {
        mockCreate.mockReset();
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

    it('refuses to analyze without a key', async () => {
        const res = await request(app).post('/api/optimize/ai/analyze');
        expect(res.status).toBe(400);
        expect(res.body.error).toContain('API key');
    });

    it('runs an analysis: sends aggregates only, returns structured recommendations', async () => {
        await request(app).post('/api/optimize/ai/key').send({ apiKey: 'sk-ant-api-valid-key' });

        mockCreate.mockResolvedValueOnce({
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
        });

        const res = await request(app).post('/api/optimize/ai/analyze');
        expect(res.status).toBe(200);
        expect(res.body.result.summary).toContain('Cache reads');
        expect(res.body.result.recommendations).toHaveLength(1);
        expect(res.body.result.recommendations[0].category).toBe('caching');

        // Privacy: the request body contains aggregates, never prompts/paths
        const callArg = mockCreate.mock.calls[0][0];
        expect(callArg.model).toBe('claude-opus-4-8');
        const sent = JSON.stringify(callArg.messages);
        expect(sent).toContain('cache_read_tokens');
        expect(sent).not.toContain('/Users/');

        // Result is persisted and retrievable
        const last = await request(app).get('/api/optimize/ai/last');
        expect(last.body.result.summary).toContain('Cache reads');
    });

    it('surfaces API failures as 502 without crashing', async () => {
        await request(app).post('/api/optimize/ai/key').send({ apiKey: 'sk-ant-api-valid-key' });
        mockCreate.mockRejectedValueOnce(new Error('overloaded_error'));
        const res = await request(app).post('/api/optimize/ai/analyze');
        expect(res.status).toBe(502);
        expect(res.body.error).toContain('overloaded');
    });
});
