/**
 * RM-7: provider/model-scoped budgets through the REAL guard + route chain
 * (createApp()), with an in-memory database. Only the upstream proxy call is
 * stubbed; guards, context resolution and route dispatch are the production ones.
 */
import request from 'supertest';
import { initDb, getDb, seedPricing, createBudgetLimit } from '@llm-observer/database';

jest.mock('../proxy', () => ({
    ...jest.requireActual('../proxy'),
    handleProxyRequest: (req: any, res: any, provider: string) => {
        res.status(200).json({ ok: true, provider, ctxProvider: req.provider, ctxModel: req.model });
    },
}));

import { createApp } from '../server';
import { refreshPricingCache } from '../utils/pricing';
import { _getCacheForTest } from '../budgetGuard';

const sqlTime = (d: Date) => d.toISOString().replace('T', ' ').slice(0, 19);

const addRequest = (provider: string, model: string, cost: number, createdAt: Date = new Date(), status = 'success') => {
    getDb().prepare(`
        INSERT INTO requests (id, project_id, provider, model, endpoint, cost_usd, status_code, status, created_at)
        VALUES (?, 'default', ?, ?, '/v1/chat/completions', ?, 200, ?, ?)
    `).run(`r-${Math.random().toString(36).slice(2)}`, provider, model, cost, status, sqlTime(createdAt));
};

const addBudget = (over: Record<string, any>) => createBudgetLimit({
    name: 'test', scope: 'provider', scope_value: 'openai', period: 'daily', limit_usd: 3,
    warning_pct_1: 0.8, warning_pct_2: 0.9, kill_switch: true, safety_buffer_usd: 0.05,
    estimate_multiplier: 3, is_active: true, ...over,
} as any);

const chat = (text = 'hi') => ({ model: 'gpt-4o-mini', messages: [{ role: 'user', content: text }] });

