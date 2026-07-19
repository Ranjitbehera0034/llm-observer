import { computePlanValue } from '../planValue';
import { PRO_PLAN_MONTHLY_USD } from '../planPricing';

describe('computePlanValue', () => {
    it('computes a real multiple: savings identified ÷ plan cost', () => {
        const result = computePlanValue(PRO_PLAN_MONTHLY_USD * 3);
        expect(result.planCostMonthlyUsd).toBe(PRO_PLAN_MONTHLY_USD);
        expect(result.estimatedMonthlySavingsUsd).toBe(PRO_PLAN_MONTHLY_USD * 3);
        expect(result.valueMultiple).toBe(3);
    });

    it('rounds to one decimal place', () => {
        const result = computePlanValue(PRO_PLAN_MONTHLY_USD * 1.234);
        expect(result.valueMultiple).toBeCloseTo(1.2, 5);
    });

    it('returns a zero multiple when there are no identified savings', () => {
        expect(computePlanValue(0).valueMultiple).toBe(0);
    });

    it('never fabricates a number: is a pure function of its input, not a placeholder constant', () => {
        expect(computePlanValue(10).valueMultiple).not.toBe(computePlanValue(20).valueMultiple);
    });
});
