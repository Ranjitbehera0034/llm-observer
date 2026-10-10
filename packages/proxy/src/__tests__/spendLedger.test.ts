/**
 * K1: the spend ledger and BudgetService's use of it, below the HTTP layer.
 * Covers matching by scope, the period filter on queued rows (rollover), the sync-provider
 * exclusion that mirrors calculateCurrentSpend, and "queued row flushes between two reads is
 * counted once".
 */
import { initDb, getDb, createBudgetLimit } from '@llm-observer/database';
import { internalLogger } from '../internalLogger';
import { BudgetService } from '../services/budget.service';
import { spendLedger } from '../services/spendLedger';

const row = (over: Record<string, any> = {}) => ({
    id: `q-${Math.random().toString(36).slice(2)}`, project_id: 'default', provider: 'openai', model: 'gpt-4o-mini',
    endpoint: '/v1/chat/completions', cost_usd: 0.1, status_code: 200, status: 'success',
    created_at: new Date().toISOString(), ...over,
} as any);

const addBudget = (over: Record<string, any>) => createBudgetLimit({
    name: 'test', scope: 'global', scope_value: null, period: 'daily', limit_usd: 1,
    warning_pct_1: 0.8, warning_pct_2: 0.9, kill_switch: true, safety_buffer_usd: 0.01,
    estimate_multiplier: 3, is_active: true, ...over,
} as any);

const reserve = (amount: number, over: Record<string, any> = {}) =>
    spendLedger.reserve({ provider: 'openai', model: 'gpt-4o-mini', projectId: 'default', amountUsd: amount, ...over });

