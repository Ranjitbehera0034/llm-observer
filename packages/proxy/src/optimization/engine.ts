import { OptimizationRule, OptimizationResult, RuleContext } from './types';
import { buildRuleContext } from './context';
import { allRules } from './rules';
import { computeOptimizationScore } from './score';
import { computePlanValue, PlanValue } from './planValue';
import { getDb } from '@llm-observer/database';
import { sqlAfter } from '../utils/time';
import { dedupeSessionSavings } from './dedupe';

/** Fewest days of data before any optimizer result is considered meaningful. */
export const MIN_DATA_DAYS = 3;
/** Sessions a rule needs by default (rules working from request data override via minSessions). */
export const DEFAULT_MIN_SESSIONS = 10;

export interface OptimizationRun {
    score: number;
    totalSavingsUsd: number;
    results: OptimizationResult[];
    computedAt: string;
    daysAnalyzed: number;
    /** Days of data actually present in the window. */
    dataDays: number;
    sessionCount: number;
    /** False when there is too little history for the score and savings to mean anything. */
    sufficientData: boolean;
    planValue: PlanValue;
}

export async function runOptimizationEngine(days: number = 30, useCache: boolean = true): Promise<OptimizationRun> {
    const db = getDb();

    if (useCache) {
        const cached = db.prepare(`SELECT * FROM optimization_cache WHERE ${sqlAfter('expires_at')} AND days_analyzed = ? ORDER BY computed_at DESC LIMIT 1`).get(new Date().toISOString(), days) as any;
        const stored = cached ? parseCachedResults(cached.results_json) : null;
        if (cached && stored) {
            return {
                score: cached.score,
                totalSavingsUsd: cached.total_savings_usd,
                results: stored.results,
                computedAt: cached.computed_at,
                daysAnalyzed: cached.days_analyzed,
                dataDays: stored.dataDays,
                sessionCount: stored.sessionCount,
                sufficientData: stored.sufficientData,
                // Computed on read, not cached, so a plan-price change takes
                // effect immediately instead of waiting for cache expiry.
                planValue: computePlanValue(cached.total_savings_usd)
            };
        }
    }

    const context = await buildRuleContext(days);
    const sessionCount = context.sessions.length;
    const sufficientData = context.dataDays >= MIN_DATA_DAYS && sessionCount >= DEFAULT_MIN_SESSIONS;
    let results: OptimizationResult[] = [];

    // Gate on the days of data actually present (and sessions seen), not the
    // requested window: a one-day install asked for 30 days is a one-day install.
    for (const rule of allRules) {
        try {
            const minSessions = rule.minSessions ?? DEFAULT_MIN_SESSIONS;
            if (context.dataDays < rule.minDataDays) {
                console.log(`[OptimizationEngine] Skipping rule ${rule.id}: Needs ${rule.minDataDays} days of data, have ${context.dataDays}`);
            } else if (sessionCount < minSessions) {
                console.log(`[OptimizationEngine] Skipping rule ${rule.id}: Needs ${minSessions} sessions, have ${sessionCount}`);
            } else {
                const result = rule.evaluate(context);
                if (result) {
                    results.push(result);
                }
            }
        } catch (error) {
            console.error(`[OptimizationEngine] Error running rule ${rule.id}:`, error);
        }
    }

    // Overlapping rules can claim the same sessions; count each session once.
    results = dedupeSessionSavings(results);

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
        dataDays: context.dataDays,
        sessionCount,
        sufficientData,
        planValue: computePlanValue(totalSavings)
    };

    // Save to cache
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + 1);

    db.prepare(`
        INSERT INTO optimization_cache (computed_at, days_analyzed, score, total_savings_usd, results_json, expires_at)
        VALUES (?, ?, ?, ?, ?, ?)
    `).run(run.computedAt, run.daysAnalyzed, run.score, run.totalSavingsUsd, JSON.stringify({ results: run.results, dataDays: run.dataDays, sessionCount: run.sessionCount, sufficientData: run.sufficientData }), expiresAt.toISOString());

    return run;
}

interface CachedRun {
    results: OptimizationResult[];
    dataDays: number;
    sessionCount: number;
    sufficientData: boolean;
}

/** Null for entries cached by an older version (bare array of ungated results). */
function parseCachedResults(json: string): CachedRun | null {
    const parsed = JSON.parse(json);
    if (Array.isArray(parsed)) {
        return parsed.length === 0 ? { results: [], dataDays: 0, sessionCount: 0, sufficientData: false } : null;
    }
    return parsed;
}
