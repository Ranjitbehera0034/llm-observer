// Optimizer gating: rules must be judged against the days of data actually
// present (not the requested window), and a thin history must not produce
// savings, a plan multiple or a "perfect" score built on invented numbers.
let mockSessions: any[] = [];
let mockRequests: any[] = [];
jest.mock('@llm-observer/database', () => {
    const { createTestDb } = require('../helpers/testDb');
    const t = createTestDb();
    return {
        getDb: () => t.database,
        getSessions: () => mockSessions,
        getRequests: () => mockRequests,
        getSubscriptions: () => [],
    };
});

import { getDb } from '@llm-observer/database';
import { runOptimizationEngine } from '../../optimization/engine';
import { buildRuleContext } from '../../optimization/context';
import { allRules } from '../../optimization/rules';
import { dedupeSessionSavings } from '../../optimization/dedupe';
import { w2TimeOfDay } from '../../optimization/rules/workflow-efficiency/w2-time-of-day';
import { p2SubscriptionValue } from '../../optimization/rules/provider-optimization/p2-subscription-value';
import { m3ProjectMismatch } from '../../optimization/rules/model-selection/m3-project-mismatch';
import { OptimizationResult, RuleContext } from '../../optimization/types';
import { AppCorrelator } from '../../services/appCorrelator';

const DAY = 24 * 60 * 60 * 1000;

function session(i: number, overrides: any = {}): any {
    return {
        id: i,
        session_id: `s${i}`,
        provider: 'claude-code',
        model_primary: 'claude-opus-4',
        project_name: 'proj',
        started_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
        input_tokens: 20000,
        output_tokens: 100,
        cache_read_tokens: 0,
        estimated_cost_usd: 3,
        message_count: 40,
        subagent_count: 9,
        deepest_agent_depth: 6,
        ...overrides,
    };
}

function ctx(overrides: Partial<RuleContext> = {}): RuleContext {
    return {
        days: 30, dataDays: 30, sessions: [], subagents: [], toolUsage: [], usageRecords: [],
        roiData: [], budgetAlerts: [], dailyCosts: [], subscriptions: [], ...overrides,
    } as RuleContext;
}

beforeEach(() => {
    mockSessions = [];
    mockRequests = [];
    getDb().prepare('DELETE FROM optimization_cache').run();
});

describe('buildRuleContext data-day accounting', () => {
    it('reports 0 days with no data and 1 day for a fresh install, whatever window was requested', async () => {
        expect((await buildRuleContext(30)).dataDays).toBe(0);
        mockSessions = [session(1), session(2), session(3)];
        const c = await buildRuleContext(30);
        expect(c.days).toBe(30);
        expect(c.dataDays).toBe(1);
    });

    it('counts the span back to the oldest session, capped at the window', async () => {
        mockSessions = [session(1, { started_at: new Date(Date.now() - 9.5 * DAY).toISOString() }), session(2)];
        expect((await buildRuleContext(30)).dataDays).toBe(10);
        expect((await buildRuleContext(7)).dataDays).toBe(7);
    });
});

describe('engine gating on a one-day, three-session install', () => {
    it('reports no savings, no plan multiple and flags the data as insufficient', async () => {
        mockSessions = [session(1), session(2), session(3)];
        const run = await runOptimizationEngine(30, false);
        expect(run.results).toEqual([]);
        expect(run.totalSavingsUsd).toBe(0);
        expect(run.planValue.valueMultiple).toBe(0);
        expect(run.dataDays).toBe(1);
        expect(run.sessionCount).toBe(3);
        expect(run.sufficientData).toBe(false);
    });

    it('lets rules fire once there are enough days and sessions', async () => {
        const old = new Date(Date.now() - 20 * DAY).toISOString();
        mockSessions = Array.from({ length: 12 }, (_, i) => session(i, { started_at: i === 0 ? old : undefined, subagent_count: 0, deepest_agent_depth: 0 })
            ).map(s => ({ ...s, started_at: s.started_at ?? new Date(Date.now() - 3600_000).toISOString() }));
        const run = await runOptimizationEngine(30, false);
        expect(run.sufficientData).toBe(true);
        expect(run.results.length).toBeGreaterThan(0);
        expect(run.results.every(r => r.basis === 'measured' || r.basis === 'heuristic')).toBe(true);
    });
});

describe('rule set', () => {
    it('has no rule that returns a hard-coded savings constant', () => {
        const ids = allRules.map(r => r.id);
        expect(ids).not.toContain('provider-arbitrage');
        expect(ids).not.toContain('agent-duplicate-work');
        expect(ids).not.toContain('unused-context-window');
    });

    it('lets only the request-based plan rule run without sessions', () => {
        const noSessions = allRules.filter(r => r.minSessions === 0).map(r => r.id);
        expect(noSessions).toEqual(['plan-upgrade-recommendation']);
    });
});

