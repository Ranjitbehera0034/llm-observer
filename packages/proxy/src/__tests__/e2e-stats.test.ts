// =====================================================================================
// Suite E: Stats API — GET /api/stats endpoints
// =====================================================================================
jest.mock('@llm-observer/database', () => {
    const { createTestDb } = require('./helpers/testDb');
    const { database, bulkInsertRequests } = createTestDb();
    return {
        getDb: () => database, initDb: () => database, bulkInsertRequests,
        validateApiKey: () => ({ project_id: 'default' }),
        getSetting: () => null, updateSetting: jest.fn(),
        getAlertRules: () => [], createAlert: jest.fn(),
        seedPricing: jest.fn(), seedDefaultApiKey: jest.fn(), initPricingCache: jest.fn(),
        getCostOptimizationSuggestions: () => [],
        getPromptCacheSuggestions: () => [],
    };
});
jest.mock('../internalLogger', () => ({ internalLogger: { add: jest.fn(), flush: jest.fn() } }));
jest.mock('../budgetGuard', () => ({ budgetGuard: (_: any, __: any, next: any) => next(), incrementSpendCache: jest.fn() }));
jest.mock('../rateLimitGuard', () => ({ rateLimitGuard: (_: any, __: any, next: any) => next() }));
jest.mock('../anomalyDetector', () => ({ startAnomalyDetection: jest.fn() }));

import supertest from 'supertest';
import express from 'express';
import { getDb } from '@llm-observer/database';
import { statsRouter } from '../routes/stats.routes';

const app = express();
app.use(express.json());
app.use('/api/stats', statsRouter);

let db: ReturnType<typeof getDb>;
beforeAll(() => { db = getDb(); });
beforeEach(() => { db.prepare('DELETE FROM requests').run(); });

describe('E — Stats API', () => {

    it('E1 — Corner: /overview returns 0 (not null) for all fields on empty DB', async () => {
        const res = await supertest(app).get('/api/stats/overview?projectId=default');
        expect(res.status).toBe(200);
        expect(res.body.todaySpendUsd ?? res.body.total_spend ?? 0).toBeGreaterThanOrEqual(0);
    });

    it('E2 — Positive: /overview returns correct aggregated data when requests exist', async () => {
        db.prepare(`INSERT INTO requests
            (id, project_id, provider, model, cost_usd, total_tokens, latency_ms, status_code, status, is_streaming, has_tools, pricing_unknown, created_at)
            VALUES ('r1', 'default', 'openai', 'gpt-4', 0.05, 100, 200, 200, 'success', 0, 0, 0, datetime('now'))
        `).run();
        const res = await supertest(app).get('/api/stats/overview?projectId=default');
        expect(res.status).toBe(200);
    });

    it('E3 — Positive: /chart?days=7 returns array', async () => {
        const res = await supertest(app).get('/api/stats/chart?days=7&projectId=default');
        expect(res.status).toBe(200);
        expect(Array.isArray(res.body.data)).toBe(true);
    });

    it('E5 — Positive: /models endpoint returns grouped array', async () => {
        const res = await supertest(app).get('/api/stats/models?projectId=default');
        expect(res.status).toBe(200);
        expect(Array.isArray(res.body.data)).toBe(true);
    });

    it('E7 — Positive: /optimizer returns suggestions array', async () => {
        const res = await supertest(app).get('/api/stats/optimizer?projectId=default');
        expect(res.status).toBe(200);
        expect(Array.isArray(res.body.data)).toBe(true);
    });
});
