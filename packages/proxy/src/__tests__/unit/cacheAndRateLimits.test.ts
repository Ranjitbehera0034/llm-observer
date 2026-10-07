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
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();

describe('optimizer cache expiry', () => {
    const insert = (expiresAt: string, score: number) =>
        getDb().prepare(`INSERT INTO optimization_cache (computed_at, days_analyzed, score, total_savings_usd, results_json, expires_at)
            VALUES (?, 30, ?, 0, '[]', ?)`).run(new Date().toISOString(), score, expiresAt);

    beforeEach(() => {
        getDb().prepare('DELETE FROM optimization_cache').run();
        (buildRuleContext as jest.Mock).mockClear();
    });

    it('ignores a cache entry that expired 90 minutes ago (same UTC date)', async () => {
        insert(ago(1.5 * HOUR), 11);
        const run = await runOptimizationEngine(30, true);
        expect(buildRuleContext).toHaveBeenCalledTimes(1);
        expect(run.score).not.toBe(11);
    });

    it('uses a cache entry that expires in 30 minutes', async () => {
        insert(ago(-0.5 * HOUR), 42);
        const run = await runOptimizationEngine(30, true);
        expect(buildRuleContext).not.toHaveBeenCalled();
        expect(run.score).toBe(42);
    });

    it('stores a fresh entry that is valid for one hour, not until midnight', async () => {
        await runOptimizationEngine(30, false);
        const row = getDb().prepare('SELECT expires_at, computed_at FROM optimization_cache').get() as any;
        const ttl = Date.parse(row.expires_at) - Date.parse(row.computed_at);
        expect(Math.abs(ttl - HOUR)).toBeLessThan(5000);
    });
});

describe('rate-limit estimates', () => {
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

    it('applies the 7-day window to activity monitoring', () => {
        addSession('cursor', ago(2 * 24 * HOUR), 'in-week');
        addSession('cursor', ago(8 * 24 * HOUR), 'out-of-week');
        performActivityMonitoring('cursor');
        expect(used('activity_weekly', 'cursor')).toBe(1);
    });
});
