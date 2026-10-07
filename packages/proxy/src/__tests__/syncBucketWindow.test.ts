/**
 * Admin-API sync buckets (usage_records.bucket_start) are UTC-day labels, while budget windows
 * start at LOCAL midnight. The sync side must therefore be matched by calendar-date label:
 * "the UTC bucket labelled with today's local date" is today in every time zone.
 *
 * The process TZ is fixed at startup and cannot be changed from inside a Jest sandbox, so each
 * scenario re-runs this file in a child Jest process with TZ set (SYNC_BUCKET_TZ_CHILD).
 */
import { execFileSync } from 'child_process';
import path from 'path';

const CHILD = process.env.SYNC_BUCKET_TZ_CHILD === '1';

// 2026-10-07T16:58Z is Wednesday 7 Oct in UTC, Los Angeles and Kolkata but Thursday 8 Oct in Auckland.
const NOW = '2026-10-07T16:58:00Z';
const CASES = [
    { tz: 'UTC', daily: '2026-10-07', weekly: '2026-10-05', monthly: '2026-10-01' },
    { tz: 'America/Los_Angeles', daily: '2026-10-07', weekly: '2026-10-05', monthly: '2026-10-01' },
    { tz: 'Asia/Kolkata', daily: '2026-10-07', weekly: '2026-10-05', monthly: '2026-10-01' },
    { tz: 'Pacific/Auckland', daily: '2026-10-08', weekly: '2026-10-05', monthly: '2026-10-01' },
];

if (!CHILD) {
    describe('sync bucket window under non-UTC TZs', () => {
        for (const { tz } of CASES) {
            it(`counts the bucket labelled with the local date with TZ=${tz}`, () => {
                execFileSync(process.execPath, [
                    path.join(require.resolve('jest/package.json'), '..', 'bin', 'jest.js'),
                    __filename, '--silent', '--forceExit', '--runInBand',
                ], {
                    cwd: path.join(__dirname, '..', '..'),
                    env: { ...process.env, TZ: tz, SYNC_BUCKET_TZ_CHILD: '1' },
                    stdio: 'pipe',
                });
            }, 60_000);
        }
    });
} else {
    jest.mock('@llm-observer/database', () => {
        const { createTestDb } = require('./helpers/testDb');
        const { database, getBudgetLimits } = createTestDb();
        return { getDb: () => database, initDb: () => database, getBudgetLimits };
    });

    const { getDb } = require('@llm-observer/database');
    const { BudgetService } = require('../services/budget.service');
    const { getPeriodStartLabel } = require('../utils/period');

    describe(`sync bucket window (child, TZ=${process.env.TZ})`, () => {
        const expected = CASES.find(c => c.tz === process.env.TZ)!;
        const addDay = (day: string, cost: number, provider = 'anthropic') => getDb().prepare(`
            INSERT INTO usage_records (provider, model, bucket_start, bucket_width, cost_usd)
            VALUES (?, 'm', ?, '1d', ?)`).run(provider, `${day}T00:00:00Z`, cost);
        const shift = (day: string, n: number) => {
            const d = new Date(`${day}T00:00:00Z`);
            d.setUTCDate(d.getUTCDate() + n);
            return d.toISOString().slice(0, 10);
        };

        beforeAll(() => { jest.useFakeTimers({ now: new Date(NOW) }); });
        afterAll(() => { jest.useRealTimers(); });
        beforeEach(() => { getDb().prepare('DELETE FROM usage_records').run(); });

        it('getPeriodStartLabel is the local calendar date at UTC midnight', () => {
            expect(getPeriodStartLabel('daily')).toBe(`${expected.daily}T00:00:00.000Z`);
            expect(getPeriodStartLabel('weekly')).toBe(`${expected.weekly}T00:00:00.000Z`);
            expect(getPeriodStartLabel('monthly')).toBe(`${expected.monthly}T00:00:00.000Z`);
        });

        it('daily spend counts the bucket labelled with the local date, not the day before or after', async () => {
            addDay(shift(expected.daily, -1), 7);   // yesterday's bucket: excluded
            addDay(expected.daily, 50);             // today's bucket: counted
            expect(await BudgetService.calculateCurrentSpend('global', undefined, 'daily')).toBeCloseTo(50, 9);
            expect(await BudgetService.calculateCurrentSpend('provider', 'anthropic', 'daily')).toBeCloseTo(50, 9);
        });

        it('a $10 kill-switch daily budget blocks on a $50 synced bucket (no fail-open)', async () => {
            const db = getDb();
            db.prepare(`INSERT OR REPLACE INTO usage_sync_configs (id, display_name, admin_key_enc, status, error_count)
                        VALUES ('anthropic', 'anthropic', 'x', 'active', 0)`).run();
            db.prepare(`INSERT INTO budgets (name, scope, scope_value, limit_usd, period, kill_switch, is_active)
                        VALUES ('Anthropic daily', 'provider', 'anthropic', 10, 'daily', 1, 1)`).run();
            try {
                addDay(expected.daily, 50);
                const res = await BudgetService.checkKillSwitch('anthropic', 'm', 10, 0);
                expect(res.blocked).toBe(true);
                expect(res.type).toBe('budget_exceeded');
            } finally {
                db.prepare("DELETE FROM budgets WHERE name = 'Anthropic daily'").run();
                db.prepare("DELETE FROM usage_sync_configs WHERE id = 'anthropic'").run();
            }
        });

        it('weekly spend starts at the local Monday bucket, monthly at the 1st', async () => {
            addDay(shift(expected.weekly, -1), 1000);
            addDay(expected.weekly, 5);
            addDay(expected.daily, 20);
            expect(await BudgetService.calculateCurrentSpend('global', undefined, 'weekly')).toBeCloseTo(25, 9);

            getDb().prepare('DELETE FROM usage_records').run();
            addDay(shift(expected.monthly, -1), 1000);
            addDay(expected.monthly, 3);
            addDay(expected.daily, 4);
            expect(await BudgetService.calculateCurrentSpend('global', undefined, 'monthly')).toBeCloseTo(7, 9);
        });
    });
}
