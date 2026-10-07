// In-memory SQLite tests for the ISO-vs-datetime() comparison fixes in the
// optimizer cache and the rate-limit estimator.
jest.mock('@llm-observer/database', () => {
    const { createTestDb } = require('../helpers/testDb');
    const t = createTestDb();
    return {
        getDb: () => t.database,
        insertRateLimitSnapshot: jest.fn(),
        cleanupOldSnapshots: jest.fn(),
    };
});
jest.mock('../../optimization/context', () => ({
    buildRuleContext: jest.fn().mockResolvedValue({ days: 30, dataDays: 0, anthropicSpendUsd: 0, dailyCosts: [], sessions: [], subagents: [], toolUsage: [], usageRecords: [], roiData: [], budgetAlerts: [], subscriptions: [] }),
}));

import { getDb, insertRateLimitSnapshot } from '@llm-observer/database';
import { runOptimizationEngine } from '../../optimization/engine';
import { buildRuleContext } from '../../optimization/context';
import { estimateAnthropicRateLimits, performActivityMonitoring } from '../../rate-limits/poller';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

// The original bug compares ISO text ('2026-03-10T13:30:00.000Z') with SQLite's
// 'YYYY-MM-DD HH:MM:SS', so it only misbehaves when both fall on the same UTC date.
// A fixed clock mid-day makes every offset below land on a known date whatever time
// the suite runs; only Date is faked so the in-memory database keeps working.
const FIXED_NOW = Date.parse('2026-03-10T15:00:00.000Z');
const at = (offsetMs: number) => new Date(FIXED_NOW + offsetMs).toISOString();
const ago = (ms: number) => at(-ms);
// What a column DEFAULT CURRENT_TIMESTAMP writes: space-separated, no 'T' or 'Z'.
const sqlFormat = (iso: string) => iso.replace('T', ' ').slice(0, 19);

beforeEach(() => {
    jest.useFakeTimers({
        now: FIXED_NOW,
        doNotFake: ['hrtime', 'nextTick', 'performance', 'queueMicrotask', 'requestAnimationFrame', 'cancelAnimationFrame',
            'requestIdleCallback', 'cancelIdleCallback', 'setImmediate', 'clearImmediate', 'setInterval', 'clearInterval',
            'setTimeout', 'clearTimeout'],
    });
});
afterEach(() => { jest.useRealTimers(); });

describe('optimizer cache expiry', () => {
    const insert = (expiresAt: string, score: number) =>
        getDb().prepare(`INSERT INTO optimization_cache (computed_at, days_analyzed, score, total_savings_usd, results_json, expires_at)
            VALUES (?, 30, ?, 0, '[]', ?)`).run(new Date().toISOString(), score, expiresAt);

    beforeEach(() => {
        getDb().prepare('DELETE FROM optimization_cache').run();
        (buildRuleContext as jest.Mock).mockClear();
    });

    it('ignores a cache entry that expired 90 minutes ago (same UTC date)', async () => {
        expect(ago(1.5 * HOUR).slice(0, 10)).toBe(new Date().toISOString().slice(0, 10));
        insert(ago(1.5 * HOUR), 11);
        const run = await runOptimizationEngine(30, true);
        expect(buildRuleContext).toHaveBeenCalledTimes(1);
        expect(run.score).not.toBe(11);
    });

    it('uses a cache entry that expires in 30 minutes', async () => {
        insert(at(0.5 * HOUR), 42);
        const run = await runOptimizationEngine(30, true);
        expect(buildRuleContext).not.toHaveBeenCalled();
        expect(run.score).toBe(42);
    });

    it('compares correctly against an expiry written in SQLite format', async () => {
        insert(sqlFormat(at(0.5 * HOUR)), 43);
        const run = await runOptimizationEngine(30, true);
        expect(buildRuleContext).not.toHaveBeenCalled();
        expect(run.score).toBe(43);
    });

    it('stores a fresh entry that is valid for one hour, not until midnight', async () => {
        await runOptimizationEngine(30, false);
        const row = getDb().prepare('SELECT expires_at, computed_at FROM optimization_cache').get() as any;
        expect(Date.parse(row.expires_at) - Date.parse(row.computed_at)).toBe(HOUR);
    });
});

describe('rate-limit estimates', () => {
    // started_at is either ISO ('...T...Z') or SQLite format; both must be windowed the same way.
    const addSession = (provider: string, startedAt: string, id: string) =>
        getDb().prepare(`INSERT INTO sessions (provider, session_id, started_at, input_tokens, output_tokens) VALUES (?, ?, ?, 10, 5)`)
            .run(provider, id, startedAt);

    beforeEach(() => {
        getDb().prepare('DELETE FROM sessions').run();
        (insertRateLimitSnapshot as jest.Mock).mockClear();
    });

    const used = (windowType: string, provider?: string) => {
        const call = (insertRateLimitSnapshot as jest.Mock).mock.calls
            .map(c => c[0]).find(s => s.window_type === windowType && (!provider || s.provider === provider));
        return call.total_used;
    };

    it('counts a recent claude-code session and excludes one that is 6.5h old', () => {
        addSession('claude-code', ago(1 * HOUR), 'recent');
        addSession('claude-code', ago(6.5 * HOUR), 'old');
        estimateAnthropicRateLimits();
        expect(used('5h')).toBe(1);
    });

    it('applies the 5h window to SQLite-format timestamps on the cutoff date', () => {
        addSession('claude-code', sqlFormat(ago(4 * HOUR)), 'in-window');
        addSession('claude-code', sqlFormat(ago(5.5 * HOUR)), 'out-of-window');
        estimateAnthropicRateLimits();
        expect(used('5h')).toBe(1);
    });

    it('applies the 7-day window to activity monitoring, just inside and just outside the cutoff', () => {
        // The cutoff is 2026-03-03T15:00Z; both rows below are on that calendar date.
        addSession('cursor', ago(7 * DAY - 1 * HOUR), 'just-inside');
        addSession('cursor', ago(7 * DAY + 1 * HOUR), 'just-outside');
        addSession('cursor', sqlFormat(ago(7 * DAY - 1 * HOUR)), 'just-inside-sql');
        addSession('cursor', sqlFormat(ago(7 * DAY + 1 * HOUR)), 'just-outside-sql');
        addSession('cursor', ago(8 * DAY), 'long-ago');
        performActivityMonitoring('cursor');
        expect(used('activity_weekly', 'cursor')).toBe(2);
    });

    it('applies the daily window from 00:00 UTC of the current day', () => {
        addSession('cursor', ago(14.5 * HOUR), 'after-midnight'); // 00:30 today
        addSession('cursor', ago(15.5 * HOUR), 'before-midnight'); // 23:30 yesterday
        addSession('cursor', sqlFormat(ago(14.5 * HOUR)), 'after-midnight-sql');
        addSession('cursor', sqlFormat(ago(15.5 * HOUR)), 'before-midnight-sql');
        performActivityMonitoring('cursor');
        expect(used('activity_daily', 'cursor')).toBe(2);
    });
});
