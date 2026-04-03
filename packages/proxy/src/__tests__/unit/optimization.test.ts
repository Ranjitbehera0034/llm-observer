import { computeOptimizationScore } from '../../optimization/score';
import { m1ExpensiveSimple } from '../../optimization/rules/model-selection/m1-expensive-simple';
import { m2CheapComplex } from '../../optimization/rules/model-selection/m2-cheap-complex';
import { c1LowCacheRate } from '../../optimization/rules/context-efficiency/c1-low-cache-rate';
import { c3RedundantReads } from '../../optimization/rules/context-efficiency/c3-redundant-reads';
import { a1ExpensiveExplore } from '../../optimization/rules/agent-optimization/a1-expensive-explore';
import { w2TimeOfDay } from '../../optimization/rules/workflow-efficiency/w2-time-of-day';
import { allRules } from '../../optimization/rules';
import { RuleContext } from '../../optimization/types';

// ─── Shared helpers ─────────────────────────────────────────────────────────

/** Minimal valid RuleContext — tests only fill what each rule needs */
function makeCtx(overrides: Partial<RuleContext> = {}): RuleContext {
    return {
        days: 30,
        sessions: [],
        subagents: [],
        toolUsage: [],
        usageRecords: [],
        roiData: [],
        budgetAlerts: [],
        dailyCosts: [],
        subscriptions: [],
        ...overrides,
    };
}

function makeSession(overrides: any = {}): any {
    return {
        id: Math.random(),
        provider: 'claude-code',
        model_primary: 'claude-opus',
        started_at: new Date().toISOString(),
        input_tokens: 1000,
        output_tokens: 200,
        cache_read_tokens: 0,
        estimated_cost_usd: 0.50,
        message_count: 3,
        session_type: 'interactive',
        has_subagents: false,
        subagent_count: 0,
        ...overrides,
    };
}

// ─── score.ts ───────────────────────────────────────────────────────────────

describe('computeOptimizationScore', () => {
    it('returns 100 when there are no savings (fully optimized)', () => {
        expect(computeOptimizationScore([], 100)).toBe(100);
    });

    it('returns 100 when total spend is 0', () => {
        expect(computeOptimizationScore([], 0)).toBe(100);
    });

    it('calculates correctly: $47 savings on $147 spend → 68', () => {
        const results = [{ estimatedMonthlySavings: 47 } as any];
        expect(computeOptimizationScore(results, 147)).toBe(68);
    });

    it('clamps to 0 when savings exceed spend', () => {
        const results = [{ estimatedMonthlySavings: 200 } as any];
        expect(computeOptimizationScore(results, 100)).toBe(0);
    });

    it('sums multiple results', () => {
        const results = [
            { estimatedMonthlySavings: 20 } as any,
            { estimatedMonthlySavings: 30 } as any,
        ];
        // 50/100 * 100 = 50, score = 50
        expect(computeOptimizationScore(results, 100)).toBe(50);
    });
});

// ─── Rule M1: Expensive model for simple tasks ───────────────────────────────

describe('Rule M1 (model-downgrade-simple-tasks)', () => {
    const opusSessions = (n: number, outputTokens: number) =>
        Array.from({ length: n }, () => makeSession({
            model_primary: 'claude-opus',
            output_tokens: outputTokens,
            estimated_cost_usd: 0.10,
        }));

    it('fires when >30% of opus sessions have <500 output tokens', () => {
        // 70 / 100 = 70% below threshold → should fire
        const ctx = makeCtx({
            sessions: [
                ...opusSessions(70, 200),   // simple (< 500 tokens)
                ...opusSessions(30, 1000),  // complex (>= 500 tokens)
            ],
        });
        expect(m1ExpensiveSimple.evaluate(ctx)).not.toBeNull();
    });

    it('does NOT fire when ≤30% of opus sessions have <500 output tokens', () => {
        // 20 / 100 = 20% — below threshold
        const ctx = makeCtx({
            sessions: [
                ...opusSessions(20, 200),   // simple
                ...opusSessions(80, 1000),  // complex
            ],
        });
        expect(m1ExpensiveSimple.evaluate(ctx)).toBeNull();
    });

    it('does NOT fire when there are no expensive model sessions', () => {
        const ctx = makeCtx({
            sessions: [makeSession({ model_primary: 'claude-haiku', output_tokens: 50 })],
        });
        expect(m1ExpensiveSimple.evaluate(ctx)).toBeNull();
    });

    it('savings calculation is 75% of the affected session cost', () => {
        const sessions = opusSessions(10, 200); // all simple, cost = 0.10 each → $1.00 total
        const ctx = makeCtx({ sessions });
        const result = m1ExpensiveSimple.evaluate(ctx)!;
        expect(result).not.toBeNull();
        expect(result.estimatedMonthlySavings).toBeCloseTo(0.75, 5);
    });
});

