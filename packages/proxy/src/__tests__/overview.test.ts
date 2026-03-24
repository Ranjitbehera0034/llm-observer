
// ── Database mock ────────────────────────────────────────────────────────────
// We must mock the entire module BEFORE importing anything that uses it
const { createTestDb } = require('./helpers/testDb');
const { database } = createTestDb();

jest.mock('@llm-observer/database', () => ({
    getDb: () => database,
    initDb: () => database,
    getSubscriptions: (onlyActive: boolean) => {
        let query = 'SELECT * FROM subscriptions';
        if (onlyActive) query += ' WHERE is_active = 1';
        return database.prepare(query).all();
    }
}));

import express from 'express';
import request from 'supertest';
import { getDb } from '@llm-observer/database';
import overviewRoutes from '../routes/overview.routes';

const app = express();
app.use(express.json());
app.use('/api/overview', overviewRoutes);

describe('Unified Overview API (v1.3.1)', () => {
    let db: any;

    beforeAll(() => {
        db = getDb();
    });

    beforeEach(() => {
        db.prepare('DELETE FROM usage_records').run();
        db.prepare('DELETE FROM requests').run();
        db.prepare('DELETE FROM usage_sync_configs').run();
        db.prepare('DELETE FROM subscriptions').run();
    });

    const seedSyncConfig = (id: string) => {
        db.prepare("INSERT INTO usage_sync_configs (id, status, display_name) VALUES (?, 'active', ?)").run(id, id);
    };

    const seedUsage = (provider: string, cost: number, dateOffset: number = 0) => {
        const d = new Date();
        d.setHours(12, 0, 0, 0); // Mid-day
        d.setDate(d.getDate() - dateOffset);
        db.prepare(`
            INSERT INTO usage_records (provider, model, bucket_start, bucket_width, cost_usd, input_tokens, output_tokens, num_requests)
            VALUES (?, 'model-1', ?, '1h', ?, 100, 100, 1)
        `).run(provider, d.toISOString(), cost);
    };

    const seedProxy = (provider: string, cost: number, dateOffset: number = 0) => {
        const d = new Date();
        d.setHours(12, 0, 0, 0);
        d.setDate(d.getDate() - dateOffset);
        db.prepare(`
            INSERT INTO requests (id, project_id, provider, model, cost_usd, created_at)
            VALUES (?, 'default', ?, 'model-1', ?, ?)
        `).run(Math.random().toString(), provider, cost, d.toISOString());
    };

    const seedSubscription = (name: string, cost: number, startDate: string, active = 1) => {
        db.prepare(`
            INSERT INTO subscriptions (service_name, monthly_cost_usd, billing_cycle, is_active, start_date)
            VALUES (?, ?, 'monthly', ?, ?)
        `).run(name, cost, active, startDate);
    };

    describe('Deduplication Logic (Sync > Proxy)', () => {
        it('uses Sync data and ignores Proxy data for the same provider', async () => {
            seedSyncConfig('anthropic');
            seedUsage('anthropic', 10.0);
            seedProxy('anthropic', 8.0); // Should be ignored

            const res = await request(app).get('/api/overview?period=today');
            expect(res.status).toBe(200);
            expect(res.body.tracked_api.total_usd).toBe(10.0);
            expect(res.body.tracked_api.providers.anthropic.source).toBe('sync');
        });

        it('falls back to Proxy data if no Sync config exists', async () => {
            seedProxy('mistral', 5.0);
            
            const res = await request(app).get('/api/overview?period=today');
            expect(res.body.tracked_api.total_usd).toBe(5.0);
            expect(res.body.tracked_api.providers.mistral.source).toBe('proxy');
        });
    });

    describe('Subscription Proration', () => {
        it('calculates daily burn correctly (today)', async () => {
            // Started 5 days ago
            const startDate = new Date(Date.now() - 1000 * 60 * 60 * 24 * 5).toISOString();
            seedSubscription('Cursor Pro', 30.42, startDate);

            const res = await request(app).get('/api/overview?period=today');
            expect(res.body.subscriptions.period_cost_usd).toBeCloseTo(1.0, 2);
        });

        it('returns 0 for subscriptions starting in the future', async () => {
            const futureDate = new Date(Date.now() + 1000 * 60 * 60 * 24 * 5).toISOString();
            seedSubscription('Future Tool', 30.42, futureDate);

            const res = await request(app).get('/api/overview?period=today');
            expect(res.body.subscriptions.period_cost_usd).toBe(0);
        });
    });

    describe('Multi-Period KPIs', () => {
        it('returns different totals for today vs week', async () => {
            seedUsage('openai', 10.0, 0); // today
            seedUsage('openai', 20.0, 3); // 3 days ago

            const todayRes = await request(app).get('/api/overview?period=today');
            const weekRes = await request(app).get('/api/overview?period=week');

            expect(todayRes.body.tracked_api.total_usd).toBe(10.0);
            expect(weekRes.body.tracked_api.total_usd).toBe(30.0);
        });
    });
});