describe('RM-7 budgets through createApp()', () => {
    const app = createApp();

    beforeAll(() => {
        initDb(':memory:');
        seedPricing();
        refreshPricingCache();
    });

    beforeEach(() => {
        const db = getDb();
        db.prepare('DELETE FROM requests').run();
        db.prepare('DELETE FROM budgets').run();
        db.prepare("INSERT OR IGNORE INTO projects (id, name) VALUES ('default', 'Default Project')").run();
        db.prepare("UPDATE projects SET daily_budget = NULL, kill_switch = 0 WHERE id = 'default'").run();
        _getCacheForTest().clear();
    });

    describe('provider-scoped matching', () => {
        it('blocks /v1/openai with no x-provider header but not /v1/anthropic', async () => {
            addBudget({ scope: 'provider', scope_value: 'openai', limit_usd: 3 });
            addRequest('openai', 'gpt-4o-mini', 3.5);

            const blocked = await request(app).post('/v1/openai/chat/completions').send(chat());
            expect(blocked.status).toBe(429);
            expect(blocked.body.error).toMatchObject({ type: 'budget_exceeded', scope: 'provider', scope_value: 'openai' });
            expect(blocked.body.error.message).toMatch(/^Daily budget exceeded/);

            const other = await request(app).post('/v1/anthropic/messages').send({ model: 'claude-3-5-sonnet-20241022', messages: [{ role: 'user', content: 'hi' }] });
            expect(other.status).toBe(200);
            expect(other.body).toMatchObject({ ctxProvider: 'anthropic' });
        });

        it('cannot be dodged by a spoofed x-provider header', async () => {
            addBudget({ scope: 'provider', scope_value: 'openai', limit_usd: 3 });
            addRequest('openai', 'gpt-4o-mini', 3.5);

            const res = await request(app).post('/v1/openai/chat/completions').set('x-provider', 'anthropic').send(chat());
            expect(res.status).toBe(429);
        });

        it('logs the blocked request under the real provider', async () => {
            addBudget({ scope: 'provider', scope_value: 'openai', limit_usd: 3 });
            addRequest('openai', 'gpt-4o-mini', 3.5);
            await request(app).post('/v1/openai/chat/completions').send(chat());
            const row = getDb().prepare("SELECT provider, model FROM requests WHERE status = 'blocked_budget'").get() as any;
            expect(row).toEqual({ provider: 'openai', model: 'gpt-4o-mini' });
        });

        it('a global budget still blocks every provider', async () => {
            addBudget({ scope: 'global', scope_value: null, limit_usd: 3 });
            addRequest('openai', 'gpt-4o-mini', 3.5);
            const res = await request(app).post('/v1/groq/chat/completions').send({ model: 'llama-3.1-8b-instant', messages: [] });
            expect(res.status).toBe(429);
        });
    });

    describe('pre-flight estimate', () => {
        it('prices gpt-4o-mini with the openai row: no false budget_insufficient at 70% utilisation', async () => {
            addBudget({ scope: 'provider', scope_value: 'openai', limit_usd: 3 });
            addRequest('openai', 'gpt-4o-mini', 2.1); // 70% of $3

            // ~10k tokens in, 3x output => ~$0.02 at gpt-4o-mini prices (was ~$2.40 at the $15/$75 fallback)
            const res = await request(app).post('/v1/openai/chat/completions').send(chat('x'.repeat(40_000)));
            expect(res.status).toBe(200);
        });

        it('still blocks when the openai-priced estimate really does not fit', async () => {
            addBudget({ scope: 'provider', scope_value: 'openai', limit_usd: 3, safety_buffer_usd: 0.001 });
            addRequest('openai', 'gpt-4o-mini', 2.99);
            const res = await request(app).post('/v1/openai/chat/completions').send(chat('x'.repeat(40_000)));
            expect(res.status).toBe(429);
            expect(res.body.error.type).toBe('budget_insufficient');
            expect(res.body.error.estimated_cost_usd).toBeGreaterThan(0.01);
            expect(res.body.error.estimated_cost_usd).toBeLessThan(0.05);
            expect(res.body.error.message).toMatch(/Insufficient daily budget/);
        });

        it('counts an Anthropic system prompt and tools toward the estimate', async () => {
            addBudget({ scope: 'provider', scope_value: 'anthropic', limit_usd: 3, safety_buffer_usd: 0.001 });
            addRequest('anthropic', 'claude-3-5-sonnet-20241022', 2.4); // 80%

            const body = {
                model: 'claude-3-5-sonnet-20241022',
                system: [{ type: 'text', text: 'You are helpful. '.repeat(20_000) }],
                tools: [{ name: 'lookup', description: 'd'.repeat(2000), input_schema: { type: 'object' } }],
                messages: [{ role: 'user', content: 'hi' }],
            };
            const res = await request(app).post('/v1/anthropic/messages').send(body);
            expect(res.status).toBe(429);
            expect(res.body.error.type).toBe('budget_insufficient');
            expect(res.body.error.estimated_input_tokens).toBeGreaterThan(80_000);
        });
    });

    describe('pre-flight estimate honours the declared output cap', () => {
        const bigAnthropic = (extra: Record<string, any>) => ({
            model: 'claude-3-5-sonnet-20241022',
            messages: [{ role: 'user', content: 'x'.repeat(400_000) }], // ~100k input tokens
            ...extra,
        });

        it('does not falsely block a 100k-token request with max_tokens 1000 at 70% utilisation', async () => {
            addBudget({ scope: 'provider', scope_value: 'anthropic', limit_usd: 10, safety_buffer_usd: 0.001 });
            addRequest('anthropic', 'claude-3-5-sonnet-20241022', 7); // 70% of $10, $3 remaining

            // worst case: 100k*$3/M + 1000*$15/M = ~$0.315 (was ~$4.80 with 3x input as output)
            const res = await request(app).post('/v1/anthropic/messages').send(bigAnthropic({ max_tokens: 1000 }));
            expect(res.status).toBe(200);
        });

        it('still blocks when the capped worst case really does not fit', async () => {
            addBudget({ scope: 'provider', scope_value: 'anthropic', limit_usd: 10, safety_buffer_usd: 0.001 });
            addRequest('anthropic', 'claude-3-5-sonnet-20241022', 9.8); // $0.20 remaining < ~$0.315
            const res = await request(app).post('/v1/anthropic/messages').send(bigAnthropic({ max_tokens: 1000 }));
            expect(res.status).toBe(429);
            expect(res.body.error.type).toBe('budget_insufficient');
        });

        it('applies the same cap to the project-level guard', async () => {
            const db = getDb();
            db.prepare("UPDATE projects SET daily_budget = 10, kill_switch = 1 WHERE id = 'default'").run();
            addRequest('anthropic', 'claude-3-5-sonnet-20241022', 7);
            _getCacheForTest().clear();
            const res = await request(app).post('/v1/anthropic/messages').send(bigAnthropic({ max_tokens: 1000 }));
            expect(res.status).toBe(200);
        });
    });

    describe('Gemini', () => {
        it('matches a model budget using the URL model and counts contents', async () => {
            addBudget({ scope: 'model', scope_value: 'gemini-1.5-flash', limit_usd: 1 });
            addRequest('google', 'gemini-1.5-flash', 1.5);

            const body = { contents: [{ role: 'user', parts: [{ text: 'hello there' }] }] };
            const blocked = await request(app).post('/v1/google/models/gemini-1.5-flash:generateContent').send(body);
            expect(blocked.status).toBe(429);
            expect(blocked.body.error).toMatchObject({ scope: 'model', scope_value: 'gemini-1.5-flash' });

            const other = await request(app).post('/v1/google/models/gemini-1.5-pro:generateContent').send(body);
            expect(other.status).toBe(200);
            expect(other.body.ctxModel).toBe('gemini-1.5-pro');
        });
    });

    describe('block messages', () => {
        it('name the budget period', async () => {
            addBudget({ scope: 'global', scope_value: null, period: 'weekly', limit_usd: 3 });
            addRequest('openai', 'gpt-4o-mini', 3.5);
            const res = await request(app).post('/v1/openai/chat/completions').send(chat());
            expect(res.status).toBe(429);
            expect(res.body.error.message).toMatch(/^Weekly budget exceeded/);
        });
    });
});
