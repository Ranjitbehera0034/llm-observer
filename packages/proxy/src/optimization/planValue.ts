import { PRO_PLAN_MONTHLY_USD } from './planPricing';

export interface PlanValue {
    planCostMonthlyUsd: number;
    estimatedMonthlySavingsUsd: number;
    /** estimatedMonthlySavingsUsd / planCostMonthlyUsd, rounded to 1 decimal. 0 when plan cost is 0. */
    valueMultiple: number;
}

/**
 * "Plan value" answers: for what the subscription costs, how much did the
 * optimizer identify you could save? `estimatedMonthlySavingsUsd` is the sum
 * of each fired rule's `estimatedMonthlySavings` — already a monthly figure,
 * so no normalization by the analyzed window is needed.
 */
export function computePlanValue(estimatedMonthlySavingsUsd: number): PlanValue {
    const planCostMonthlyUsd = PRO_PLAN_MONTHLY_USD;
    const valueMultiple = planCostMonthlyUsd > 0
        ? Math.round((estimatedMonthlySavingsUsd / planCostMonthlyUsd) * 10) / 10
        : 0;

    return {
        planCostMonthlyUsd,
        estimatedMonthlySavingsUsd,
        valueMultiple
    };
}