describe('w2 late-night percentage', () => {
    const at = (hour: number, cost: number, i: number) => {
        const d = new Date(2026, 0, 15, hour, 0, 0);
        return session(i, { started_at: d.toISOString(), estimated_cost_usd: cost });
    };

    it('reports the percentage above daytime, not ratio times ten', () => {
        const sessions = [
            ...[9, 10, 11, 12].flatMap((h, a) => [at(h, 1, a * 2), at(h, 1, a * 2 + 1)]),
            at(2, 3, 100), at(2, 3, 101),
        ];
        const r = w2TimeOfDay.evaluate(ctx({ sessions }))!;
        expect(r).not.toBeNull();
        // late-night $3 vs daytime $1 => 200% more
        expect(r.description).toContain('200% more');
        expect(r.description).not.toContain('30%');
    });
});

describe('p2 subscription value', () => {
    const sub: any = { service_name: 'Cursor Pro', monthly_cost_usd: 20 };

    it('does not claim $0 API equivalent for a tool with no real session data', () => {
        expect(p2SubscriptionValue.evaluate(ctx({ subscriptions: [sub], sessions: [] }))).toBeNull();
        // sessions exist but carry no cost/tokens (mock/placeholder rows)
        const mock = session(1, { provider: 'cursor', estimated_cost_usd: 0, input_tokens: 0, output_tokens: 0, message_count: 0 });
        expect(p2SubscriptionValue.evaluate(ctx({ subscriptions: [sub], sessions: [mock] }))).toBeNull();
    });

    it('still reports when real cursor usage is far below the plan price', () => {
        const sessions = Array.from({ length: 12 }, (_, i) => session(i, { provider: 'cursor', estimated_cost_usd: 0.5 }));
        const r = p2SubscriptionValue.evaluate(ctx({ subscriptions: [sub], sessions }))!;
        expect(r).not.toBeNull();
        expect(r.basis).toBe('measured');
        expect(r.estimatedMonthlySavings).toBeCloseTo(14, 5);
    });
});

describe('m3 savings are computed, not a constant', () => {
    it('scales with the outlier project opus spend', () => {
        const mk = (n: number, cost: number) => [
            ...Array.from({ length: 10 }, (_, i) => session(n + i, { project_name: 'big', model_primary: 'claude-opus-4', estimated_cost_usd: cost })),
            ...Array.from({ length: 10 }, (_, i) => session(n + 100 + i, { project_name: 'small', model_primary: 'claude-sonnet-4', estimated_cost_usd: cost })),
        ];
        const a = m3ProjectMismatch.evaluate(ctx({ sessions: mk(0, 1) }))!;
        const b = m3ProjectMismatch.evaluate(ctx({ sessions: mk(1000, 2) }))!;
        expect(a.estimatedMonthlySavings).toBeGreaterThan(0);
        expect(a.estimatedMonthlySavings).not.toBe(15);
        expect(b.estimatedMonthlySavings).toBeCloseTo(a.estimatedMonthlySavings * 2, 5);
        expect(a.basis).toBe('heuristic');
    });
});

describe('dedupeSessionSavings', () => {
    const res = (ruleId: string, total: number, sessionSavings: Record<string, number>): OptimizationResult => ({
        ruleId, title: ruleId, description: '', category: 'workflow-efficiency', impact: 'low',
        estimatedMonthlySavings: total, action: '', basis: 'heuristic', dataPoints: {}, sessionSavings,
    });

    it('counts a session once, at the largest saving claimed for it', () => {
        const out = dedupeSessionSavings([
            res('a', 0.75, { s1: 0.75 }),
            res('b', 0.3, { s1: 0.3 }),
            res('c', 0.5, { s1: 0.2, s2: 0.3 }),
        ]);
        const total = out.reduce((a, r) => a + r.estimatedMonthlySavings, 0);
        expect(total).toBeCloseTo(0.75 + 0.3, 5); // s1 once at 0.75, s2 at 0.3
        expect(out.find(r => r.ruleId === 'b')!.estimatedMonthlySavings).toBe(0);
        expect(out.every(r => r.sessionSavings === undefined)).toBe(true);
    });

    it('keeps savings that are not tied to sessions untouched', () => {
        const out = dedupeSessionSavings([{ ...res('x', 9, {}), sessionSavings: undefined }]);
        expect(out[0].estimatedMonthlySavings).toBe(9);
    });

    it('does not double-count sessions across real rules on the same data', async () => {
        const sessions = Array.from({ length: 12 }, (_, i) => session(i, {
            started_at: new Date(Date.now() - (i === 0 ? 20 : 0.1) * DAY).toISOString(),
        }));
        mockSessions = sessions;
        const run = await runOptimizationEngine(30, false);
        const spend = sessions.reduce((a, s) => a + s.estimated_cost_usd, 0);
        expect(run.totalSavingsUsd).toBeLessThanOrEqual(spend);
    });
});

describe('app attribution note', () => {
    it('does not claim an unmeasured accuracy figure', async () => {
        const res = await AppCorrelator.getAppSpend('month');
        expect(res.note).not.toMatch(/\d+-\d+%/);
    });
});
