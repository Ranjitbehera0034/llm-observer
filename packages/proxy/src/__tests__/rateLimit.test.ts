import request from 'supertest';
import express from 'express';

// Mock DB before importing guards
jest.mock('@llm-observer/database', () => {
    const { createTestDb } = require('./helpers/testDb');
    const { database, bulkInsertRequests } = createTestDb();
    return {
        getDb: () => database,
        initDb: () => database,
        bulkInsertRequests,
        validateApiKey: () => ({ project_id: 'default' }),
        getSetting: () => null,
        updateSetting: () => { },
    };
});

import { budgetGuard } from '../budgetGuard';
import { rateLimitGuard } from '../rateLimitGuard';

describe('Proxy Budget & Rate Limiting Guards', () => {
    let app: express.Express;

    beforeEach(() => {
        app = express();

        // Mock proxy handler
        const mockProxy = (req: express.Request, res: express.Response) => {
            res.status(200).json({ success: true });
        };

        app.use(budgetGuard);
        app.use(rateLimitGuard);
        app.post('/v1/chat/completions', (req, res, next) => {
            mockProxy(req, res);
        });
    });

    it('should allow requests when within budget and rate limits', async () => {
        const response = await request(app)
            .post('/v1/chat/completions')
            .set('Authorization', 'Bearer sk-test-key');

        expect(response.status).toBe(200);
    });

    it('should rate limit after burst capacity', async () => {
        let got429 = false;

        // Hammer the endpoint until we get a 429
        for (let i = 0; i < 150; i++) {
            const res = await request(app).post('/v1/chat/completions').set('Authorization', 'Bearer sk-test-key');
            if (res.status === 429) {
                got429 = true;
                expect(res.body.error.type).toBe('rate_limited');
                break;
            }
        }

        expect(got429).toBe(true);
    });
});
