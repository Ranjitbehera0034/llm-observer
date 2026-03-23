/**
 * Integration tests for v1.2.0 OpenAI Sync.
 */

// ── Database mock ────────────────────────────────────────────────────────────
jest.mock('@llm-observer/database', () => {
    const { createTestDb } = require('./helpers/testDb');
    const { database } = createTestDb();
    return {
        getDb: () => database,
        initDb: () => database,
        encrypt: (v: string) => `enc:${v}`,
        decrypt: (v: string) => v.replace('enc:', ''),
        validateApiKey: () => ({ project_id: 'default' }),
        getSetting: () => null,
        updateSetting: () => { },
        getAlertRules: () => [],
        createAlert: () => { },
        seedPricing: () => { },
        seedDefaultApiKey: () => { },
    };
});

// ── Sync manager mock ────────────────────────────────────────────────────────
jest.mock('../sync', () => ({
    usageSyncManager: { refreshConfig: jest.fn(), start: jest.fn(), stop: jest.fn() }
}));

// ── node-fetch mock ───────────────────────────────────────────────────────────
jest.mock('node-fetch', () => jest.fn());

import express from 'express';
import request from 'supertest';
import { getDb } from '@llm-observer/database';
import syncRoutes from '../routes/sync.routes';

// ── Test app ──────────────────────────────────────────────────────────────────
const app = express();
app.use(express.json());
app.use('/api/sync', syncRoutes);

// ── Helpers ───────────────────────────────────────────────────────────────────
function seedUsageRecord(db: any, provider: string, model: string, cost: number, date: string) {
    db.prepare(`
        INSERT INTO usage_records
        (provider, model, bucket_start, bucket_width, input_tokens, output_tokens, cache_read_tokens, num_requests, cost_usd, raw_json)
        VALUES (?, ?, ?, '1d', 1000, 500, 0, 5, ?, '{}')
    `).run(provider, model, date + 'T00:00:00', cost);
}

// ─────────────────────────────────────────────────────────────────────────────
describe('OpenAI Sync Integration', () => {
    let db: any;
    const fetchMock = require('node-fetch') as jest.Mock;

    beforeAll(() => { db = getDb(); });
    beforeEach(() => { 
        db.prepare('DELETE FROM usage_records').run(); 
        db.prepare('DELETE FROM usage_sync_configs').run();
        fetchMock.mockReset();
    });

    describe('POST /api/sync/providers/openai/key', () => {
        it('rejects project keys (sk-proj-)', async () => {
            const res = await request(app)
                .post('/api/sync/providers/openai/key')
                .send({ adminKey: 'sk-proj-invalid' });
            expect(res.status).toBe(400);
            expect(res.body.error).toMatch(/project API key/i);
        });

        it('rejects Anthropic keys (sk-ant-)', async () => {
            const res = await request(app)
                .post('/api/sync/providers/openai/key')
                .send({ adminKey: 'sk-ant-admin-wrong' });
            expect(res.status).toBe(400);
            expect(res.body.error).toMatch(/Anthropic key/i);
        });

        it('accepts valid admin key and stores it', async () => {
            fetchMock.mockResolvedValueOnce({
                ok: true,
                status: 200,
                text: async () => 'OK',
                headers: { get: () => null }
            });

            const res = await request(app)
                .post('/api/sync/providers/openai/key')
                .send({ adminKey: 'sk-admin-valid123' });

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            
            const config = db.prepare("SELECT * FROM usage_sync_configs WHERE id = 'openai'").get() as any;
            expect(config).toBeDefined();
            expect(config.admin_key_enc).toBe('enc:sk-admin-valid123');
        });
    });

    describe('Aggregated Usage Routes', () => {
        const today = new Date().toISOString().split('T')[0];

        beforeEach(() => {
            seedUsageRecord(db, 'anthropic', 'claude-3-sonnet', 3.00, today);
            seedUsageRecord(db, 'openai', 'gpt-4o', 2.00, today);
        });

        it('GET /usage/today returns aggregated totals and providers', async () => {
            const res = await request(app).get('/api/sync/usage/today');
            expect(res.status).toBe(200);
            expect(res.body.total).toBeCloseTo(5.00, 2);
            expect(res.body.providers.anthropic).toBeCloseTo(3.00, 2);
            expect(res.body.providers.openai).toBeCloseTo(2.00, 2);
            expect(res.body.models).toHaveLength(2);
        });

        it('GET /usage/today with ?provider=openai filters results', async () => {
            const res = await request(app).get('/api/sync/usage/today?provider=openai');
            expect(res.status).toBe(200);
            expect(res.body.total).toBeCloseTo(2.00, 2);
            expect(res.body.providers.openai).toBeCloseTo(2.00, 2);
            expect(res.body.providers.anthropic).toBeUndefined();
            expect(res.body.models).toHaveLength(1);
            expect(res.body.models[0].provider).toBe('openai');
        });

        it('GET /usage/daily stacks providers correctly', async () => {
            const res = await request(app).get('/api/sync/usage/daily?days=1');
            expect(res.status).toBe(200);
            const point = res.body.find((p: any) => p.date === today);
            expect(point).toBeDefined();
            expect(point.anthropic).toBeCloseTo(3.00, 2);
            expect(point.openai).toBeCloseTo(2.00, 2);
            expect(point.total).toBeCloseTo(5.00, 2);
        });

        it('GET /usage/by-model includes both Claude and GPT models', async () => {
            const res = await request(app).get('/api/sync/usage/by-model?days=7');
            expect(res.status).toBe(200);
            expect(res.body).toHaveLength(2);
            const models = res.body.map((m: any) => m.model);
            expect(models).toContain('claude-3-sonnet');
            expect(models).toContain('gpt-4o');
        });
    });
});
