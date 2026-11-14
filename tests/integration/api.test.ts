/**
 * Integration Tests: Dashboard API (License, Settings, Stats)
 *
 * Uses Supertest to hit Express routes in-memory (no real server needed).
 *
 * Run: npx vitest run tests/integration
 */

import request from 'supertest';
import express from 'express';
import { describe, it, expect, afterEach, afterAll, vi } from 'vitest';

// ─── Mock @llm-observer/database before any imports ──────────────────────────
vi.mock('@llm-observer/database', () => {
    const settingsStore: Record<string, string> = {
        license_key: '',
    };

    const fakeDb = {
        prepare: (sql: string) => ({
            all: (...args: any[]) => [],
            get: (...args: any[]) => ({ count: 0, total_spend: 0, total_requests: 0 }),
            run: (...args: any[]) => ({ changes: 1 }),
        }),
    };

    return {
        getDb: () => fakeDb,
        getSetting: (key: string) => settingsStore[key] ?? null,
        updateSetting: (key: string, value: string) => { settingsStore[key] = value; },
        getAllSettings: () => ({ ...settingsStore }),
        updateSettings: (updates: Record<string, string>) => Object.assign(settingsStore, updates),
        createApiKey: (name: string, projectId: string) => ({
            id: 'test-key-id',
            name,
            apiKey: `lokp_test_${Date.now()}`,
            key_hint: 'lokp_test_****',
        }),
        createProject: (data: any) => ({ id: 'test-proj', ...data }),
        updateBudget: vi.fn(),
        deleteProject: vi.fn(),
        getAlertRules: () => [],
        createAlertRule: () => 'rule-1',
        deleteAlertRule: vi.fn(),
        getAlerts: () => [],
        acknowledgeAlert: vi.fn(),
        getSavedFilters: () => ({}),
        updateSavedFilters: vi.fn(),
        bulkInsertRequests: vi.fn(),
        getCostOptimizationSuggestions: () => [],
        getPromptCacheSuggestions: () => [],
        getStatsByProvider: () => [],
    };
});

// Now import the router (after mock is set up)
vi.stubEnv('LICENSE_SERVER_URL', 'https://license.test.invalid/license/validate');
const { dashboardApi } = await import('../../packages/proxy/src/dashboardApi');
const { getSetting } = await import('@llm-observer/database');
afterEach(() => { vi.unstubAllGlobals(); });
afterAll(() => { vi.unstubAllEnvs(); });

// ─── Build the test Express app ───────────────────────────────────────────────
const app = express();
app.use('/api', dashboardApi);

// ─── Test Suites ──────────────────────────────────────────────────────────────

describe('GET /api/stats/overview', () => {
    it('returns 200 with required fields', async () => {
        const res = await request(app).get('/api/stats/overview').query({ projectId: 'default' });
        expect(res.status).toBe(200);
        expect(res.body).toHaveProperty('todaySpendUsd');
        expect(res.body).toHaveProperty('totalRequestsToday');
        expect(res.body).toHaveProperty('avgLatencyMs');
        expect(res.body).toHaveProperty('errorRate');
    });
});

describe('GET /api/license/status', () => {
    it('returns license info with isPro and limits', async () => {
        const res = await request(app).get('/api/license/status');
        expect(res.status).toBe(200);
        expect(res.body.data).toHaveProperty('isPro');
        expect(res.body.data).toHaveProperty('limits');
        expect(res.body.data.limits).toHaveProperty('maxProjects');
        expect(res.body.data.limits).toHaveProperty('logRetentionDays');
    });

    it('starts as free tier (isPro: false)', async () => {
        const res = await request(app).get('/api/license/status');
        expect(res.body.data.isPro).toBe(false);
        expect(res.body.data.limits.maxProjects).toBe(1);
        expect(res.body.data.limits.logRetentionDays).toBe(7);
    });
});

