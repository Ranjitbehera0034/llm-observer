/**
 * RM-7: the project guard and BudgetService must resolve "today" with the same
 * (local-midnight) helper. The process TZ is fixed at startup and cannot be
 * changed from inside a Jest sandbox, so each scenario re-runs this file in a
 * child Jest process with TZ set (RM7_TZ_CHILD); the parent just asserts the
 * child passed.
 */
import { execFileSync } from 'child_process';
import path from 'path';

const CHILD = process.env.RM7_TZ_CHILD === '1';

// Fixed instants and the local-midnight start-of-day they must resolve to.
const CASES = [
    { tz: 'Asia/Kolkata', now: '2026-03-10T20:00:00Z', dailyStart: '2026-03-10T18:30:00.000Z' }, // 01:30 on 11 Mar local
    { tz: 'America/Los_Angeles', now: '2026-03-15T20:00:00Z', dailyStart: '2026-03-15T07:00:00.000Z', weeklyStart: '2026-03-09T07:00:00.000Z', monthlyStart: '2026-03-01T08:00:00.000Z' }, // Sunday 13:00 PDT
    { tz: 'Pacific/Auckland', now: '2026-06-10T10:00:00Z', dailyStart: '2026-06-09T12:00:00.000Z' }, // 22:00 NZST
];

if (!CHILD) {
    describe('day boundary under non-UTC TZs', () => {
        for (const { tz } of CASES) {
            it(`resolves today consistently with TZ=${tz}`, () => {
                execFileSync(process.execPath, [
                    path.join(require.resolve('jest/package.json'), '..', 'bin', 'jest.js'),
                    __filename, '--silent', '--forceExit', '--runInBand',
                ], {
                    cwd: path.join(__dirname, '..', '..'),
                    env: { ...process.env, TZ: tz, RM7_TZ_CHILD: '1' },
                    stdio: 'pipe',
                });
            }, 60_000);
        }
    });
} else {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const request = require('supertest');
    const { initDb, getDb } = require('@llm-observer/database');

    jest.mock('../proxy', () => ({
        ...jest.requireActual('../proxy'),
        handleProxyRequest: (_req: any, res: any) => res.status(200).json({ ok: true }),
    }));

    describe(`day boundary (child, TZ=${process.env.TZ})`, () => {
        const { createApp } = require('../server');
        const { _getCacheForTest } = require('../budgetGuard');
        const { BudgetService } = require('../services/budget.service');
        const { getPeriodStartDate, getNextPeriodStartDate, getSecondsUntilPeriodReset } = require('../utils/period');
        const app = createApp();
        const sqlTime = (d: Date) => d.toISOString().replace('T', ' ').slice(0, 19);
        const addRequest = (cost: number, at: Date) => getDb().prepare(`
            INSERT INTO requests (id, project_id, provider, model, endpoint, cost_usd, status_code, status, created_at)
            VALUES (?, 'default', 'openai', 'gpt-4o-mini', '/v1/chat/completions', ?, 200, 'success', ?)
        `).run(`r-${Math.random().toString(36).slice(2)}`, cost, sqlTime(at));

        beforeAll(() => { initDb(':memory:'); });
        beforeEach(() => {
            const db = getDb();
            db.prepare('DELETE FROM requests').run();
            db.prepare("INSERT OR IGNORE INTO projects (id, name) VALUES ('default', 'Default Project')").run();
            db.prepare("UPDATE projects SET daily_budget = NULL, kill_switch = 0 WHERE id = 'default'").run();
            _getCacheForTest().clear();
        });

        it('period helper starts days (and Monday/1st) at local midnight', () => {
            const c = CASES.find(x => x.tz === process.env.TZ)!;
            const now = new Date(c.now);
            expect(getPeriodStartDate('daily', now).toISOString()).toBe(c.dailyStart);
            if (c.weeklyStart) expect(getPeriodStartDate('weekly', now).toISOString()).toBe(c.weeklyStart);
            if (c.monthlyStart) expect(getPeriodStartDate('monthly', now).toISOString()).toBe(c.monthlyStart);
            // reset boundary is the next local midnight, 1-24h away (never "later today" in UTC terms)
            const secs = getSecondsUntilPeriodReset('daily', now);
            expect(getNextPeriodStartDate('daily', now).getTime() - new Date(c.dailyStart).getTime()).toBe(24 * 3600 * 1000);
            expect(secs).toBeGreaterThan(0);
            expect(secs).toBeLessThanOrEqual(24 * 3600);
        });

        it('project guard and BudgetService both count only requests since local midnight', async () => {
            const startOfDay = getPeriodStartDate('daily');
            addRequest(100, new Date(startOfDay.getTime() - 60 * 60 * 1000)); // an hour before local midnight: yesterday
            expect(await BudgetService.calculateCurrentSpend('global', undefined, 'daily')).toBe(0);

            addRequest(6, new Date(startOfDay.getTime() + 60 * 1000)); // a minute after local midnight: today
            expect(await BudgetService.calculateCurrentSpend('global', undefined, 'daily')).toBe(6);

            getDb().prepare("UPDATE projects SET daily_budget = 5, kill_switch = 1 WHERE id = 'default'").run();
            _getCacheForTest().clear();
            const res = await request(app).post('/v1/openai/chat/completions').send({ model: 'gpt-4o-mini', messages: [] });
            expect(res.status).toBe(429);
            expect(res.body.error).toMatchObject({ type: 'budget_exceeded', scope: 'project', spent_usd: 6 });
            expect(res.body.error.message).toMatch(/^Daily project budget exceeded/);
        });
    });
}
