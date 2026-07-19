import { OptimizationRule, OptimizationResult, RuleContext } from './types';
import { buildRuleContext } from './context';
import { allRules } from './rules';
import { computeOptimizationScore } from './score';
import { computePlanValue, PlanValue } from './planValue';
import { getDb } from '@llm-observer/database';

export interface OptimizationRun {
    score: number;
    totalSavingsUsd: number;
    results: OptimizationResult[];
    computedAt: string;
    daysAnalyzed: number;
    planValue: PlanValue;
}

export async function runOptimizationEngine(days: number = 30, useCache: boolean = true): Promise<OptimizationRun> {
    const db = getDb();

    if (useCache) {
        const cached = db.prepare('SELECT * FROM optimization_cache WHERE expires_at > CURRENT_TIMESTAMP AND days_analyzed = ? ORDER BY computed_at DESC LIMIT 1').get(days) as any;
        if (cached) {
            return {
                score: cached.score,
                totalSavingsUsd: cached.total_savings_usd,
                results: JSON.parse(cached.results_json),
                computedAt: cached.computed_at,
                daysAnalyzed: cached.days_analyzed,
                // Computed on read, not cached, so a plan-price change takes
                // effect immediately instead of waiting for cache expiry.
                planValue: computePlanValue(cached.total_savings_usd)
            };
        }
    }

    const context = await buildRuleContext(days);
    const results: OptimizationResult[] = [];

    for (const rule of allRules) {
        try {
            if (context.days >= rule.minDataDays) {
                const result = rule.evaluate(context);
                if (result) {
                    results.push(result);
                }
            } else {
                console.log(`[OptimizationEngine] Skipping rule ${rule.id}: Needs ${rule.minDataDays} days, have ${context.days}`);
            }
        } catch (error) {
            console.error(`[OptimizationEngine] Error running rule ${rule.id}:`, error);
        }
    }

    // Sort results by savings descending
    results.sort((a, b) => b.estimatedMonthlySavings - a.estimatedMonthlySavings);

    const totalSpend = context.dailyCosts.reduce((acc, curr) => acc + curr.cost, 0);
    const score = computeOptimizationScore(results, totalSpend);
    const totalSavings = results.reduce((acc, curr) => acc + curr.estimatedMonthlySavings, 0);

    const run: OptimizationRun = {
        score,
        totalSavingsUsd: totalSavings,
        results,
        computedAt: new Date().toISOString(),
        daysAnalyzed: days,
        planValue: computePlanValue(totalSavings)
    };

    // Save to cache
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + 1);

    db.prepare(`
        INSERT INTO optimization_cache (computed_at, days_analyzed, score, total_savings_usd, results_json, expires_at)
        VALUES (?, ?, ?, ?, ?, ?)
    `).run(run.computedAt, run.daysAnalyzed, run.score, run.totalSavingsUsd, JSON.stringify(run.results), expiresAt.toISOString());

    return run;
}
