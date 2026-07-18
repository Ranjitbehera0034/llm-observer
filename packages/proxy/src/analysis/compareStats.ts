/**
 * A/B Comparison — head-to-head statistics between two models, providers, or
 * request tags, computed from real request history (nothing simulated).
 *
 * This tool doesn't route or split live traffic itself (it's a passive
 * proxy/observer, not the thing deciding which model a call goes to) — so
 * "A/B testing" here honestly means a retrospective comparison of two groups
 * that already exist in the data: two models you've both used, two tag
 * values your own tooling assigned, etc.
 *
 * Statistics used are standard and disclosed, not dressed up: a two-sample
 * z-test (Welch-style standard error) for continuous metrics (cost, latency,
 * tokens), and a two-proportion pooled z-test for error rate. `significant`
 * is only ever true when BOTH groups have at least MIN_SAMPLE_FOR_SIGNIFICANCE
 * observations AND |z| >= 1.96 (95%) — small samples are always reported as
 * directional-only, never dressed up as significant.
 */

const MIN_SAMPLE_FOR_SIGNIFICANCE = 30;
const Z_95 = 1.96;

export interface GroupStats {
    n: number;
    mean: number;
    stddev: number;
}

export function summarize(values: number[]): GroupStats {
    const n = values.length;
    if (n === 0) return { n: 0, mean: 0, stddev: 0 };
    const mean = values.reduce((a, b) => a + b, 0) / n;
    const variance = n > 1 ? values.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1) : 0;
    return { n, mean, stddev: Math.sqrt(variance) };
}

export interface TwoSampleComparison {
    a: GroupStats;
    b: GroupStats;
    /** (b.mean - a.mean) / a.mean * 100 — null if a.mean is 0 (division undefined) */
    deltaPct: number | null;
    zScore: number | null;
    /** true only when both groups meet MIN_SAMPLE_FOR_SIGNIFICANCE and |zScore| >= 1.96 */
    significant: boolean;
    sufficientSample: boolean;
}

export function compareMeans(valuesA: number[], valuesB: number[]): TwoSampleComparison {
    const a = summarize(valuesA);
    const b = summarize(valuesB);
    const sufficientSample = a.n >= MIN_SAMPLE_FOR_SIGNIFICANCE && b.n >= MIN_SAMPLE_FOR_SIGNIFICANCE;

    let zScore: number | null = null;
    let significant = false;
    if (a.n > 1 && b.n > 1) {
        const se = Math.sqrt((a.stddev ** 2) / a.n + (b.stddev ** 2) / b.n);
        if (se > 0) {
            zScore = (b.mean - a.mean) / se;
            significant = sufficientSample && Math.abs(zScore) >= Z_95;
        }
    }

    const deltaPct = a.mean !== 0 ? ((b.mean - a.mean) / a.mean) * 100 : null;

    return { a, b, deltaPct, zScore, significant, sufficientSample };
}

export interface ProportionGroupStats {
    n: number;
    successes: number;
    rate: number;
}

export interface ProportionComparison {
    a: ProportionGroupStats;
    b: ProportionGroupStats;
    deltaPct: number | null;
    zScore: number | null;
    significant: boolean;
    sufficientSample: boolean;
}

export function compareProportions(nA: number, successesA: number, nB: number, successesB: number): ProportionComparison {
    const rateA = nA > 0 ? successesA / nA : 0;
    const rateB = nB > 0 ? successesB / nB : 0;
    const sufficientSample = nA >= MIN_SAMPLE_FOR_SIGNIFICANCE && nB >= MIN_SAMPLE_FOR_SIGNIFICANCE;

    let zScore: number | null = null;
    let significant = false;
    if (nA > 0 && nB > 0) {
        const pooled = (successesA + successesB) / (nA + nB);
        const se = Math.sqrt(pooled * (1 - pooled) * (1 / nA + 1 / nB));
        if (se > 0) {
            zScore = (rateB - rateA) / se;
            significant = sufficientSample && Math.abs(zScore) >= Z_95;
        }
    }

    const deltaPct = rateA !== 0 ? ((rateB - rateA) / rateA) * 100 : null;

    return {
        a: { n: nA, successes: successesA, rate: rateA },
        b: { n: nB, successes: successesB, rate: rateB },
        deltaPct,
        zScore,
        significant,
        sufficientSample
    };
}