describe('spendLedger', () => {
    beforeAll(() => {
        initDb(':memory:');
        getDb().prepare("INSERT OR IGNORE INTO projects (id, name) VALUES ('default', 'Default Project')").run();
    });

    beforeEach(async () => {
        await internalLogger.flush();
        const db = getDb();
        db.prepare('DELETE FROM requests').run();
        db.prepare('DELETE FROM budgets').run();
        db.prepare('DELETE FROM usage_records').run();
        db.prepare('DELETE FROM usage_sync_configs').run();
        spendLedger._resetForTests();
    });

    afterAll(async () => { await internalLogger.flush(); jest.useRealTimers(); });

    describe('reservations', () => {
        it('release is idempotent and never goes negative', () => {
            const r = reserve(0.5);
            expect(spendLedger.inFlight()).toBe(1);
            expect(spendLedger.totalReservedUsd()).toBeCloseTo(0.5, 12);
            spendLedger.release(r);
            spendLedger.release(r);
            expect(spendLedger.inFlight()).toBe(0);
            expect(spendLedger.totalReservedUsd()).toBe(0);
        });

        it('a reservation handle carries its own idempotent release()', () => {
            const r = reserve(0.5);
            r.release();
            r.release();
            expect(spendLedger.inFlight()).toBe(0);
        });

        it('ignores non-finite and negative amounts (reserves 0)', () => {
            reserve(NaN); reserve(-3); reserve(Infinity);
            expect(spendLedger.totalReservedUsd()).toBe(0);
        });

        it('matches by scope: global sees all, provider/model/project only their own', () => {
            reserve(1, { provider: 'openai', model: 'gpt-4o', projectId: 'p1' });
            reserve(2, { provider: 'anthropic', model: 'claude-x', projectId: 'p2' });
            expect(spendLedger.reservedUsd({ scope: 'global' })).toBeCloseTo(3, 12);
            expect(spendLedger.reservedUsd({ scope: 'provider', value: 'openai' })).toBeCloseTo(1, 12);
            expect(spendLedger.reservedUsd({ scope: 'provider', value: 'anthropic' })).toBeCloseTo(2, 12);
            expect(spendLedger.reservedUsd({ scope: 'model', value: 'claude-x' })).toBeCloseTo(2, 12);
            expect(spendLedger.reservedUsd({ scope: 'project', value: 'p1' })).toBeCloseTo(1, 12);
            expect(spendLedger.reservedUsd({ scope: 'provider', value: 'groq' })).toBe(0);
        });
    });

    describe('queued rows (completed, waiting in the internalLogger batch)', () => {
        it('counts a queued row once, and still once after it flushes into SQLite', async () => {
            addBudget({});
            await internalLogger.add(row({ cost_usd: 0.3 }));
            expect(BudgetService.committedSpend('global', undefined, 'daily')).toBeCloseTo(0.3, 12);
            expect((getDb().prepare('SELECT COUNT(*) n FROM requests').get() as any).n).toBe(0);

            await internalLogger.flush();
            expect((getDb().prepare('SELECT COUNT(*) n FROM requests').get() as any).n).toBe(1);
            expect(BudgetService.committedSpend('global', undefined, 'daily')).toBeCloseTo(0.3, 12);
        });

        it('a size-triggered flush (10 rows) moves rows between the two sources without a gap or overlap', async () => {
            for (let i = 0; i < 9; i++) await internalLogger.add(row({ cost_usd: 0.1 }));
            expect(BudgetService.committedSpend('global', undefined, 'daily')).toBeCloseTo(0.9, 12);
            await internalLogger.add(row({ cost_usd: 0.1 })); // 10th row triggers the flush inside add()
            expect((getDb().prepare('SELECT COUNT(*) n FROM requests').get() as any).n).toBe(10);
            expect(BudgetService.committedSpend('global', undefined, 'daily')).toBeCloseTo(1.0, 12);
        });

        it('matches provider / model / project scope like the SQL does', async () => {
            await internalLogger.add(row({ provider: 'openai', model: 'a', project_id: 'p1', cost_usd: 1 }));
            await internalLogger.add(row({ provider: 'anthropic', model: 'b', project_id: 'p2', cost_usd: 2 }));
            expect(BudgetService.committedSpend('provider', 'openai', 'daily')).toBeCloseTo(1, 12);
            expect(BudgetService.committedSpend('model', 'b', 'daily')).toBeCloseTo(2, 12);
            expect(BudgetService.committedSpend('global', undefined, 'daily')).toBeCloseTo(3, 12);
            expect(spendLedger.queuedUsd({ scope: 'project', value: 'p2' }, 0)).toBeCloseTo(2, 12);
        });

        it('does not count queued rows of a provider whose spend comes from the admin-API sync (the SQL does not either)', async () => {
            getDb().prepare("INSERT INTO usage_sync_configs (id, display_name, status) VALUES ('openai', 'OpenAI', 'active')").run();
            await internalLogger.add(row({ provider: 'openai', cost_usd: 5 }));
            await internalLogger.add(row({ provider: 'anthropic', cost_usd: 1 }));
            expect(BudgetService.committedSpend('global', undefined, 'daily')).toBeCloseTo(1, 12);
            await internalLogger.flush();
            expect(BudgetService.committedSpend('global', undefined, 'daily')).toBeCloseTo(1, 12); // unchanged by the flush
        });

        it('tolerates SQLite-style and missing created_at values', async () => {
            const sqlish = new Date().toISOString().replace('T', ' ').slice(0, 19); // UTC, no zone marker
            await internalLogger.add(row({ cost_usd: 1, created_at: sqlish }));
            await internalLogger.add(row({ cost_usd: 2, created_at: undefined }));
            expect(BudgetService.committedSpend('global', undefined, 'daily')).toBeCloseTo(3, 12);
        });
    });

    describe('(4) period rollover', () => {
        // Only Date is faked: timers, sockets and SQLite keep running normally.
        const freezeAt = (d: Date) => jest.useFakeTimers({
            now: d,
            doNotFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'setImmediate', 'clearImmediate', 'nextTick', 'queueMicrotask', 'hrtime', 'performance'],
        });
        const setNow = (d: Date) => jest.setSystemTime(d);
        afterEach(() => jest.useRealTimers());

        const spent = (period: string) => BudgetService.committedSpend('global', undefined, period);

        it('daily: yesterday\'s queued row stops counting at local midnight; the in-flight reservation carries over', async () => {
            // Wednesday 18 March 2026, 23:59:30 local; Thursday 19th 00:00:30
            const beforeMidnight = new Date(2026, 2, 18, 23, 59, 30);
            const afterMidnight = new Date(2026, 2, 19, 0, 0, 30);
            freezeAt(beforeMidnight);
            await internalLogger.add(row({ cost_usd: 0.9, created_at: beforeMidnight.toISOString() }));
            const r = reserve(0.05);
            expect(spent('daily')).toBeCloseTo(0.95, 12);

            setNow(afterMidnight);
            // the queued row belongs to yesterday; the request is still running and will be recorded today
            expect(spent('daily')).toBeCloseTo(0.05, 12);
            // same week and month: both still count
            expect(spent('weekly')).toBeCloseTo(0.95, 12);
            expect(spent('monthly')).toBeCloseTo(0.95, 12);

            r.release();
            expect(spent('daily')).toBe(0);

            // flushing after the boundary does not move yesterday's row into today
            await internalLogger.flush();
            expect(spent('daily')).toBe(0);
            expect(spent('weekly')).toBeCloseTo(0.9, 12);
        });

        it('weekly: Sunday night to Monday', async () => {
            const sunday = new Date(2026, 2, 22, 23, 59, 30); // Sunday 22 March 2026
            const monday = new Date(2026, 2, 23, 0, 0, 30);
            freezeAt(sunday);
            await internalLogger.add(row({ cost_usd: 2, created_at: sunday.toISOString() }));
            expect(spent('weekly')).toBeCloseTo(2, 12);
            setNow(monday);
            expect(spent('weekly')).toBe(0);
            expect(spent('monthly')).toBeCloseTo(2, 12);
        });

        it('monthly: last night of the month to the 1st', async () => {
            const lastNight = new Date(2026, 2, 31, 23, 59, 30);
            const firstMorning = new Date(2026, 3, 1, 0, 0, 30);
            freezeAt(lastNight);
            await internalLogger.add(row({ cost_usd: 3, created_at: lastNight.toISOString() }));
            expect(spent('monthly')).toBeCloseTo(3, 12);
            setNow(firstMorning);
            expect(spent('monthly')).toBe(0);
        });

        it('the guard decision follows: blocked before midnight, admitted after', async () => {
            const beforeMidnight = new Date(2026, 2, 18, 23, 59, 30);
            freezeAt(beforeMidnight);
            addBudget({ limit_usd: 1, safety_buffer_usd: 0.01, period: 'daily' });
            await internalLogger.add(row({ cost_usd: 0.995, created_at: beforeMidnight.toISOString() }));
            const blocked = BudgetService.admit('openai', 'gpt-4o-mini', 'default', 10, 0.001, undefined);
            expect(blocked.blocked).toBe(true);
            setNow(new Date(2026, 2, 19, 0, 0, 30));
            const admitted = BudgetService.admit('openai', 'gpt-4o-mini', 'default', 10, 0.001, undefined);
            expect(admitted.blocked).toBe(false);
            admitted.reservation?.release();
        });
    });

    describe('BudgetService.admit(): check and reserve are one synchronous step', () => {
        it('reserves on admit, so the very next synchronous call sees it', () => {
            addBudget({ limit_usd: 1, safety_buffer_usd: 0.001 });
            const a = BudgetService.admit('openai', 'm', 'default', 10, 0.4, undefined);
            const b = BudgetService.admit('openai', 'm', 'default', 10, 0.4, undefined);
            const c = BudgetService.admit('openai', 'm', 'default', 10, 0.4, undefined);
            expect([a.blocked, b.blocked, c.blocked]).toEqual([false, false, true]);
            expect(spendLedger.inFlight()).toBe(2);
            a.reservation?.release();
            const d = BudgetService.admit('openai', 'm', 'default', 10, 0.4, undefined);
            expect(d.blocked).toBe(false);
            b.reservation?.release(); d.reservation?.release();
            expect(spendLedger.inFlight()).toBe(0);
        });

        it('a refused request reserves nothing', () => {
            addBudget({ limit_usd: 1, safety_buffer_usd: 0.001 });
            const a = BudgetService.admit('openai', 'm', 'default', 10, 5, undefined);
            // first request is admitted (estimate check only starts at 60% utilisation)...
            expect(a.blocked).toBe(false);
            const b = BudgetService.admit('openai', 'm', 'default', 10, 5, undefined);
            expect(b.blocked).toBe(true);
            expect(spendLedger.inFlight()).toBe(1);
        });

        // The estimate check (Layer 3) only runs once committed spend (recorded + queued + in-flight)
        // reaches 60% of the limit. These tests pin that documented behaviour so the wording in the
        // README / BudgetsTab ("starts once spend reaches 60% of the limit") cannot drift from the code.
        describe('estimate check starts at 60% of the limit', () => {
            it('at 0% a request whose estimate alone exceeds the whole limit is admitted', () => {
                addBudget({ limit_usd: 1, safety_buffer_usd: 0.001 });
                const r = BudgetService.admit('openai', 'm', 'default', 10, 50, undefined);
                expect(r.blocked).toBe(false);
                r.reservation?.release();
            });

            it('at 55% a request that takes the total past the limit is admitted', async () => {
                addBudget({ limit_usd: 1, safety_buffer_usd: 0.001 });
                await internalLogger.add(row({ cost_usd: 0.55 }));
                const r = BudgetService.admit('openai', 'gpt-4o-mini', 'default', 10, 0.5, undefined);
                expect(r.blocked).toBe(false);
                r.reservation?.release();
            });

            it('at exactly 60% the same request is refused as budget_insufficient', async () => {
                addBudget({ limit_usd: 1, safety_buffer_usd: 0.001 });
                await internalLogger.add(row({ cost_usd: 0.6 }));
                const r = BudgetService.admit('openai', 'gpt-4o-mini', 'default', 10, 0.5, undefined);
                expect(r.blocked).toBe(true);
                expect(r.type).toBe('budget_insufficient');
            });

            it('in-flight estimates count towards the 60%, so a burst crosses the gate and is then refused', () => {
                addBudget({ limit_usd: 1, safety_buffer_usd: 0.001 });
                const a = BudgetService.admit('openai', 'm', 'default', 10, 0.3, undefined);
                const b = BudgetService.admit('openai', 'm', 'default', 10, 0.3, undefined); // 0.3 in flight, 0.6 after
                const c = BudgetService.admit('openai', 'm', 'default', 10, 0.5, undefined); // 0.6 committed + 0.5 > 1
                expect([a.blocked, b.blocked, c.blocked]).toEqual([false, false, true]);
                a.reservation?.release(); b.reservation?.release();
            });
        });

        it('budgets without the kill switch never block or reserve against themselves', () => {
            addBudget({ limit_usd: 1, kill_switch: false });
            const a = BudgetService.admit('openai', 'm', 'default', 10, 50, undefined);
            expect(a.blocked).toBe(false);
        });
    });
});
