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

        // Only sessions that carry real usage count. A tool with no usage data
        // (or placeholder rows with zero tokens and cost) must never read as
        // "your usage would cost $0 on the API".
        const cursorSessions = context.sessions.filter(s =>
            s.provider === 'cursor' &&
            ((s.estimated_cost_usd || 0) > 0 || (s.input_tokens || 0) > 0 || (s.output_tokens || 0) > 0)
        );
        if (cursorSessions.length === 0) return null;

        // API-equivalent cost of the usage seen, normalised to a month.
        const windowCost = cursorSessions.reduce((acc, s) => acc + (s.estimated_cost_usd || 0), 0);
        if (windowCost <= 0 || context.dataDays <= 0) return null;
        const equivalentCost = windowCost / context.dataDays * 30;

        if (cursorSub.monthly_cost_usd > equivalentCost * 2) {
            return {
                ruleId: this.id,
                title: "Cursor Pro subscription value is low",
                description: `You pay $${cursorSub.monthly_cost_usd}/month but your recorded usage would cost about $${equivalentCost.toFixed(2)}/month on the API.`,
                category: this.category,
                impact: "medium",
                estimatedMonthlySavings: cursorSub.monthly_cost_usd - equivalentCost,
                basis: "measured",
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
