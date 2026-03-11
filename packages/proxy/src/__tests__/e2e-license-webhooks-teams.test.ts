// =====================================================================================
// Suite H: License API — GET /api/license/status, POST /api/license/activate
// Suite J: Webhooks — POST /api/webhooks/lemonsqueezy, /razorpay
// Suite L: Team Sync — POST /api/teams/:id/sync
// =====================================================================================

import crypto from 'crypto';

const LEMON_SECRET = 'test-lemon-secret-key-12345';
const RAZORPAY_SECRET = 'test-razorpay-secret-key-12345';

jest.mock('@llm-observer/database', () => {
    const { createTestDb } = require('./helpers/testDb');
    const { database, bulkInsertRequests } = createTestDb();

    let settings: Record<string, string> = {};
    return {
        getDb: () => database,
        initDb: () => database,
        bulkInsertRequests,
        validateApiKey: () => ({ project_id: 'default' }),
        getSetting: (key: string) => settings[key] || null,
        updateSetting: (key: string, val: string) => { settings[key] = val; },
        getAllSettings: () => settings,
        updateSettings: (data: any) => { Object.assign(settings, data); },
        getAlertRules: () => [],
        createAlert: jest.fn(),
        seedPricing: jest.fn(),
        seedDefaultApiKey: jest.fn(),
        initPricingCache: jest.fn(),
    };
});
jest.mock('../anomalyDetector', () => ({ startAnomalyDetection: jest.fn() }));
jest.mock('../internalLogger', () => ({ internalLogger: { add: jest.fn(), flush: jest.fn() } }));
jest.mock('../budgetGuard', () => ({ budgetGuard: (_: any, __: any, next: any) => next(), incrementSpendCache: jest.fn() }));
jest.mock('../rateLimitGuard', () => ({ rateLimitGuard: (_: any, __: any, next: any) => next() }));
jest.mock('../licenseManager', () => {
    let isPro = false;
    return {
        getLicenseInfo: async () => ({ isPro, limits: { maxProjects: isPro ? 999 : 1 } }),
        activateLicense: async (key: string) => {
            if (key && key.startsWith('PRO_')) {
                isPro = true;
                return { success: true, message: 'License activated' };
            }
            return { success: false, message: 'Invalid license key' };
        },
        activateLicenseFromPayment: (data: any) => {
            isPro = true;
            return { success: true };
        },
        checkProjectLimit: async () => !isPro,
    };
});

import supertest from 'supertest';
import express from 'express';
import { licenseRouter } from '../routes/license.routes';
import { webhooksRouter } from '../routes/webhooks.routes';
import { requestsRouter } from '../routes/requests.routes';
import { getDb } from '@llm-observer/database';

const app = express();
// Webhooks need raw body for HMAC
app.use('/api/license', licenseRouter);
app.use('/api/webhooks', webhooksRouter);
app.use('/api/teams', requestsRouter);

// =================== SUITE H: LICENSE ===================

describe('H — License API', () => {

    it('H1 — Positive: GET /api/license/status returns isPro=false on fresh install', async () => {
        const res = await supertest(app).get('/api/license/status');
        expect(res.status).toBe(200);
        expect(res.body.data.isPro).toBe(false);
    });

    it('H3 — Negative: POST /api/license/activate without key returns 400', async () => {
        const res = await supertest(app).post('/api/license/activate').send({});
        expect(res.status).toBe(400);
        expect(res.body.error).toBeDefined();
    });

    it('H4 — Negative: Tampered key is rejected', async () => {
        const res = await supertest(app).post('/api/license/activate').send({ key: 'FAKE_XYZ_NOTAPROKEY' });
        expect(res.status).toBe(400);
        expect(res.body.error).toBeDefined();
    });

    it('H2 + H5 — Positive: Valid PRO key activates and status reflects isPro=true', async () => {
        const activateRes = await supertest(app).post('/api/license/activate').send({ key: 'PRO_LS_TESTKEY123' });
        expect(activateRes.status).toBe(200);
        expect(activateRes.body.success).toBe(true);

        const statusRes = await supertest(app).get('/api/license/status');
        expect(statusRes.body.data.isPro).toBe(true);
    });
});

// =================== SUITE J: WEBHOOKS ===================

function signBody(body: string, secret: string) {
    return crypto.createHmac('sha256', secret).update(Buffer.from(body)).digest('hex');
}

