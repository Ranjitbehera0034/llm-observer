// The AI analyst is opt-in. The Anthropic SDK is an external of the proxy
// bundle and is not installed alongside the published CLI, so merely loading
// the proxy (which mounts optimize.routes) must never require it.

jest.mock('@llm-observer/database', () => ({
    getDb: () => ({ prepare: () => ({ all: () => [], get: () => ({ c: 0 }) }) }),
    getSetting: (k: string) => (k === 'ai_analyst_api_key' ? 'enc:sk-ant-api-valid-key' : null),
    updateSetting: () => undefined,
    encrypt: (v: string) => `enc:${v}`,
    decrypt: (v: string) => v.replace(/^enc:/, '')
}));

// Simulate a machine where @anthropic-ai/sdk is not installed.
jest.mock('@anthropic-ai/sdk', () => {
    const err: any = new Error("Cannot find module '@anthropic-ai/sdk'");
    err.code = 'MODULE_NOT_FOUND';
    throw err;
});

import express from 'express';
import request from 'supertest';

describe('AI analyst without @anthropic-ai/sdk installed', () => {
    it('loads the routes without throwing', () => {
        expect(() => require('../routes/optimize.routes')).not.toThrow();
    });

    it('serves non-AI endpoints and returns a clear error only when analysis is requested', async () => {
        const optimizeRoutes = require('../routes/optimize.routes').default;
        const app = express();
        app.use(express.json());
        app.use('/api/optimize', optimizeRoutes);

        const keyRes = await request(app).get('/api/optimize/ai/key');
        expect(keyRes.status).toBe(200);
        expect(keyRes.body.configured).toBe(true);

        const res = await request(app).post('/api/optimize/ai/analyze');
        expect(res.status).toBe(501);
        expect(res.body.error).toMatch(/@anthropic-ai\/sdk/);
        expect(res.body.error).toMatch(/npm install/);
    });
});
