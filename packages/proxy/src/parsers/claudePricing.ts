import { getPricingForModel, fetchPricingFromDb } from '@llm-observer/database';

export interface UsageTotals {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    cacheWrite1h: number;
}

export const emptyTotals = (): UsageTotals => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cacheWrite1h: 0 });

export type CostSource = 'pricing_table' | 'estimated' | 'family_fallback' | 'unpriced';

interface Rate {
    model: string;
    input: number;
    output: number;
    cached: number | null;
}

export interface ResolvedPricing {
    rate: Rate;
    source: 'pricing_table' | 'family_fallback';
}

const hasTokens = (t: UsageTotals): boolean => t.input + t.output + t.cacheRead + t.cacheWrite > 0;

// 'claude-opus-4-5-20251101' and 'claude-opus-4-5' are the same model; '[1m]' marks a context variant.
export const normalizeModelId = (model: string): string =>
    model.trim().replace(/\[.*\]$/, '').replace(/-latest$/, '').replace(/-\d{8}$/, '');

// 'claude-opus-4-5' -> opus gen 405; 'claude-3-5-sonnet' -> sonnet gen 305. Both name orders exist in the wild.
const FAMILY_RE = /^claude-(?:([a-z]+)-(\d+)(?:-(\d{1,2}))?|(\d+)(?:-(\d{1,2}))?-([a-z]+))(?:-|$)/;

export const parseFamily = (model: string): { family: string; generation: number } | null => {
    const m = FAMILY_RE.exec(normalizeModelId(model));
    if (!m) return null;
    const family = m[1] || m[6];
    const major = parseInt(m[2] || m[4], 10);
    const minor = parseInt(m[3] || m[5] || '0', 10);
    return { family, generation: major * 100 + minor };
};

let tableRows: Rate[] | null = null;

/** Snapshot the Anthropic price rows once per parse cycle; the table is small and refreshed rarely. */
export const loadPricingRows = (): void => {
    try {
        tableRows = (fetchPricingFromDb() as any[])
            .filter(r => r.provider === 'anthropic')
            .map(r => ({
                model: r.model,
                input: r.input_cost_per_1m,
                output: r.output_cost_per_1m,
                cached: r.cached_input_cost_per_1m ?? null
            }));
    } catch {
        tableRows = [];
    }
};

const toRate = (p: { model: string; input: number; output: number; cached: number | null }): Rate =>
    ({ model: p.model, input: p.input, output: p.output, cached: p.cached });

/**
 * Exact id, then the same model ignoring a date suffix, then the nearest known generation of the
 * same family (the newest at or below the requested one, else the oldest above it).
 * Only the first two are real prices; the third is a guess and is reported as such.
 */
export const resolveClaudePricing = (model: string): ResolvedPricing | null => {
    if (!model) return null;
    const norm = normalizeModelId(model);

    const exact = getPricingForModel('anthropic', model) || getPricingForModel('anthropic', norm);
    if (exact) return { rate: toRate(exact), source: 'pricing_table' };

    if (!tableRows) loadPricingRows();
    const rows = tableRows || [];

    const sameModel = rows.find(r => normalizeModelId(r.model) === norm);
    if (sameModel) return { rate: sameModel, source: 'pricing_table' };

    const target = parseFamily(model);
    if (!target) return null;
    let below: { rate: Rate; generation: number } | null = null;
    let above: { rate: Rate; generation: number } | null = null;
    for (const r of rows) {
        const f = parseFamily(r.model);
        if (!f || f.family !== target.family) continue;
        if (f.generation <= target.generation) {
            if (!below || f.generation > below.generation) below = { rate: r, generation: f.generation };
        } else if (!above || f.generation < above.generation) {
            above = { rate: r, generation: f.generation };
        }
    }
    const pick = below || above;
    return pick ? { rate: pick.rate, source: 'family_fallback' } : null;
};

// Anthropic bills cache writes at 1.25x input (5-minute TTL) and 2x input (1-hour TTL),
// and cache reads at 0.1x input.
const CACHE_READ_MULTIPLE = 0.1;

// `derivedCacheRead` is set when the price row has no cached rate and the 0.1x input multiple was
// used instead, so the price is derived rather than an exact table match.
const bucketCost = (rate: Rate, totals: UsageTotals): { cost: number; derivedCacheRead: boolean } => {
    const cacheWrite5m = Math.max(0, totals.cacheWrite - totals.cacheWrite1h);
    const inputCost = (totals.input / 1_000_000) * rate.input;
    const outputCost = (totals.output / 1_000_000) * rate.output;
    const derivedCacheRead = !rate.cached && totals.cacheRead > 0;
    const cacheReadRate = rate.cached || rate.input * CACHE_READ_MULTIPLE;
    const cacheReadCost = (totals.cacheRead / 1_000_000) * cacheReadRate;
    const cacheWriteCost = (cacheWrite5m / 1_000_000) * rate.input * 1.25
        + (totals.cacheWrite1h / 1_000_000) * rate.input * 2;
    return { cost: inputCost + outputCost + cacheReadCost + cacheWriteCost, derivedCacheRead };
};

const SOURCE_RANK: Record<CostSource, number> = { pricing_table: 0, estimated: 1, family_fallback: 2, unpriced: 3 };

export interface PricedUsage {
    costUsd: number;
    isEstimated: boolean;
    costSource: CostSource;
}

/**
 * Price usage per model. Usage with no model on its event is priced at `fallbackModel`
 * (the session's dominant model). A model with tokens but no price at all contributes $0
 * and marks the result 'unpriced' so the zero is never mistaken for a real cost.
 */
export const priceUsageByModel = (buckets: Map<string, UsageTotals>, fallbackModel: string): PricedUsage => {
    const merged = new Map<string, UsageTotals>();
    for (const [model, totals] of buckets) {
        const key = model || fallbackModel;
        const into = merged.get(key) || emptyTotals();
        into.input += totals.input;
        into.output += totals.output;
        into.cacheRead += totals.cacheRead;
        into.cacheWrite += totals.cacheWrite;
        into.cacheWrite1h += totals.cacheWrite1h;
        merged.set(key, into);
    }

    let costUsd = 0;
    let costSource: CostSource = 'pricing_table';
    for (const [model, totals] of merged) {
        if (!hasTokens(totals)) continue;
        const resolved = resolveClaudePricing(model);
        let source: CostSource = resolved ? resolved.source : 'unpriced';
        if (resolved) {
            const priced = bucketCost(resolved.rate, totals);
            costUsd += priced.cost;
            if (priced.derivedCacheRead && source === 'pricing_table') source = 'estimated';
        }
        if (SOURCE_RANK[source] > SOURCE_RANK[costSource]) costSource = source;
    }
    return { costUsd, isEstimated: costSource !== 'pricing_table', costSource };
};
