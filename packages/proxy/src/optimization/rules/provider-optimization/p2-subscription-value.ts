import { OptimizationRule, OptimizationResult, RuleContext } from '../../types';

export const p2SubscriptionValue: OptimizationRule = {
    id: "subscription-value-assessment",
    name: "Subscription cost justification",
    category: "provider-optimization",
    minDataDays: 30,
    evaluate(context: RuleContext): OptimizationResult | null {
        if (context.subscriptions.length === 0) return null;

        const cursorSub = context.subscriptions.find(s => s.service_name?.toLowerCase().includes('cursor'));
        if (!cursorSub) return null;

        // Estimate equivalent cost (simplified)
        const equivalentCost = context.sessions.filter(s => s.provider === 'cursor').reduce((acc, s) => acc + (s.estimated_cost_usd || 0), 0);

        if (cursorSub.monthly_cost_usd > equivalentCost * 2) {
            return {
                ruleId: this.id,
                title: "Cursor Pro subscription value is low",
                description: `You pay $${cursorSub.monthly_cost_usd}/month but your usage would only cost $${equivalentCost.toFixed(2)} on the API.`,
                category: this.category,
                impact: "medium",
                estimatedMonthlySavings: cursorSub.monthly_cost_usd - equivalentCost,
                action: "Consider switching to the Cursor free tier and using your own API key to save money.",
                dataPoints: {
                    monthlySub: cursorSub.monthly_cost_usd,
                    equivalentCost
                }
            };
        }
        return null;
    }
};
