/**
 * Integration Tests: Dashboard API (License, Settings, Stats)
 *
 * Uses Supertest to hit Express routes in-memory (no real server needed).
 *
 * Run: npx vitest run tests/integration
 */

import request from 'supertest';
import express from 'express';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

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
const { dashboardApi } = await import('../../packages/proxy/src/dashboardApi');

// ─── Build the test Express app ───────────────────────────────────────────────
const app = express();
app.use(express.json());
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

    it('activates a PRO_ local key', async () => {
        const res = await request(app)
            .post('/api/license/activate')
            .send({ key: 'PRO_TEST_KEY_123' });
        expect(res.status).toBe(200);
        expect(res.body).toHaveProperty('success', true);
    });
});

describe('GET /api/settings', () => {
    it('returns 200 with settings map', async () => {
        const res = await request(app).get('/api/settings');
        expect(res.status).toBe(200);
        expect(res.body).toHaveProperty('data');
        expect(typeof res.body.data).toBe('object');
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

describe('POST /api/webhooks/razorpay', () => {
    it('returns 200 for valid subscription.activated event (no secret in dev mode)', async () => {
        const payload = {
            event: 'subscription.activated',
            payload: {
                subscription: {
                    entity: {
                        id: 'sub_test123',
                        customer_id: 'cust_test456',
                        amount: 29900,
                        currency: 'INR',
                    }
                }
            }
        };

        const res = await request(app)
            .post('/api/webhooks/razorpay')
            .send(payload);

        // Without the RAZORPAY_WEBHOOK_SECRET env var, signature check is skipped (dev mode)
        expect(res.status).toBe(200);
        expect(res.body).toHaveProperty('received', true);
        expect(res.body).toHaveProperty('activated', true);
    });

    it('ignores non-activatable events', async () => {
        const payload = { event: 'refund.created', payload: {} };
        const res = await request(app).post('/api/webhooks/razorpay').send(payload);
        expect(res.status).toBe(200);
        expect(res.body.action).toBe('ignored');
    });
});

describe('POST /api/webhooks/lemonsqueezy', () => {
    it('activates license on subscription_created (dev mode, no secret)', async () => {
        const payload = {
            data: {
                id: '9999',
                attributes: {
                    customer_id: 77,
                    user_email: 'test@example.com',
                    total: 900,
                    currency: 'USD',
                }
            }
        };

        const res = await request(app)
            .post('/api/webhooks/lemonsqueezy')
            .set('x-event-name', 'subscription_created')
            .send(payload);

        expect(res.status).toBe(200);
        expect(res.body.received).toBe(true);
        expect(res.body.activated).toBe(true);
    });

    it('ignores unknown events', async () => {
        const res = await request(app)
            .post('/api/webhooks/lemonsqueezy')
            .set('x-event-name', 'review.created')
            .send({ data: {} });
        expect(res.status).toBe(200);
        expect(res.body.action).toBe('ignored');
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
