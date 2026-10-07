import { OptimizationRule, OptimizationResult, RuleContext } from '../../types';

// List price of the Claude Max 5x plan.
const CLAUDE_MAX_MONTHLY_USD = 100;

export const p3PlanUpgrade: OptimizationRule = {
    id: "plan-upgrade-recommendation",
    name: "Upgrade to cost-saving plan",
    category: "provider-optimization",
    minDataDays: 14,
    // Works from request spend, not sessions.
    minSessions: 0,
    evaluate(context: RuleContext): OptimizationResult | null {
        if (context.dataDays <= 0) return null;

        // Anthropic spend over the days actually observed, scaled to a month.
        const monthlySpend = context.anthropicSpendUsd / context.dataDays * 30;
        if (monthlySpend > CLAUDE_MAX_MONTHLY_USD * 1.2) {
            return {
                ruleId: this.id,
                title: "Anthropic API spend exceeds Claude Max cost",
                description: `You spend ~$${monthlySpend.toFixed(2)} monthly on Anthropic API calls. A fixed Claude subscription (Max is $${CLAUDE_MAX_MONTHLY_USD}/month) might be cheaper.`,
                category: this.category,
                impact: "high",
                estimatedMonthlySavings: monthlySpend - CLAUDE_MAX_MONTHLY_USD,
                basis: "measured",
                action: "Consider a fixed-rate subscription to cap your monthly spending.",
                dataPoints: {
                    totalSpend: monthlySpend
                }
            };
        }
        return null;
    }
};