describe('POST /api/license/activate', () => {
    it('rejects invalid key format', async () => {
        const res = await request(app)
            .post('/api/license/activate')
            .send({ key: 'invalid-key-format' });
        expect(res.status).toBe(400);
        expect(res.body).toHaveProperty('error');
    });

    it('returns 400 when no key is provided', async () => {
        const res = await request(app).post('/api/license/activate').send({});
        expect(res.status).toBe(400);
    });

    it('rejects a PRO_ prefix unless the license service confirms entitlement', async () => {
        const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ valid: false, error: 'Invalid license' }), { status: 400 }));
        vi.stubGlobal('fetch', fetchMock);
        const res = await request(app)
            .post('/api/license/activate')
            .send({ key: 'PRO_TEST_KEY_123' });
        expect(res.status).toBe(400);
        expect(getSetting('license_key')).toBe('');
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('activates only after the license service returns a valid paid-through date', async () => {
        const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ valid: true, valid_until: new Date(Date.now() + 86400000).toISOString() })));
        vi.stubGlobal('fetch', fetchMock);
        const res = await request(app)
            .post('/api/license/activate')
            .send({ key: 'PRO_TEST_KEY_123' });
        expect(res.status).toBe(200);
        expect(res.body).toHaveProperty('success', true);
        expect(fetchMock.mock.calls[0][0]).toBe('https://license.test.invalid/license/validate');
        expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ license_key: 'PRO_TEST_KEY_123' });
        const status = await request(app).get('/api/license/status');
        expect(status.body.data.isPro).toBe(true);
        expect(status.body.data).not.toHaveProperty('licenseKey');
    });
});

describe('GET /api/settings', () => {
    it('returns 200 with settings map', async () => {
        const res = await request(app).get('/api/settings');
        expect(res.status).toBe(200);
        expect(res.body).toHaveProperty('data');
        expect(typeof res.body.data).toBe('object');
    });

    it('never exposes saved license keys, signatures, or entitlement metadata', async () => {
        const res = await request(app).get('/api/settings');
        expect(Object.keys(res.body.data).some(key => key.startsWith('license_'))).toBe(false);
        expect(JSON.stringify(res.body)).not.toContain('PRO_TEST_KEY_123');
    });
});

describe('PUT /api/settings', () => {
    it('updates settings and returns success', async () => {
        const res = await request(app)
            .put('/api/settings')
            .send({ openai_api_key: 'sk-test-12345', groq_api_key: 'gsk_test' });
        expect(res.status).toBe(200);
        expect(res.body).toHaveProperty('success', true);
    });

    it('rejects attempts to replace billing state through general settings', async () => {
        const originalKey = getSetting('license_key');
        const res = await request(app).put('/api/settings').send({
            license_key: 'PRO_FORGED', license_status: 'active',
            license_valid_until: '2099-01-01', license_verified_at: String(Date.now()),
        });
        expect(res.status).toBe(400);
        expect(getSetting('license_key')).toBe(originalKey);
        expect(getSetting('license_valid_until')).not.toBe('2099-01-01');
    });
});

describe('GET /api/requests', () => {
    it('returns paginated empty results', async () => {
        const res = await request(app).get('/api/requests').query({ projectId: 'default' });
        expect(res.status).toBe(200);
        expect(res.body).toHaveProperty('data');
        expect(res.body).toHaveProperty('meta');
        expect(res.body.meta).toHaveProperty('total');
        expect(res.body.meta).toHaveProperty('page');
        expect(Array.isArray(res.body.data)).toBe(true);
    });
});

describe.each(['razorpay', 'lemonsqueezy'])('retired desktop payment webhook: %s', provider => {
    it('returns 404 without changing the saved entitlement', async () => {
        const originalKey = getSetting('license_key');
        const originalStatus = getSetting('license_status');
        const res = await request(app).post(`/api/webhooks/${provider}`).send({ event: 'subscription.activated', data: { id: 'forged' } });
        expect(res.status).toBe(404);
        expect(getSetting('license_key')).toBe(originalKey);
        expect(getSetting('license_status')).toBe(originalStatus);
    });
});

describe('POST /api/auth/keys', () => {
    it('creates an API key and returns its hint', async () => {
        const res = await request(app)
            .post('/api/auth/keys')
            .send({ name: 'Test App Key' });
        expect(res.status).toBe(200);
        expect(res.body.data).toHaveProperty('apiKey');
        expect(res.body.data).toHaveProperty('key_hint');
    });

    it('returns 400 when name is missing', async () => {
        const res = await request(app).post('/api/auth/keys').send({});
        expect(res.status).toBe(400);
    });
});
