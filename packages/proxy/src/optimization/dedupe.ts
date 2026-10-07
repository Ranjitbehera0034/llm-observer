import { SessionRecord } from '@llm-observer/database';
import { OptimizationResult, sessionKey } from './types';

/**
 * Rules that price a saving as a fraction of session cost overlap: one session
 * can be a long session, a retry storm and a deep agent tree at once, and each
 * rule would claim its own slice of the same dollars. Count each session once,
 * at the largest saving any rule claims for it, and credit that to the rule
 * with the biggest claim first. Results without sessionSavings are untouched.
 * sessionSavings is removed from the output.
 */
export function dedupeSessionSavings(results: OptimizationResult[]): OptimizationResult[] {
    const claimed = new Map<string, number>();
    const ordered = [...results].sort((a, b) => b.estimatedMonthlySavings - a.estimatedMonthlySavings);
    const adjusted = new Map<OptimizationResult, number>();

    for (const r of ordered) {
        if (!r.sessionSavings) continue;
        const claims = Object.entries(r.sessionSavings);
        const attributed = claims.reduce((acc, [, v]) => acc + v, 0);
        let credit = 0;
        for (const [key, value] of claims) {
            const already = claimed.get(key) || 0;
            if (value > already) {
                credit += value - already;
                claimed.set(key, value);
            }
        }
        // Keep any part of the saving that is not attributed to a session.
        adjusted.set(r, Math.max(0, r.estimatedMonthlySavings - attributed) + credit);
    }

    return results.map(r => {
        const { sessionSavings, ...rest } = r;
        return adjusted.has(r) ? { ...rest, estimatedMonthlySavings: adjusted.get(r)! } : rest;
    });
}

/** sessionSavings for a rule that saves `rate` of each given session's cost. */
export function sessionSavingsAt(sessions: SessionRecord[], rate: number): Record<string, number> {
    const out: Record<string, number> = {};
    for (const s of sessions) {
        out[sessionKey(s)] = (s.estimated_cost_usd || 0) * rate;
    }
    return out;
}