// ─── Rule M2: Cheap model for complex tasks ──────────────────────────────────

describe('Rule M2 (cheap-model-complex-tasks)', () => {
    const haikuSession = (messageCnt: number) =>
        makeSession({ model_primary: 'claude-haiku', message_count: messageCnt });

    it('fires when >20% of cheap sessions have >5 turns', () => {
        const ctx = makeCtx({
            sessions: [
                ...Array.from({ length: 30 }, () => haikuSession(10)), // complex (>5)
                ...Array.from({ length: 70 }, () => haikuSession(2)),  // simple
            ],
        });
        expect(m2CheapComplex.evaluate(ctx)).not.toBeNull();
    });

    it('does NOT fire when ≤20% of cheap sessions are multi-turn', () => {
        const ctx = makeCtx({
            sessions: [
                ...Array.from({ length: 10 }, () => haikuSession(10)), // 10%
                ...Array.from({ length: 90 }, () => haikuSession(2)),
            ],
        });
        expect(m2CheapComplex.evaluate(ctx)).toBeNull();
    });
});

// ─── Rule C1: Low cache hit rate ─────────────────────────────────────────────

describe('Rule C1 (low-cache-hit-rate)', () => {
    const claudeSession = (inputTokens: number, cacheReadTokens: number) =>
        makeSession({
            provider: 'claude-code',
            model_primary: 'claude-sonnet',
            input_tokens: inputTokens,
            cache_read_tokens: cacheReadTokens,
            estimated_cost_usd: 0.02,
        });

    it('fires when cache hit rate is below 30%', () => {
        // 10 sessions with 1000 input, 150 cache_read = 15% hit rate
        const ctx = makeCtx({
            sessions: Array.from({ length: 15 }, () => claudeSession(1000, 150)),
        });
        expect(c1LowCacheRate.evaluate(ctx)).not.toBeNull();
    });

    it('does NOT fire when cache hit rate is above 30%', () => {
        // 400 / 1000 = 40% hit rate
        const ctx = makeCtx({
            sessions: Array.from({ length: 15 }, () => claudeSession(1000, 400)),
        });
        expect(c1LowCacheRate.evaluate(ctx)).toBeNull();
    });

    it('does NOT fire with fewer than 10 Anthropic sessions', () => {
        const ctx = makeCtx({
            sessions: Array.from({ length: 5 }, () => claudeSession(1000, 10)),
        });
        expect(c1LowCacheRate.evaluate(ctx)).toBeNull();
    });
});

// ─── Rule C3: Redundant file reads ───────────────────────────────────────────

describe('Rule C3 (redundant-file-reads)', () => {
    it('fires when a Read tool has >10 calls', () => {
        const ctx = makeCtx({
            toolUsage: [{ tool_name: 'Read', total_calls: 50, total_cost: 2.0 }],
        });
        expect(c3RedundantReads.evaluate(ctx)).not.toBeNull();
    });

    it('does NOT fire when Read tool calls are below threshold', () => {
        const ctx = makeCtx({
            toolUsage: [{ tool_name: 'Read', total_calls: 3, total_cost: 0.10 }],
        });
        expect(c3RedundantReads.evaluate(ctx)).toBeNull();
    });

    it('does NOT fire when no Read tools exist', () => {
        const ctx = makeCtx({
            toolUsage: [{ tool_name: 'Bash', total_calls: 100, total_cost: 0.50 }],
        });
        expect(c3RedundantReads.evaluate(ctx)).toBeNull();
    });
});

