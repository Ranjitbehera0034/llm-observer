import { OptimizationRule, OptimizationResult, RuleContext } from '../../types';

export const p3PlanUpgrade: OptimizationRule = {
    id: "plan-upgrade-recommendation",
    name: "Upgrade to cost-saving plan",
    category: "provider-optimization",
    minDataDays: 14,
    evaluate(context: RuleContext): OptimizationResult | null {
        const totalSpend = context.dailyCosts.reduce((acc, curr) => acc + curr.cost, 0);
        if (totalSpend > 120) {
            return {
                ruleId: this.id,
                title: "Anthropic API spend exceeds Claude Max cost",
                description: `You spend ~$${totalSpend.toFixed(2)} monthly on API calls. A fixed Claude subscription might be cheaper.`,
                category: this.category,
                impact: "high",
                estimatedMonthlySavings: totalSpend - 100,
                action: "Consider a fixed-rate subscription to cap your monthly spending.",
                dataPoints: {
                    totalSpend
                }
            };
        }
        return null;
    }
};
