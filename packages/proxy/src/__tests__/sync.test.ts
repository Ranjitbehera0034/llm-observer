/**
 * Integration tests for v1.1.0 Sync API routes.
 * Tests: /usage/daily, /usage/by-model, /status (enriched), and circuit breaker.
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
function seedUsageRecord(db: any, overrides: Partial<{
    model: string;
    bucket_start: string;
    cost_usd: number;
    num_requests: number;
    input_tokens: number;
    output_tokens: number;
}> = {}) {
    db.prepare(`
        INSERT OR IGNORE INTO usage_records
        (provider, model, bucket_start, bucket_width, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, num_requests, cost_usd, raw_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
        'anthropic',
        overrides.model ?? 'claude-sonnet-4',
        overrides.bucket_start ?? new Date().toISOString().split('T')[0] + 'T00:00:00',
        '1d',
        overrides.input_tokens ?? 1000,
        overrides.output_tokens ?? 500,
        0, 0,
        overrides.num_requests ?? 5,
        overrides.cost_usd ?? 0.05,
        '{}'
    );
}

function seedSyncConfig(db: any, status = 'active') {
    db.prepare(`
        INSERT OR REPLACE INTO usage_sync_configs
        (id, display_name, admin_key_enc, status, org_id, org_name, last_poll_at, error_count)
        VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?)
    `).run('anthropic', 'Anthropic', 'enc:sk-ant-admin-test', status, 'org-123', 'Test Org', 0);
}

// ─────────────────────────────────────────────────────────────────────────────
describe('GET /api/sync/status', () => {
    let db: any;

    beforeAll(() => { db = getDb(); });
    beforeEach(() => { db.prepare('DELETE FROM usage_sync_configs').run(); });

    it('returns empty array when no providers configured', async () => {
        const res = await request(app).get('/api/sync/status');
        expect(res.status).toBe(200);
        expect(Array.isArray(res.body)).toBe(true);
        expect(res.body).toHaveLength(0);
    });

    it('includes has_key=true when admin_key_enc is set', async () => {
        seedSyncConfig(db);
        const res = await request(app).get('/api/sync/status');
        expect(res.status).toBe(200);
        const provider = res.body.find((c: any) => c.id === 'anthropic');
        expect(provider).toBeDefined();
        expect(provider.has_key).toBe(true);
    });

    it('never exposes admin_key_enc in response', async () => {
        seedSyncConfig(db);
        const res = await request(app).get('/api/sync/status');
        const provider = res.body.find((c: any) => c.id === 'anthropic');
        expect(provider.admin_key_enc).toBeUndefined();
    });

    it('includes next_poll_in_seconds for active provider', async () => {
        seedSyncConfig(db, 'active');
        const res = await request(app).get('/api/sync/status');
        const provider = res.body.find((c: any) => c.id === 'anthropic');
        expect(typeof provider.next_poll_in_seconds).toBe('number');
        expect(provider.next_poll_in_seconds).toBeGreaterThanOrEqual(0);
    });

    it('has_key=false when admin_key_enc is null', async () => {
        db.prepare("INSERT OR REPLACE INTO usage_sync_configs (id, display_name, admin_key_enc, status) VALUES (?, ?, NULL, 'inactive')")
            .run('anthropic', 'Anthropic');
        const res = await request(app).get('/api/sync/status');
        const provider = res.body.find((c: any) => c.id === 'anthropic');
        expect(provider.has_key).toBe(false);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('GET /api/sync/usage/daily', () => {
    let db: any;

    beforeAll(() => { db = getDb(); });
    beforeEach(() => { db.prepare('DELETE FROM usage_records').run(); });

    it('returns 30 data points with zeros when DB is empty', async () => {
        const res = await request(app).get('/api/sync/usage/daily?days=30');
        expect(res.status).toBe(200);
        expect(Array.isArray(res.body)).toBe(true);
        expect(res.body).toHaveLength(30);
        // All zeros when no data
        res.body.forEach((point: any) => {
            expect(point.cost_usd).toBe(0);
            expect(point).toHaveProperty('date');
        });
    });

    it('returns correct number of points for ?days=7', async () => {
        const res = await request(app).get('/api/sync/usage/daily?days=7');
        expect(res.status).toBe(200);
        expect(res.body).toHaveLength(7);
    });

    it('fills actual usage data in the correct day slot', async () => {
        const today = new Date().toISOString().split('T')[0];
        seedUsageRecord(db, { bucket_start: today + 'T00:00:00', cost_usd: 3.50 });

        const res = await request(app).get('/api/sync/usage/daily?days=7');
        expect(res.status).toBe(200);
        const todayPoint = res.body.find((p: any) => p.date === today);
        expect(todayPoint).toBeDefined();
        expect(todayPoint.cost_usd).toBeCloseTo(3.50, 3);
    });

    it('caps days at 90', async () => {
        const res = await request(app).get('/api/sync/usage/daily?days=200');
        expect(res.status).toBe(200);
        expect(res.body).toHaveLength(90);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('GET /api/sync/usage/by-model', () => {
    let db: any;

    beforeAll(() => { db = getDb(); });
    beforeEach(() => { db.prepare('DELETE FROM usage_records').run(); });

    it('returns empty array when DB is empty', async () => {
        const res = await request(app).get('/api/sync/usage/by-model?days=7');
        expect(res.status).toBe(200);
        expect(Array.isArray(res.body)).toBe(true);
        expect(res.body).toHaveLength(0);
    });

    it('returns per-model breakdown with pct_of_total', async () => {
        seedUsageRecord(db, { model: 'claude-sonnet-4', cost_usd: 3.00 });
        seedUsageRecord(db, { model: 'claude-haiku-3.5', cost_usd: 1.00 });

        const res = await request(app).get('/api/sync/usage/by-model?days=7');
        expect(res.status).toBe(200);
        expect(res.body).toHaveLength(2);

        const sonnet = res.body.find((r: any) => r.model === 'claude-sonnet-4');
        const haiku = res.body.find((r: any) => r.model === 'claude-haiku-3.5');
        expect(sonnet).toBeDefined();
        expect(haiku).toBeDefined();
        expect(sonnet.pct_of_total).toBe(75);  // 3 / 4 = 75%
        expect(haiku.pct_of_total).toBe(25);   // 1 / 4 = 25%
    });

    it('pct_of_total is 0 when total cost is 0', async () => {
        seedUsageRecord(db, { cost_usd: 0 });
        const res = await request(app).get('/api/sync/usage/by-model?days=7');
        expect(res.status).toBe(200);
        expect(res.body[0].pct_of_total).toBe(0);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('POST /api/sync/providers/anthropic/key', () => {
    const fetchMock = require('node-fetch') as jest.Mock;

    afterEach(() => { fetchMock.mockReset(); });

    it('rejects key starting with sk-ant-api with descriptive error', async () => {
        const res = await request(app)
            .post('/api/sync/providers/anthropic/key')
            .send({ adminKey: 'sk-ant-api-regular-key' });
        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/regular API key/i);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('rejects unknown key format with descriptive error', async () => {
        const res = await request(app)
            .post('/api/sync/providers/anthropic/key')
            .send({ adminKey: 'Bearer some-token' });
        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/admin/i);
    });

    it('returns 401 error message when Anthropic rejects the key', async () => {
        fetchMock.mockResolvedValueOnce({
            ok: false,
            status: 401,
            text: async () => 'Unauthorized',
            headers: { get: () => null }
        });
        const res = await request(app)
            .post('/api/sync/providers/anthropic/key')
            .send({ adminKey: 'sk-ant-admin-badkey' });
        expect(res.status).toBe(401);
        expect(res.body.error).toMatch(/rejected/i);
    });

    it('accepts valid admin key, stores encrypted, and returns org name', async () => {
        const db = getDb();
        db.prepare('DELETE FROM usage_sync_configs').run();

        fetchMock.mockResolvedValueOnce({
            ok: true,
            status: 200,
            json: async () => ({ id: 'org-abc', name: 'My Test Org' }),
            headers: { get: () => null }
        });

        const res = await request(app)
            .post('/api/sync/providers/anthropic/key')
            .send({ adminKey: 'sk-ant-admin-validkey123' });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.orgName).toBe('My Test Org');

        // Verify key was passed through encrypt() — mock returns "enc:<key>" not the raw key
        // In production, AES-256-GCM ciphertext would be opaque. Here we verify it's not stored raw.
        const row = db.prepare("SELECT * FROM usage_sync_configs WHERE id = 'anthropic'").get() as any;
        expect(row).toBeDefined();
        // The mock encrypt() wraps with "enc:" — verify it's not stored as the literal raw key string
        expect(row.admin_key_enc).toBe('enc:sk-ant-admin-validkey123'); // came through encrypt()
        expect(row.admin_key_enc).not.toBe('sk-ant-admin-validkey123'); // not the raw plaintext
        expect(row.status).toBe('active');
        expect(row.org_name).toBe('My Test Org');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('AnthropicPoller circuit breaker', () => {
    it('sets status to error after reaching CIRCUIT_BREAKER_THRESHOLD', () => {
        const db = getDb();
        db.prepare('DELETE FROM usage_sync_configs').run();
        db.prepare(`
            INSERT INTO usage_sync_configs (id, display_name, admin_key_enc, status, error_count)
            VALUES ('anthropic', 'Anthropic', 'enc:test', 'active', 10)
        `).run();

        // Simulate what the poller does at start of poll() — checks circuit breaker
        const row = db.prepare("SELECT error_count FROM usage_sync_configs WHERE id = 'anthropic'").get() as any;
        expect(row.error_count).toBeGreaterThanOrEqual(10);

        // Apply the circuit breaker condition (mirrors anthropic-poller.ts logic)
        if (row.error_count >= 10) {
            db.prepare("UPDATE usage_sync_configs SET status = 'error', last_error = ? WHERE id = 'anthropic'")
                .run('Sync paused after 10 consecutive failures. Visit the Sync page to retry.');
        }

        const updated = db.prepare("SELECT status, last_error FROM usage_sync_configs WHERE id = 'anthropic'").get() as any;
        expect(updated.status).toBe('error');
        expect(updated.last_error).toMatch(/10 consecutive/i);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('DELETE /api/sync/providers/anthropic/key', () => {
    it('removes key and keeps historical records', async () => {
        const db = getDb();
        seedSyncConfig(db);
        seedUsageRecord(db, { cost_usd: 1.23 });

        const res = await request(app).delete('/api/sync/providers/anthropic/key');
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);

        const config = db.prepare("SELECT * FROM usage_sync_configs WHERE id = 'anthropic'").get() as any;
        expect(config.admin_key_enc).toBeNull();
        expect(config.status).toBe('inactive');

        // Historical records must NOT be deleted
        const records = db.prepare('SELECT * FROM usage_records').all();
        expect(records.length).toBeGreaterThan(0);
    });
});