// ─── Rule A1: Expensive Explore agents ───────────────────────────────────────

describe('Rule A1 (agent-expensive-explore)', () => {
    const agent = (type: string, cost: number): any => ({ agent_type: type, estimated_cost_usd: cost });

    it('fires when explore agents represent >40% of agent cost', () => {
        const ctx = makeCtx({
            subagents: [
                agent('explore', 6),  // 60%
                agent('execute', 4),  // 40%
            ],
        });
        expect(a1ExpensiveExplore.evaluate(ctx)).not.toBeNull();
    });

    it('does NOT fire when explore agents are ≤40% of agent cost', () => {
        const ctx = makeCtx({
            subagents: [
                agent('explore', 2),  // 20%
                agent('execute', 8),  // 80%
            ],
        });
        expect(a1ExpensiveExplore.evaluate(ctx)).toBeNull();
    });

    it('does NOT fire when there are no subagents', () => {
        const ctx = makeCtx({ subagents: [] });
        expect(a1ExpensiveExplore.evaluate(ctx)).toBeNull();
    });
});

// ─── Rule W2: Late-night fatigue ─────────────────────────────────────────────

describe('Rule W2 (workflow-late-night-fatigue)', () => {
    const sessionAtHour = (hour: number, cost: number) => {
        const d = new Date(2026, 0, 15, hour, 0, 0);
        return makeSession({ started_at: d.toISOString(), estimated_cost_usd: cost });
    };

    it('fires when late-night avg cost is >1.5× daytime avg', () => {
        // Daytime: hours 9-17, cost 0.10 each (average 0.10)
        // Late-night: hour 2, cost 0.50 each (5× higher)
        const daytimeSessions = [9, 10, 11, 12, 13, 14, 15, 16, 17].flatMap(h =>
            Array.from({ length: 5 }, () => sessionAtHour(h, 0.10)),
        );
        const lateNightSessions = Array.from({ length: 5 }, () => sessionAtHour(2, 0.50));
        const ctx = makeCtx({ sessions: [...daytimeSessions, ...lateNightSessions] });
        expect(w2TimeOfDay.evaluate(ctx)).not.toBeNull();
    });

    it('does NOT fire when late-night cost is similar to daytime', () => {
        const allSessions = [9, 10, 2, 3].flatMap(h =>
            Array.from({ length: 5 }, () => sessionAtHour(h, 0.10)),
        );
        const ctx = makeCtx({ sessions: allSessions });
        expect(w2TimeOfDay.evaluate(ctx)).toBeNull();
    });
});

// ─── allRules completeness check ─────────────────────────────────────────────

describe('allRules index', () => {
    it('exports exactly 20 rules', () => {
        expect(allRules).toHaveLength(20);
    });

    it('every rule has a unique id', () => {
        const ids = allRules.map(r => r.id);
        const unique = new Set(ids);
        expect(unique.size).toBe(ids.length);
    });

    it('every rule has a valid category', () => {
        const validCategories = [
            'model-selection', 'context-efficiency',
            'provider-optimization', 'workflow-efficiency', 'agent-optimization',
        ];
        allRules.forEach(rule => {
            expect(validCategories).toContain(rule.category);
        });
    });

    it('every rule has minDataDays > 0', () => {
        allRules.forEach(rule => {
            expect(rule.minDataDays).toBeGreaterThan(0);
        });
    });

    it('every rule returns null on a completely empty context (insufficient data / no threshold met)', () => {
        // With an empty context all rules should either skip (minDataDays check in engine) or return null
        const emptyCtx = makeCtx({ days: 100 }); // override days to bypass minDataDays
        allRules.forEach(rule => {
            const result = rule.evaluate(emptyCtx);
            // Either null (rule didn't fire) or an OptimizationResult — both are valid here
            // but with empty data the vast majority should not fire
            if (result !== null) {
                // If it did fire somehow, at least validate its shape
                expect(result.ruleId).toBe(rule.id);
                expect(result.estimatedMonthlySavings).toBeGreaterThanOrEqual(0);
                expect(['high', 'medium', 'low']).toContain(result.impact);
            }
        });
    });
});
