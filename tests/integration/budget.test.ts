import request from 'supertest';
import express from 'express';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { initDb, getDb } from '@llm-observer/database';
import { budgetGuard, _getCacheForTest } from '../../packages/proxy/src/budgetGuard';

// Mock validateApiKey to bypass real database check for API keys
vi.mock('@llm-observer/database', async (importOriginal) => {
    const actual = await importOriginal() as any;
    return {
        ...actual,
        validateApiKey: vi.fn().mockReturnValue({ project_id: 'proj-123' }),
    };
});

const app = express();
app.use(express.json());
app.use(budgetGuard);

app.post('/test', (req, res) => {
    res.status(200).json({ success: true, message: 'Passed budget guard' });
});

describe('Budget Guard Tests (v1.7.0)', () => {
    beforeEach(async () => {
        await initDb(':memory:');
        const db = getDb();
        
        // Clear internal cache in budgetGuard to ensure testing against fresh DB settings
        if (_getCacheForTest) _getCacheForTest().clear();

        // Clear tables in correct order (child then parent) to avoid FK errors
        db.prepare('DELETE FROM requests').run();
        db.prepare('DELETE FROM budgets').run();
        db.prepare('DELETE FROM projects').run();
        
        // Seed default project
        db.prepare(`
            INSERT INTO projects (id, name, daily_budget, kill_switch, safety_buffer, estimate_multiplier)
            VALUES (?, ?, ?, ?, ?, ?)
        `).run('proj-123', 'Test Project', 10.0, 1, 0.05, 3.0);

        vi.clearAllMocks();
    });

    it('allows request when there is no budget limit', async () => {
        const db = getDb();
        db.prepare('UPDATE projects SET daily_budget = NULL WHERE id = ?').run('proj-123');

        const res = await request(app)
            .post('/test')
            .set('x-api-key', 'valid-key')
            .send({ provider: 'openai', model: 'gpt-4o' });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
    });

    it('blocks request with 429 when project budget is exceeded (Layer 1)', async () => {
        const db = getDb();
        db.prepare('UPDATE projects SET daily_budget = 5.0, kill_switch = 1 WHERE id = ?').run('proj-123');
        
        // Simulate spend
        db.prepare(`
            INSERT INTO requests (id, project_id, provider, model, endpoint, cost_usd, status, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        `).run('req-1', 'proj-123', 'openai', 'gpt-4o', '/test', 6.0, 'success');

        const res = await request(app)
            .post('/test')
            .set('x-api-key', 'valid-key')
            .send({ provider: 'openai', model: 'gpt-4o' });

        expect(res.status).toBe(429);
        expect(res.body.error.type).toBe('budget_exceeded');
        expect(res.body.error.scope).toBe('project');
    });

    it('blocks request in safety buffer (Layer 2)', async () => {
        const db = getDb();
        db.prepare('UPDATE projects SET daily_budget = 5.0, safety_buffer = 0.5, kill_switch = 1 WHERE id = ?').run('proj-123');
        
        // Spend $4.60 (remaining $0.40 is less than buffer $0.50)
        db.prepare(`
            INSERT INTO requests (id, project_id, provider, model, endpoint, cost_usd, status, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        `).run('req-1', 'proj-123', 'openai', 'gpt-4o', '/test', 4.60, 'success');

        const res = await request(app)
            .post('/test')
            .set('x-api-key', 'valid-key')
            .send({ provider: 'openai', model: 'gpt-4o' });

        expect(res.status).toBe(429);
        expect(res.body.error.type).toBe('budget_buffer');
    });

    it('blocks request by provider budget (V2 Logic)', async () => {
        const db = getDb();
        // Global project is fine ($100 limit)
        db.prepare('UPDATE projects SET daily_budget = 100.0 WHERE id = ?').run('proj-123');
        
        // But OpenAI has a specific $1.00 budget
        db.prepare(`
            INSERT INTO budgets (name, scope, scope_value, period, limit_usd, kill_switch, safety_buffer_usd, is_active)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run('OpenAI Limit', 'provider', 'openai', 'daily', 1.0, 1, 0.01, 1);

        // Spend $1.50 on OpenAI
        db.prepare(`
            INSERT INTO requests (id, project_id, provider, model, endpoint, cost_usd, status, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        `).run('req-1', 'proj-123', 'openai', 'gpt-4o', '/test', 1.50, 'success');

        const res = await request(app)
            .post('/test')
            .set('x-api-key', 'valid-key')
            .send({ provider: 'openai', model: 'gpt-4o' });

        expect(res.status).toBe(429);
        expect(res.body.error.scope).toBe('provider');
        expect(res.body.error.scope_value).toBe('openai');
    });
});
