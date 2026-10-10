/**
 * Team tier part 2: a team policy 'block' budget enforces through the REAL guard + route chain
 * (createApp()), the same path a locally created budget takes. Only the upstream call is stubbed.
 * The policy arrives the production way: SyncManager.sync() pulls it from a fake team server.
 */
import request from 'supertest';
import { initDb, getDb, seedPricing, createBudgetLimit } from '@llm-observer/database';

jest.mock('../proxy', () => ({
    ...jest.requireActual('../proxy'),
    handleProxyRequest: (req: any, res: any, provider: string) => {
        res.status(200).json({ ok: true, provider });
    },
}));

import { createApp } from '../server';
import { refreshPricingCache } from '../utils/pricing';
import { _getCacheForTest } from '../budgetGuard';
import { SyncManager } from '../syncManager';
import { installFakeFetch, setLicence, lapseLicence, joinTeam, teamRows, FakeTeamServer } from './helpers/teamFixture';

const sqlTime = (d: Date) => d.toISOString().replace('T', ' ').slice(0, 19);
const addRequest = (provider: string, model: string, cost: number) => {
    getDb().prepare(`
        INSERT INTO requests (id, project_id, provider, model, endpoint, cost_usd, status_code, status, created_at)
        VALUES (?, 'default', ?, ?, '/v1/chat/completions', ?, 200, 'success', ?)
    `).run(`r-${Math.random().toString(36).slice(2)}`, provider, model, cost, sqlTime(new Date()));
};
const chat = { model: 'gpt-4o-mini', messages: [{ role: 'user', content: 'hi' }] };

describe('team policy enforcement through createApp()', () => {
    const app = createApp();
    let server: FakeTeamServer;
    let silence: jest.SpyInstance[];

    beforeAll(() => {
        initDb(':memory:');
        seedPricing();
        refreshPricingCache();
    });

    beforeEach(async () => {
        silence = [jest.spyOn(console, 'log').mockImplementation(() => {}), jest.spyOn(console, 'warn').mockImplementation(() => {})];
        const db = getDb();
        for (const t of ['requests', 'alerts', 'budgets']) db.prepare(`DELETE FROM ${t}`).run();
        db.prepare("DELETE FROM settings WHERE key LIKE 'team_%'").run();
        db.prepare("INSERT OR IGNORE INTO projects (id, name) VALUES ('default', 'Default Project')").run();
        db.prepare("UPDATE projects SET daily_budget = NULL, kill_switch = 0 WHERE id = 'default'").run();
        _getCacheForTest().clear();
        server = installFakeFetch();
        await setLicence('team');
        joinTeam();
    });
    afterEach(() => silence.forEach(s => s.mockRestore()));

    const sync = () => new SyncManager().sync();

    it("blocks with a 429 once spend passes a team 'block' budget, and says the team set it", async () => {
        server.policy = { version: 1, budgets: [{ scope: 'daily', limitUsd: 3, provider: 'openai', action: 'block' }] };
        await sync();
        expect(teamRows()).toHaveLength(1);

        expect((await request(app).post('/v1/openai/chat/completions').send(chat)).status).toBe(200);

        addRequest('openai', 'gpt-4o-mini', 3.5);
        const blocked = await request(app).post('/v1/openai/chat/completions').send(chat);
        expect(blocked.status).toBe(429);
        expect(blocked.body.error).toMatchObject({ type: 'budget_exceeded', scope: 'provider', scope_value: 'openai' });
        expect(blocked.body.error.message).toMatch(/set by your team/i);

        // Another provider is outside the budget.
        expect((await request(app).post('/v1/anthropic/messages').send({ model: 'claude-3-5-sonnet-20241022', messages: [{ role: 'user', content: 'hi' }] })).status).toBe(200);
    });

    it('a local budget keeps the old message (no team wording)', async () => {
        createBudgetLimit({ name: 'mine', scope: 'provider', scope_value: 'openai', period: 'daily', limit_usd: 3, warning_pct_1: 0.8, warning_pct_2: 0.9, kill_switch: true, safety_buffer_usd: 0.05, estimate_multiplier: 3, is_active: true });
        addRequest('openai', 'gpt-4o-mini', 3.5);
        const res = await request(app).post('/v1/openai/chat/completions').send(chat);
        expect(res.status).toBe(429);
        expect(res.body.error.message).not.toMatch(/team/i);
    });

    it("an 'alert' team budget never blocks", async () => {
        server.policy = { version: 1, budgets: [{ scope: 'daily', limitUsd: 3, provider: 'openai', action: 'alert' }] };
        await sync();
        addRequest('openai', 'gpt-4o-mini', 3.5);
        expect((await request(app).post('/v1/openai/chat/completions').send(chat)).status).toBe(200);
    });

    it('a global team block budget blocks every provider', async () => {
        server.policy = { version: 1, budgets: [{ scope: 'daily', limitUsd: 3, action: 'block' }] };
        await sync();
        addRequest('openai', 'gpt-4o-mini', 3.5);
        expect((await request(app).post('/v1/groq/chat/completions').send({ model: 'llama-3.1-8b-instant', messages: [] })).status).toBe(429);
    });

    it('a policy change takes effect on the next pull: relaxed limit unblocks, removed budget unblocks', async () => {
        server.policy = { version: 1, budgets: [{ scope: 'daily', limitUsd: 3, provider: 'openai', action: 'block' }] };
        await sync();
        addRequest('openai', 'gpt-4o-mini', 3.5);
        expect((await request(app).post('/v1/openai/chat/completions').send(chat)).status).toBe(429);

        server.policy = { version: 2, budgets: [{ scope: 'daily', limitUsd: 50, provider: 'openai', action: 'block' }] };
        await sync();
        expect((await request(app).post('/v1/openai/chat/completions').send(chat)).status).toBe(200);

        server.policy = { version: 3, budgets: [] };
        await sync();
        expect((await request(app).post('/v1/openai/chat/completions').send(chat)).status).toBe(200);
    });

    it('offline keeps enforcing the last policy', async () => {
        server.policy = { version: 1, budgets: [{ scope: 'daily', limitUsd: 3, provider: 'openai', action: 'block' }] };
        await sync();
        addRequest('openai', 'gpt-4o-mini', 3.5);
        server.offline = true;
        await sync();
        expect((await request(app).post('/v1/openai/chat/completions').send(chat)).status).toBe(429);
    });

    it('a lapsed licence stops enforcement: the team budget is gone, the local one still blocks', async () => {
        server.policy = { version: 1, budgets: [{ scope: 'daily', limitUsd: 3, provider: 'openai', action: 'block' }] };
        await sync();
        addRequest('openai', 'gpt-4o-mini', 3.5);
        expect((await request(app).post('/v1/openai/chat/completions').send(chat)).status).toBe(429);

        await lapseLicence();
        await sync();
        expect(teamRows()).toHaveLength(0);
        expect((await request(app).post('/v1/openai/chat/completions').send(chat)).status).toBe(200);

        createBudgetLimit({ name: 'mine', scope: 'global', period: 'daily', limit_usd: 3, warning_pct_1: 0.8, warning_pct_2: 0.9, kill_switch: true, safety_buffer_usd: 0.05, estimate_multiplier: 3, is_active: true });
        expect((await request(app).post('/v1/openai/chat/completions').send(chat)).status).toBe(429);
    });
});
