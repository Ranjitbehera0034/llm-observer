import request from 'supertest';
import express from 'express';
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@llm-observer/database', () => ({
    getDb: vi.fn(),
    validateApiKey: vi.fn().mockReturnValue({ project_id: 'proj-123' }),
}));

const { budgetGuard } = await import('../../packages/proxy/src/budgetGuard');
const dbMock = await import('@llm-observer/database');

const app = express();
app.use(express.json());

// Apply global test budget guard
app.use(budgetGuard);

app.post('/test', (req, res) => {
    res.status(200).json({ success: true, message: 'Passed budget guard' });
});

describe('Budget Guard Tests', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('allows request when there is no budget limit', async () => {
        // Return project with no daily_budget
        (dbMock.getDb as any).mockReturnValue({
            prepare: () => ({ get: () => ({ daily_budget: null, alert_threshold: null, kill_switch: 1 }) })
        });

        const res = await request(app)
            .post('/test')
            .set('x-api-key', 'key-1')
            .send({});

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
    });

    it('allows request when budget is 0% consumed', async () => {
        // Budget 5.0, spent 0.0
        (dbMock.getDb as any).mockReturnValue({
            prepare: (q: string) => ({
                get: () => {
                    if (q.includes('projects')) return { id: 'proj-123', daily_budget: 5.0, kill_switch: 1 };
                    if (q.includes('requests')) return { total: 0.0 };
                    return {};
                },
                run: () => ({})
            })
        });

        const res = await request(app).post('/test').set('x-api-key', 'key-2').send({});
        expect(res.status).toBe(200);
    });

    it('blocks request with 429 when budget is exceeded and kill_switch is TRUE', async () => {
        // Budget 5.0, spent 6.0
        (dbMock.getDb as any).mockReturnValue({
            prepare: (q: string) => ({
                get: () => {
                    if (q.includes('projects')) return { id: 'proj-123', daily_budget: 5.0, kill_switch: 1 };
                    if (q.includes('requests')) return { total: 6.0 };
                    return {};
                },
                run: () => ({})
            })
        });

        const res = await request(app).post('/test').set('x-api-key', 'key-3').send({});
        expect(res.status).toBe(429);
        expect(res.body.error.type).toBe('budget_exceeded');
        expect(res.body.error._source).toBeUndefined();
    });

    it('allows request when budget is exceeded but kill_switch is FALSE', async () => {
        // Budget 5.0, spent 6.0, kill_switch 0
        (dbMock.getDb as any).mockReturnValue({
            prepare: (q: string) => ({
                get: () => {
                    if (q.includes('projects')) return { id: 'proj-123', daily_budget: 5.0, kill_switch: 0 };
                    if (q.includes('requests')) return { total: 6.0 };
                    return {};
                },
                run: () => ({})
            })
        });

        const res = await request(app).post('/test').set('x-api-key', 'key-4').send({});
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
    });
});