describe('J — Webhooks API', () => {

    beforeAll(() => {
        process.env.LEMONSQUEEZY_WEBHOOK_SECRET = LEMON_SECRET;
        process.env.RAZORPAY_WEBHOOK_SECRET = RAZORPAY_SECRET;
    });
    afterAll(() => {
        delete process.env.LEMONSQUEEZY_WEBHOOK_SECRET;
        delete process.env.RAZORPAY_WEBHOOK_SECRET;
    });

    it('J2 — Negative: LemonSqueezy with invalid HMAC returns 401', async () => {
        const res = await supertest(app)
            .post('/api/webhooks/lemonsqueezy')
            .set('x-signature', 'deadbeefdeadbeef')
            .set('x-event-name', 'subscription_created')
            .send({ data: { attributes: {}, id: '1' } });
        expect(res.status).toBe(401);
    });

    it('J3 — Negative: LemonSqueezy with missing signature header returns 401', async () => {
        const res = await supertest(app)
            .post('/api/webhooks/lemonsqueezy')
            .set('x-event-name', 'subscription_created')
            .send({});
        expect(res.status).toBe(401);
        expect(res.body.error).toContain('Missing');
    });

    it('J5 — Corner: LemonSqueezy unknown event type returns 200 with action=ignored', async () => {
        const body = JSON.stringify({ data: { id: 'sub_1', attributes: { customer_id: 'c1' } } });
        const sig = signBody(body, LEMON_SECRET);
        const res = await supertest(app)
            .post('/api/webhooks/lemonsqueezy')
            .set('Content-Type', 'application/json')
            .set('x-signature', sig)
            .set('x-event-name', 'some_unknown_event')
            .send(body);
        expect(res.status).toBe(200);
        expect(res.body.action).toBe('ignored');
    });

    it('J4 — Positive: LemonSqueezy subscription_cancelled deactivates license', async () => {
        const body = JSON.stringify({ data: { id: 'sub_1', attributes: { customer_id: 'c1' } } });
        const sig = signBody(body, LEMON_SECRET);
        const res = await supertest(app)
            .post('/api/webhooks/lemonsqueezy')
            .set('Content-Type', 'application/json')
            .set('x-signature', sig)
            .set('x-event-name', 'subscription_cancelled')
            .send(body);
        expect(res.status).toBe(200);
        expect(res.body.action).toBe('deactivated');
    });

    it('J8 — Corner: Razorpay with mismatched signature length returns 401', async () => {
        const res = await supertest(app)
            .post('/api/webhooks/razorpay')
            .set('x-razorpay-signature', 'short')
            .send({ event: 'payment.captured' });
        expect(res.status).toBe(401);
    });
});

// =================== SUITE L: TEAM SYNC ===================

describe('L — Team Sync API', () => {
    let db: ReturnType<typeof getDb>;
    beforeAll(() => { db = getDb(); });
    beforeEach(() => { 
        db.prepare('DELETE FROM requests').run(); 
        db.prepare('INSERT OR IGNORE INTO projects (id, name, daily_budget) VALUES (?, ?, ?)').run('team-123', 'Team 123', 100);
    });

    it('L1 — Positive: Valid sync inserts requests and returns count', async () => {
        const res = await supertest(app)
            .post('/api/teams/team-123/sync')
            .send({ requests: [{ provider: 'openai', model: 'gpt-4', cost_usd: 0.01, status: 'success' }] });
        expect(res.status).toBe(200);
        expect(res.body.count).toBe(1);
    });

    it('L2 — Negative: Non-array requests field returns 400', async () => {
        const res = await supertest(app)
            .post('/api/teams/team-123/sync')
            .send({ requests: 'not-an-array' });
        expect(res.status).toBe(400);
        expect(res.body.error).toContain('"requests" array');
    });

    it('L3 — Corner: Empty array returns 200 with count 0', async () => {
        const res = await supertest(app)
            .post('/api/teams/team-123/sync')
            .send({ requests: [] });
        expect(res.status).toBe(200);
        expect(res.body.count).toBe(0);
    });

    it('L4 — Corner: 100 requests in one sync all inserted in transaction', async () => {
        const requests = Array.from({ length: 100 }, (_, i) => ({
            provider: 'openai', model: 'gpt-4', cost_usd: 0.001, status: 'success', total_tokens: i
        }));
        const res = await supertest(app)
            .post('/api/teams/team-123/sync')
            .send({ requests });
        expect(res.status).toBe(200);
        expect(res.body.count).toBe(100);
    });
});
