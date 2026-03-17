// =====================================================================================
// Suite C: Dashboard API — Requests
// Tests GET /api/requests and GET /api/requests/:id (positive, negative, corner cases)
// =====================================================================================

// MOCKS FIRST
jest.mock('@llm-observer/database', () => {
    const { createTestDb } = require('./helpers/testDb');
    const { database, bulkInsertRequests } = createTestDb();
    return {
        getDb: () => database,
        initDb: () => database,
        bulkInsertRequests,
        validateApiKey: () => ({ project_id: 'default' }),
        getSetting: () => null,
        updateSetting: jest.fn(),
        getAlertRules: () => [],
        createAlert: jest.fn(),
        seedPricing: jest.fn(),
        seedDefaultApiKey: jest.fn(),
        initPricingCache: jest.fn(),
    };
});
jest.mock('../internalLogger', () => ({ internalLogger: { add: jest.fn(), flush: jest.fn() } }));
jest.mock('../budgetGuard', () => ({ budgetGuard: (_: any, __: any, next: any) => next(), incrementSpendCache: jest.fn() }));
jest.mock('../rateLimitGuard', () => ({ rateLimitGuard: (_: any, __: any, next: any) => next() }));
jest.mock('../anomalyDetector', () => ({ startAnomalyDetection: jest.fn() }));

import supertest from 'supertest';
import express from 'express';
import { getDb, bulkInsertRequests } from '@llm-observer/database';
import { requestsRouter } from '../routes/requests.routes';

const app = express();
app.use(express.json());
app.use('/api/requests', requestsRouter);

let db: ReturnType<typeof getDb>;

beforeAll(() => { db = getDb(); });
beforeEach(() => { db.prepare('DELETE FROM requests').run(); });

// =========================== GET /api/requests ===========================

describe('C1 — GET /api/requests', () => {

    it('C1.1 — Positive: Returns empty list with correct pagination meta on fresh DB', async () => {
        const res = await supertest(app).get('/api/requests');
        expect(res.status).toBe(200);
        expect(res.body.data).toEqual([]);
        expect(res.body.meta.total).toBe(0);
        expect(res.body.meta.totalPages).toBe(0);
    });

    it('C1.2 — Positive: Returns data filtered by projectId', async () => {
        db.prepare('INSERT OR IGNORE INTO projects (id, name, daily_budget) VALUES (?, ?, ?)').run('p1', 'Project 1', 0);
        db.prepare('INSERT OR IGNORE INTO projects (id, name, daily_budget) VALUES (?, ?, ?)').run('p2', 'Project 2', 0);
        bulkInsertRequests([{ project_id: 'p1', provider: 'openai', model: 'gpt-4', cost_usd: 0.001 } as any]);
        bulkInsertRequests([{ project_id: 'p2', provider: 'anthropic', model: 'claude-3', cost_usd: 0.002 } as any]);
        const res = await supertest(app).get('/api/requests?projectId=p1');
        expect(res.status).toBe(200);
        // Should only return the p1 request (filtered)
        expect(res.body.data.length).toBe(1);
    });

    it('C1.3 — Positive: Filters by provider', async () => {
        bulkInsertRequests([{ provider: 'openai', model: 'gpt-4', project_id: 'default', cost_usd: 0 } as any]);
        bulkInsertRequests([{ provider: 'anthropic', model: 'claude-3', project_id: 'default', cost_usd: 0 } as any]);
        const res = await supertest(app).get('/api/requests?provider=openai');
        expect(res.status).toBe(200);
        expect(res.body.data.every((r: any) => r.provider === 'openai')).toBe(true);
    });

    it('C1.4 — Positive: Filters by status=error', async () => {
        bulkInsertRequests([{ status: 'error', status_code: 429, project_id: 'default', provider: 'openai', model: 'gpt', cost_usd: 0 } as any]);
        bulkInsertRequests([{ status: 'success', status_code: 200, project_id: 'default', provider: 'openai', model: 'gpt', cost_usd: 0 } as any]);
        const res = await supertest(app).get('/api/requests?status=error');
        expect(res.status).toBe(200);
        expect(res.body.data.every((r: any) => r.status_code >= 400 || r.status === 'error')).toBe(true);
    });

    it('C1.5 — Positive: Pagination works correctly with page=1&limit=2', async () => {
        bulkInsertRequests(Array.from({ length: 5 }, (_, i) => ({ project_id: 'default', provider: 'openai', model: `gpt-${i}`, cost_usd: 0 } as any)));
        const res = await supertest(app).get('/api/requests?page=1&limit=2');
        expect(res.status).toBe(200);
        expect(res.body.data.length).toBe(2);
        expect(res.body.meta.page).toBe(1);
        expect(res.body.meta.totalPages).toBe(3);
    });

    it('C1.6 — Corner: limit=200 is capped at 100', async () => {
        bulkInsertRequests(Array.from({ length: 110 }, () => ({ project_id: 'default', provider: 'openai', model: 'gpt-4', cost_usd: 0 } as any)));
        const res = await supertest(app).get('/api/requests?limit=200');
        expect(res.status).toBe(200);
        expect(res.body.data.length).toBeLessThanOrEqual(100);
    });

    it('C1.7 — Corner: Rows with null total_tokens return 0 not null', async () => {
        db.prepare(`INSERT INTO requests (id, project_id, provider, model, cost_usd, status, is_streaming, has_tools, pricing_unknown)
                    VALUES ('null-tokens', 'default', 'openai', 'gpt-4', 0, 'success', 0, 0, 0)`).run();
        const res = await supertest(app).get('/api/requests?projectId=default');
        expect(res.status).toBe(200);
        const row = res.body.data.find((r: any) => r.id === 'null-tokens');
        expect(row).toBeDefined();
        expect(row.total_tokens).toBe(0);
        expect(row.prompt_tokens).toBe(0);
        expect(row.cost_usd).toBe(0);
    });

    it('C1.8 — Positive: metadata field is returned in response', async () => {
        bulkInsertRequests([{ project_id: 'default', provider: 'openai', model: 'gpt-4', cost_usd: 0, metadata: '{"userId":"user_123"}' } as any]);
        const res = await supertest(app).get('/api/requests');
        expect(res.status).toBe(200);
        expect(res.body.data[0].metadata).toBe('{"userId":"user_123"}');
    });
});

// =========================== GET /api/requests/:id ===========================

describe('C2 — GET /api/requests/:id', () => {

    it('C2.1 — Positive: Returns full record for existing ID', async () => {
        const id = 'test-id-123';
        db.prepare(`INSERT INTO requests (id, project_id, provider, model, cost_usd, status, is_streaming, has_tools, pricing_unknown, metadata)
                    VALUES (?, 'default', 'openai', 'gpt-4', 0.002, 'success', 0, 0, 0, '{}')`)
          .run(id);
        const res = await supertest(app).get(`/api/requests/${id}`);
        expect(res.status).toBe(200);
        expect(res.body.data.id).toBe(id);
    });

    it('C2.2 — Negative: Returns 404 for non-existent ID', async () => {
        const res = await supertest(app).get('/api/requests/non-existent-id');
        expect(res.status).toBe(404);
        expect(res.body.error).toBe('Request not found');
    });

    it('C2.3 — Corner: SQL injection in ID param does not crash server (prepared stmt protection)', async () => {
        const res = await supertest(app).get("/api/requests/' OR '1'='1");
        expect(res.status).toBe(404); // Returns 404, not 500 or a data leak
    });
});
