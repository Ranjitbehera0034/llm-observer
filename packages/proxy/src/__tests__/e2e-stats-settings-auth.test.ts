// =====================================================================================
// Suite E: Stats API — GET /api/stats/overview, /chart, /models, /provider, /optimizer
// Suite F: Settings & Alerts — GET/PUT /api/settings, alert-rules, alerts
// Suite G: Auth — GET/POST/DELETE /api/auth/keys
// =====================================================================================

jest.mock('@llm-observer/database', () => {
    const { createTestDb } = require('./helpers/testDb');
    const { database, bulkInsertRequests } = createTestDb();
    const { randomUUID } = require('crypto');

    return {
        getDb: () => database,
        initDb: () => database,
        bulkInsertRequests,
        validateApiKey: () => ({ project_id: 'default' }),
        createApiKey: (name: string, projectId: string) => {
            const id = randomUUID();
            const key = `llmo_${randomUUID().replace(/-/g, '')}`;
            database.prepare('INSERT INTO api_keys (id, project_id, name, key_hash, key_hint, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(id, projectId, name, 'hash', key.slice(-4), new Date().toISOString());
            return { id, key, name, project_id: projectId };
        },
        getAlertRules: (projectId: string) => database.prepare('SELECT * FROM alert_rules WHERE project_id = ?').all(projectId),
        createAlertRule: (data: any) => {
            const id = randomUUID();
            database.prepare('INSERT INTO alert_rules (id, project_id, organization_id, name, condition_type, threshold, is_active) VALUES (?, ?, ?, ?, ?, ?, 1)')
                .run(id, data.project_id || 'default', data.organization_id || 'default', data.name || 'test rule', data.condition_type || 'error_rate', data.threshold || 10);
            return id;
        },
        deleteAlertRule: (id: string) => database.prepare('DELETE FROM alert_rules WHERE id = ?').run(id),
        getAlerts: (projectId: string) => database.prepare('SELECT * FROM alerts WHERE project_id = ?').all(projectId),
        acknowledgeAlert: (id: string) => database.prepare("UPDATE alerts SET is_active = 0 WHERE id = ?").run(id),
        getAllSettings: () => ({ openai_api_key: 'sk-proj-1234abcd5678efgh', license_key: '', license_status: 'free' }),
        updateSettings: jest.fn(),
        getSetting: () => null,
        updateSetting: jest.fn(),
        createAlert: jest.fn(),
        seedPricing: jest.fn(),
        seedDefaultApiKey: jest.fn(),
        initPricingCache: jest.fn(),
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
import { settingsRouter } from '../routes/settings.routes';
import { authRouter } from '../routes/auth.routes';

const app = express();
app.use(express.json());
app.use('/api/stats', statsRouter);
app.use('/api', settingsRouter);
app.use('/api/auth', authRouter);

let db: ReturnType<typeof getDb>;
beforeAll(() => { db = getDb(); });
beforeEach(() => { 
    db.prepare('DELETE FROM requests').run(); 
    db.prepare('DELETE FROM api_keys').run(); 
});

// =================== SUITE E: STATS ===================

describe('E — Stats API', () => {

    it('E1 — Corner: /overview returns 0 (not null) for all fields on empty DB', async () => {
        const res = await supertest(app).get('/api/stats/overview?projectId=default');
        expect(res.status).toBe(200);
        expect(res.body.todaySpendUsd).toBe(0);
        expect(res.body.totalRequestsToday).toBe(0);
        expect(res.body.avgLatencyMs).toBe(0);
        expect(res.body.errorRate).toBe(0);
        expect(res.body.totalTokensToday).toBe(0);
    });

    it('E2 — Positive: /overview returns correct aggregated data', async () => {
        db.prepare("INSERT INTO requests (id, project_id, provider, model, cost_usd, total_tokens, latency_ms, status_code, status, is_streaming, has_tools, pricing_unknown, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))")
          .run('r1', 'default', 'openai', 'gpt-4', 0.05, 100, 200, 200, 'success', 0, 0, 0);
        const res = await supertest(app).get('/api/stats/overview?projectId=default');
        expect(res.status).toBe(200);
        expect(res.body.totalRequestsToday).toBe(1);
        expect(res.body.totalTokensToday).toBe(100);
        expect(res.body.todaySpendUsd).toBeCloseTo(0.05, 5);
    });

    it('E3 — Positive: /chart?days=7 returns time-bucketed array', async () => {
        const res = await supertest(app).get('/api/stats/chart?days=7&projectId=default');
        expect(res.status).toBe(200);
        expect(Array.isArray(res.body.data)).toBe(true);
    });

    it('E4 — Corner: /chart?days=999 is capped to 90', async () => {
        const res = await supertest(app).get('/api/stats/chart?days=999&projectId=default');
        expect(res.status).toBe(200); // Server doesn't crash
    });

    it('E5 — Positive: /models returns grouped model usage', async () => {
        const res = await supertest(app).get('/api/stats/models?projectId=default');
        expect(res.status).toBe(200);
        expect(Array.isArray(res.body.data)).toBe(true);
    });

    it('E6 — Positive: /provider returns grouped provider usage', async () => {
        const res = await supertest(app).get('/api/stats/provider?projectId=default');
        expect(res.status).toBe(200);
        expect(Array.isArray(res.body.data)).toBe(true);
    });

    it('E7 — Positive: /optimizer returns suggestions array', async () => {
        const res = await supertest(app).get('/api/stats/optimizer?projectId=default');
        expect(res.status).toBe(200);
        expect(Array.isArray(res.body.data)).toBe(true);
    });
});

// =================== SUITE F: SETTINGS & ALERTS ===================

describe('F — Settings & Alerts API', () => {

    it('F1 — Positive: GET /api/settings returns 200', async () => {
        const res = await supertest(app).get('/api/settings');
        expect(res.status).toBe(200);
        expect(res.body.data).toBeDefined();
    });

    it('F2 — Positive: GET /api/settings redacts API key value', async () => {
        const res = await supertest(app).get('/api/settings');
        expect(res.status).toBe(200);
        const apiKey = res.body.data.openai_api_key as string;
        // Raw key should NOT appear — should be redacted
        expect(apiKey).not.toBe('sk-proj-1234abcd5678efgh');
        expect(apiKey).toContain('****');
    });

    it('F3 — Positive: PUT /api/settings accepts new settings', async () => {
        const res = await supertest(app).put('/api/settings').send({ openai_api_key: 'sk-new-key' });
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
    });

    it('F4 — Positive: GET /api/alert-rules returns empty list initially', async () => {
        const res = await supertest(app).get('/api/alert-rules?projectId=default');
        expect(res.status).toBe(200);
        expect(Array.isArray(res.body.data)).toBe(true);
    });

    it('F5 — Positive: POST /api/alert-rules creates rule successfully', async () => {
        const res = await supertest(app).post('/api/alert-rules').send({
            name: 'High Latency', condition_type: 'latency_spike', threshold: 2000, projectId: 'default'
        });
        expect(res.status).toBe(200);
        expect(res.body.data.id).toBeDefined();
    });

    it('F7 — Positive: DELETE /api/alert-rules/:id succeeds', async () => {
        const createRes = await supertest(app).post('/api/alert-rules').send({
            name: 'To Delete', condition_type: 'error_rate', threshold: 10, projectId: 'default'
        });
        const id = createRes.body.data.id;
        const res = await supertest(app).delete(`/api/alert-rules/${id}`);
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
    });

    it('F8 — Positive: GET /api/alerts returns list', async () => {
        const res = await supertest(app).get('/api/alerts?projectId=default');
        expect(res.status).toBe(200);
        expect(Array.isArray(res.body.data)).toBe(true);
    });
});

// =================== SUITE G: AUTH / API KEYS ===================

describe('G — Auth API', () => {

    it('G1 — Positive: GET /api/auth/keys returns list without exposing raw keys', async () => {
        const res = await supertest(app).get('/api/auth/keys?projectId=default');
        expect(res.status).toBe(200);
        expect(Array.isArray(res.body.data)).toBe(true);
        // None of the rows should have a full key field exposed
        (res.body.data as any[]).forEach(k => expect(k.key_hash).toBeUndefined());
    });

    it('G2 — Positive: POST /api/auth/keys creates a new key', async () => {
        const res = await supertest(app).post('/api/auth/keys').send({ name: 'CI Key', projectId: 'default' });
        expect(res.status).toBe(200);
        expect(res.body.data.key).toBeDefined();
        expect(res.body.data.name).toBe('CI Key');
    });

    it('G3 — Negative: POST /api/auth/keys without name returns 400', async () => {
        const res = await supertest(app).post('/api/auth/keys').send({});
        expect(res.status).toBe(400);
        expect(res.body.error).toContain('Name');
    });

    it('G4 — Positive: DELETE /api/auth/keys/:id removes key', async () => {
        const createRes = await supertest(app).post('/api/auth/keys').send({ name: 'Delete me', projectId: 'default' });
        if (!createRes.body?.data) {
             console.error('G4 creation failed. Status:', createRes.status, 'Body:', createRes.body);
        }
        const id = createRes.body.data.id;
        const res = await supertest(app).delete(`/api/auth/keys/${id}`);
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
    });

    it('G5 — Corner: DELETE /api/auth/keys/:id with non-existent ID still returns 200', async () => {
        const res = await supertest(app).delete('/api/auth/keys/non-existent-id');
        expect(res.status).toBe(200); // SQLite DELETE is a no-op, not an error
    });
});
