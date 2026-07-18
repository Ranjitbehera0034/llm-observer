import request from 'supertest';
import express from 'express';
import { initDb, getDb, bulkInsertRequests } from '@llm-observer/database';
import compareRouter from '../routes/compare.routes';

const app = express();
app.use(express.json());
app.use('/api/compare', compareRouter);

const seedRequests = (model: string, costs: number[], errorCount = 0) => {
    const rows = costs.map((cost_usd, i) => ({
        project_id: 'default',
        provider: 'openai',
        model,
        cost_usd,
        latency_ms: 100 + i,
        total_tokens: 50 + i,
        status: i < errorCount ? 'error' : 'success',
        created_at: new Date().toISOString()
    }));
    bulkInsertRequests(rows as any);
};

describe('GET /api/compare', () => {
    beforeAll(() => {
        initDb(':memory:');
        getDb().prepare('INSERT OR IGNORE INTO projects (id, name, daily_budget) VALUES (?, ?, ?)').run('default', 'Default Project', 100.0);

        // model-a: cheap, few errors. model-b: notably pricier, more errors.
        seedRequests('model-a', Array(40).fill(0.01), 1);
        seedRequests('model-b', Array(40).fill(0.05), 10);
    });

    it('rejects an invalid dimension', async () => {
        const res = await request(app).get('/api/compare?dimension=bogus&a=x&b=y');
        expect(res.status).toBe(400);
        expect(res.body.error).toContain('Invalid dimension');
    });

    it('requires both a and b', async () => {
        const res = await request(app).get('/api/compare?dimension=model&a=model-a');
        expect(res.status).toBe(400);
        expect(res.body.error).toContain('required');
    });

    it('rejects comparing a value against itself', async () => {
        const res = await request(app).get('/api/compare?dimension=model&a=model-a&b=model-a');
        expect(res.status).toBe(400);
        expect(res.body.error).toContain('different values');
    });

    it('404s when one side has no data', async () => {
        const res = await request(app).get('/api/compare?dimension=model&a=model-a&b=nonexistent-model');
        expect(res.status).toBe(404);
    });

    it('returns a full, statistically-grounded comparison for two real models', async () => {
        const res = await request(app).get('/api/compare?dimension=model&a=model-a&b=model-b&days=30');
        expect(res.status).toBe(200);
        expect(res.body.sampleSizes).toEqual({ a: 40, b: 40 });

        // Cost: model-b is 5x model-a's cost, well-sampled — should be significant
        expect(res.body.cost.significant).toBe(true);
        expect(res.body.cost.deltaPct).toBeCloseTo(400, 0); // (0.05-0.01)/0.01 * 100

        // Error rate: model-a 1/40 (~2.5%), model-b 10/40 (25%) — should be significant
        expect(res.body.errorRate.a.rate).toBeCloseTo(0.025, 3);
        expect(res.body.errorRate.b.rate).toBeCloseTo(0.25, 3);
        expect(res.body.errorRate.significant).toBe(true);
    });

    it('lists available comparison values via /options', async () => {
        const res = await request(app).get('/api/compare/options?dimension=model');
        expect(res.status).toBe(200);
        expect(res.body.values).toEqual(expect.arrayContaining(['model-a', 'model-b']));
    });
});
