import { summarize, compareMeans, compareProportions } from '../compareStats';

describe('summarize', () => {
    it('computes mean and sample stddev correctly', () => {
        const s = summarize([2, 4, 4, 4, 5, 5, 7, 9]);
        expect(s.n).toBe(8);
        expect(s.mean).toBeCloseTo(5, 5);
        expect(s.stddev).toBeCloseTo(2.138, 2);
    });

    it('returns zeros for an empty array', () => {
        expect(summarize([])).toEqual({ n: 0, mean: 0, stddev: 0 });
    });

    it('returns zero stddev for a single value', () => {
        expect(summarize([5])).toEqual({ n: 1, mean: 5, stddev: 0 });
    });
});

describe('compareMeans', () => {
    it('reports directional-only (not significant) with small samples even if means differ a lot', () => {
        const a = [1, 1, 1, 1, 1];
        const b = [10, 10, 10, 10, 10];
        const result = compareMeans(a, b);
        expect(result.sufficientSample).toBe(false);
        expect(result.significant).toBe(false); // small n — never claim significance
        expect(result.deltaPct).toBeCloseTo(900, 1);
    });

    it('detects a real, large, well-sampled difference as significant', () => {
        // Two clearly separated distributions, well above the sample-size threshold
        const a = Array.from({ length: 100 }, (_, i) => 1.0 + (i % 5) * 0.01); // ~1.0-1.04
        const b = Array.from({ length: 100 }, (_, i) => 2.0 + (i % 5) * 0.01); // ~2.0-2.04
        const result = compareMeans(a, b);
        expect(result.sufficientSample).toBe(true);
        expect(result.significant).toBe(true);
        expect(result.zScore).not.toBeNull();
        expect(Math.abs(result.zScore!)).toBeGreaterThan(1.96);
    });

    it('does not flag noise as significant even with large samples', () => {
        // Same underlying distribution on both sides — should NOT be flagged significant
        const seed = Array.from({ length: 200 }, (_, i) => 1 + ((i * 37) % 10) * 0.01);
        const a = seed.slice(0, 100);
        const b = seed.slice(100);
        const result = compareMeans(a, b);
        expect(result.significant).toBe(false);
    });

    it('handles a zero-mean baseline without dividing by zero', () => {
        const result = compareMeans([0, 0, 0], [1, 1, 1]);
        expect(result.deltaPct).toBeNull();
        expect(() => compareMeans([0, 0, 0], [1, 1, 1])).not.toThrow();
    });
});

describe('compareProportions', () => {
    it('is not significant for small samples regardless of rate difference', () => {
        const result = compareProportions(5, 0, 5, 5); // 0% vs 100% error rate, tiny n
        expect(result.sufficientSample).toBe(false);
        expect(result.significant).toBe(false);
    });

    it('detects a real, well-sampled error-rate difference as significant', () => {
        // 2% error rate vs 20% error rate, both n=200
        const result = compareProportions(200, 4, 200, 40);
        expect(result.sufficientSample).toBe(true);
        expect(result.significant).toBe(true);
        expect(result.a.rate).toBeCloseTo(0.02, 5);
        expect(result.b.rate).toBeCloseTo(0.2, 5);
    });

    it('does not flag a small, well-sampled difference as significant', () => {
        // 5% vs 6% error rate at n=200 — real but small, shouldn't cross 95% threshold
        const result = compareProportions(200, 10, 200, 12);
        expect(result.significant).toBe(false);
    });
});
