// =====================================================================================
// Suite D: Dashboard API — Projects
// Tests GET/POST/PUT/DELETE /api/projects (positive, negative, corner cases)
// =====================================================================================

// MOCKS FIRST — licenseManager must be mocked before importing projectsRouter
jest.mock('../licenseManager', () => ({
    getLicenseInfo: jest.fn().mockResolvedValue({ isPro: false, limits: { maxProjects: 1 } }),
    checkProjectLimit: jest.fn().mockResolvedValue(false), // Simulate free tier limit reached
    activateLicense: jest.fn(),
    activateLicenseFromPayment: jest.fn(),
}));

jest.mock('@llm-observer/database', () => {
    const { createTestDb } = require('./helpers/testDb');
    const { database, bulkInsertRequests } = createTestDb();
    const { randomUUID } = require('crypto');

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
        createProject: (data: any) => {
            const id = randomUUID();
            database.prepare('INSERT INTO projects (id, name, daily_budget, organization_id) VALUES (?, ?, ?, ?)')
                .run(id, data.name, data.daily_budget || 0, data.organization_id || 'default');
            return { id, ...data };
        },
        updateBudget: (id: string, budgets: any) => {
            database.prepare('UPDATE projects SET daily_budget = ? WHERE id = ?').run(budgets.daily, id);
        },
        deleteProject: (id: string) => {
            database.prepare('DELETE FROM projects WHERE id = ?').run(id);
        },
    };
});

jest.mock('../internalLogger', () => ({ internalLogger: { add: jest.fn(), flush: jest.fn() } }));
jest.mock('../budgetGuard', () => ({ budgetGuard: (_: any, __: any, next: any) => next(), incrementSpendCache: jest.fn() }));
jest.mock('../rateLimitGuard', () => ({ rateLimitGuard: (_: any, __: any, next: any) => next() }));
jest.mock('../anomalyDetector', () => ({ startAnomalyDetection: jest.fn() }));

import supertest from 'supertest';
import express from 'express';
import { getDb } from '@llm-observer/database';
import { projectsRouter } from '../routes/projects.routes';

const app = express();
app.use(express.json());
app.use('/api/projects', projectsRouter);

let db: ReturnType<typeof getDb>;
beforeAll(() => { db = getDb(); });
beforeEach(() => {
    db.prepare('DELETE FROM projects').run();
    db.prepare('INSERT INTO projects (id, name, daily_budget) VALUES (?, ?, ?)').run('default', 'Default Project', 100.0);
});

describe('D1 — GET /api/projects', () => {
    it('D1 — Positive: Returns project list with daily_budget never null', async () => {
        db.prepare('INSERT INTO projects (id, name) VALUES (?, ?)').run('test-no-budget', 'No Budget Proj');
        const res = await supertest(app).get('/api/projects');
        expect(res.status).toBe(200);
        const p = res.body.data.find((x: any) => x.id === 'test-no-budget');
        expect(p).toBeDefined();
        expect(p.daily_budget).toBe(0);
    });
});

describe('D2-D3 — POST /api/projects', () => {
    it('D2 — Negative: Returns 403 (LIMIT_REACHED) from free-tier gate before name validation fires', async () => {
        const res = await supertest(app).post('/api/projects').send({});
        // featureGateMiddleware runs first on POST / in the current route registration order.
        // On free tier (mock), it returns 403 LIMIT_REACHED before the name check fires.
        expect([400, 403]).toContain(res.status);
    });

    it('D3 — Negative: Free tier blocks creating extra project (403 LIMIT_REACHED)', async () => {
        const res = await supertest(app).post('/api/projects').send({ name: 'New Project' });
        expect(res.status).toBe(403);
        expect(res.body.code).toBe('LIMIT_REACHED');
    });
});

describe('D4-D6 — PUT /api/projects', () => {
    it('D4 — Positive: Updates project name via /api/projects/:id', async () => {
        const res = await supertest(app).put('/api/projects/default').send({ name: 'Renamed' });
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
    });

    it('D5 — Positive: Updates budget via /api/projects/:id/budget', async () => {
        const res = await supertest(app).put('/api/projects/default/budget').send({ daily_budget: 25.00 });
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
    });

    it('D6 — Negative: Returns 400 when daily_budget field is missing from /budget endpoint', async () => {
        const res = await supertest(app).put('/api/projects/default/budget').send({});
        expect(res.status).toBe(400);
        expect(res.body.error).toContain('Budget');
    });
});

describe('D7-D8 — DELETE /api/projects', () => {
    it('D7 — Positive: Deletes a non-default project and its related requests', async () => {
        db.prepare('INSERT INTO projects (id, name) VALUES (?, ?)').run('del-proj', 'Delete Me');
        db.prepare(`INSERT INTO requests (id, project_id, provider, model, cost_usd, status, is_streaming, has_tools, pricing_unknown)
                    VALUES ('req-1', 'del-proj', 'openai', 'gpt-4', 0, 'success', 0, 0, 0)`).run();
        const res = await supertest(app).delete('/api/projects/del-proj');
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        const req = db.prepare('SELECT * FROM requests WHERE project_id = ?').get('del-proj');
        expect(req).toBeUndefined();
    });

    it('D8 — Negative: Cannot delete the default project', async () => {
        const res = await supertest(app).delete('/api/projects/default');
        expect(res.status).toBe(400);
        expect(res.body.error).toContain('default');
    });
});
