// =====================================================================================
// Suite F: Settings & Alerts API + Suite G: Auth API
// =====================================================================================
jest.mock('@llm-observer/database', () => {
    const { createTestDb } = require('./helpers/testDb');
    const { database, bulkInsertRequests } = createTestDb();
    const { randomUUID } = require('crypto');
    let settings: Record<string, string> = { openai_api_key: 'sk-proj-1234abcd5678efgh' };

    return {
        getDb: () => database, initDb: () => database, bulkInsertRequests,
        validateApiKey: () => ({ project_id: 'default' }),
        getSetting: (k: string) => settings[k] || null,
        updateSetting: (k: string, v: string) => { settings[k] = v; },
        getAllSettings: () => ({ ...settings }),
        updateSettings: (data: any) => { Object.assign(settings, data); },
        getAlertRules: (pid: string) => database.prepare('SELECT * FROM alert_rules WHERE project_id = ?').all(pid),
        createAlertRule: (data: any) => {
            const id = randomUUID();
            database.prepare('INSERT INTO alert_rules (id, project_id, organization_id, name, condition_type, threshold, is_active) VALUES (?, ?, ?, ?, ?, ?, 1)')
                .run(id, data.project_id || 'default', 'default', data.name || 'test', data.condition_type || 'error_rate', data.threshold || 10);
            return id;
        },
        deleteAlertRule: (id: string) => database.prepare('DELETE FROM alert_rules WHERE id = ?').run(id),
        getAlerts: (pid: string) => database.prepare('SELECT * FROM alerts WHERE project_id = ?').all(pid),
        acknowledgeAlert: (id: string) => database.prepare('UPDATE alerts SET is_active = 0 WHERE id = ?').run(id),
        createApiKey: (name: string, projectId: string) => {
            const id = randomUUID();
            const key = `llmo_${randomUUID().replace(/-/g, '')}`;
            database.prepare('INSERT INTO api_keys (id, project_id, name, key_hash, key_hint, created_at) VALUES (?, ?, ?, ?, ?, ?)')
                .run(id, projectId, name, 'hash', key.slice(-4), new Date().toISOString());
            return { id, key, name, project_id: projectId };
        },
        createAlert: jest.fn(),
        seedPricing: jest.fn(), seedDefaultApiKey: jest.fn(), initPricingCache: jest.fn(),
    };
});
jest.mock('../internalLogger', () => ({ internalLogger: { add: jest.fn(), flush: jest.fn() } }));
jest.mock('../budgetGuard', () => ({ budgetGuard: (_: any, __: any, next: any) => next(), incrementSpendCache: jest.fn() }));
jest.mock('../rateLimitGuard', () => ({ rateLimitGuard: (_: any, __: any, next: any) => next() }));
jest.mock('../anomalyDetector', () => ({ startAnomalyDetection: jest.fn() }));

import supertest from 'supertest';
import express from 'express';
import { getDb } from '@llm-observer/database';
import { settingsRouter } from '../routes/settings.routes';
import { authRouter } from '../routes/auth.routes';

const settingsApp = express();
settingsApp.use(express.json());
settingsApp.use('/', settingsRouter);

const authApp = express();
authApp.use(express.json());
authApp.use('/api/auth', authRouter);

let db: ReturnType<typeof getDb>;
beforeAll(() => { db = getDb(); });

// =================== SUITE F: SETTINGS ===================
describe('F — Settings & Alert-Rules API', () => {
    it('F1 — Positive: GET /settings returns 200 with data', async () => {
        const res = await supertest(settingsApp).get('/settings');
        expect(res.status).toBe(200);
        expect(res.body.data).toBeDefined();
    });

    it('F2 — Positive: GET /settings redacts API key', async () => {
        const res = await supertest(settingsApp).get('/settings');
        expect(res.status).toBe(200);
        const key = res.body.data.openai_api_key as string;
        expect(key).toContain('****');
        expect(key).not.toBe('sk-proj-1234abcd5678efgh');
    });

    it('F3 — Positive: PUT /settings saves new value', async () => {
        const res = await supertest(settingsApp).put('/settings').send({ openai_api_key: 'sk-new-key' });
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
    });

    it('F4 — Positive: GET /alert-rules returns empty list', async () => {
        db.prepare('DELETE FROM alert_rules').run();
        const res = await supertest(settingsApp).get('/alert-rules?projectId=default');
        expect(res.status).toBe(200);
        expect(Array.isArray(res.body.data)).toBe(true);
    });

    it('F5 — Positive: POST /alert-rules creates rule', async () => {
        const res = await supertest(settingsApp).post('/alert-rules').send({
            name: 'High Latency', condition_type: 'latency_spike', threshold: 2000, projectId: 'default'
        });
        expect(res.status).toBe(200);
        expect(res.body.data.id).toBeDefined();
    });

    it('F7 — Positive: DELETE /alert-rules/:id deletes a rule', async () => {
        const id: any = db.prepare(`INSERT INTO alert_rules (id, project_id, organization_id, name, condition_type, threshold, is_active)
            VALUES ('test-rule-id', 'default', 'default', 'Test', 'error_rate', 10, 1)`).run();
        const res = await supertest(settingsApp).delete('/alert-rules/test-rule-id');
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
    });

    it('F8 — Positive: GET /alerts returns list', async () => {
        const res = await supertest(settingsApp).get('/alerts?projectId=default');
        expect(res.status).toBe(200);
        expect(Array.isArray(res.body.data)).toBe(true);
    });
});

// =================== SUITE G: AUTH ===================
describe('G — Auth API', () => {
    it('G1 — Positive: GET /api/auth/keys returns list', async () => {
        const res = await supertest(authApp).get('/api/auth/keys?projectId=default');
        expect(res.status).toBe(200);
        expect(Array.isArray(res.body.data)).toBe(true);
    });

    it('G2 — Positive: POST /api/auth/keys creates key', async () => {
        const res = await supertest(authApp).post('/api/auth/keys').send({ name: 'CI Key', projectId: 'default' });
        expect(res.status).toBe(200);
        expect(res.body.data.key).toBeDefined();
        expect(res.body.data.name).toBe('CI Key');
    });

    it('G3 — Negative: POST without name returns 400', async () => {
        const res = await supertest(authApp).post('/api/auth/keys').send({});
        expect(res.status).toBe(400);
        expect(res.body.error).toContain('Name');
    });

    it('G4 — Positive: DELETE /api/auth/keys/:id removes a key', async () => {
        // Insert with unique key_hash to avoid conflict across test runs
        const uniqueHash = `hash_${Date.now()}`;
        db.prepare(`INSERT OR IGNORE INTO api_keys (id, project_id, name, key_hash, key_hint, created_at)
                    VALUES ('g4-key-id', 'default', 'Delete Me', ?, '0000', datetime('now'))`).run(uniqueHash);
        const res = await supertest(authApp).delete('/api/auth/keys/g4-key-id');
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        const stillExists = db.prepare('SELECT * FROM api_keys WHERE id = ?').get('g4-key-id');
        expect(stillExists).toBeUndefined();
    });

    it('G5 — Corner: DELETE /api/auth/keys/:id with non-existent ID is a no-op (200)', async () => {
        const res = await supertest(authApp).delete('/api/auth/keys/nonexistent');
        expect(res.status).toBe(200);
    });
});
