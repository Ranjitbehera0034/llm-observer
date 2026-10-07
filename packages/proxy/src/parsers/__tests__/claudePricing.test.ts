import { normalizeModelId, parseFamily, resolveClaudePricing, loadPricingRows, priceUsageByModel, emptyTotals } from '../claudePricing';

const rows = [
    ['claude-opus-4-20250514', 15, 75], ['claude-opus-4-5-20251101', 5, 25], ['claude-opus-4-8', 5, 25],
    ['claude-sonnet-4-20250514', 3, 15], ['claude-sonnet-4-5-20250929', 3, 15],
    ['claude-haiku-4-5-20251001', 1, 5], ['claude-3-5-haiku-20241022', 0.8, 4], ['claude-3-opus-20240229', 15, 75]
].map(([model, i, o]) => ({ provider: 'anthropic', model, input_cost_per_1m: i, output_cost_per_1m: o, cached_input_cost_per_1m: null }));

jest.mock('@llm-observer/database', () => ({
    getPricingForModel: jest.fn(() => undefined),
    fetchPricingFromDb: jest.fn(() => rows)
}));

describe('claude pricing resolution', () => {
    beforeEach(() => loadPricingRows());

    it('normalizes date, latest and context-variant suffixes', () => {
        expect(normalizeModelId('claude-sonnet-4-5-20250929')).toBe('claude-sonnet-4-5');
        expect(normalizeModelId('claude-opus-4-6[1m]')).toBe('claude-opus-4-6');
        expect(normalizeModelId('claude-3-5-haiku-latest')).toBe('claude-3-5-haiku');
    });

    it('parses family and generation in both name orders', () => {
        expect(parseFamily('claude-opus-4-5-20251101')).toEqual({ family: 'opus', generation: 405 });
        expect(parseFamily('claude-sonnet-4-20250514')).toEqual({ family: 'sonnet', generation: 400 });
        expect(parseFamily('claude-3-5-haiku-20241022')).toEqual({ family: 'haiku', generation: 305 });
        expect(parseFamily('gpt-5')).toBeNull();
    });

    it('treats the same model with a different date suffix as a real price', () => {
        const r = resolveClaudePricing('claude-sonnet-4-5');
        expect(r?.source).toBe('pricing_table');
        expect(r?.rate.input).toBe(3);
    });

    it('falls back to the newest known generation at or below the requested one', () => {
        const r = resolveClaudePricing('claude-opus-5-5');
        expect(r?.source).toBe('family_fallback');
        expect(r?.rate.model).toBe('claude-opus-4-8');
        // an old-generation id must not borrow a newer (cheaper) price when an older one exists
        expect(resolveClaudePricing('claude-opus-4-1-20250805')?.rate.model).toBe('claude-opus-4-20250514');
    });

    it('falls back upward when only newer generations are known', () => {
        const r = resolveClaudePricing('claude-haiku-3');
        expect(r?.source).toBe('family_fallback');
        expect(r?.rate.model).toBe('claude-3-5-haiku-20241022');
    });

    it('returns null for unknown families and non-Claude ids', () => {
        expect(resolveClaudePricing('claude-fable-9')).toBeNull();
        expect(resolveClaudePricing('gpt-5')).toBeNull();
        expect(resolveClaudePricing('')).toBeNull();
    });
});

describe('cache-read pricing when the price row has no cached rate', () => {
    beforeEach(() => loadPricingRows());

    it('prices cache reads at 0.1x the input rate and marks the result estimated', () => {
        // claude-3-opus-20240229 is an exact row ($15 in / $75 out) with cached: null
        const totals = { ...emptyTotals(), input: 1_000_000, cacheRead: 1_000_000 };
        const r = priceUsageByModel(new Map([['claude-3-opus-20240229', totals]]), 'claude-3-opus-20240229');
        expect(r.costUsd).toBeCloseTo(15 + 1.5, 6);
        expect(r.isEstimated).toBe(true);
        expect(r.costSource).toBe('estimated');
    });

    it('does not flag a session with no cache reads', () => {
        const totals = { ...emptyTotals(), input: 1_000_000, output: 1_000_000 };
        const r = priceUsageByModel(new Map([['claude-3-opus-20240229', totals]]), 'claude-3-opus-20240229');
        expect(r.costUsd).toBeCloseTo(90, 6);
        expect(r.isEstimated).toBe(false);
        expect(r.costSource).toBe('pricing_table');
    });
});
