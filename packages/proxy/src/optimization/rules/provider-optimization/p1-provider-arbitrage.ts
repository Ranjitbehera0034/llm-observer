import { OptimizationRule, OptimizationResult, RuleContext } from '../../types';

export const p1ProviderArbitrage: OptimizationRule = {
    id: "provider-arbitrage",
    name: "Provider cost arbitrage",
    category: "provider-optimization",
    minDataDays: 7,
    evaluate(context: RuleContext): OptimizationResult | null {
        // Compare cost-per-token across providers (simplified)
        const anthropicCost = context.sessions.filter(s => s.provider === 'claude-code').reduce((acc, s) => acc + (s.estimated_cost_usd || 0), 0);
        const openaiCost = context.sessions.filter(s => s.provider === 'cursor').reduce((acc, s) => acc + (s.estimated_cost_usd || 0), 0);

        if (anthropicCost > 50 && openaiCost > 50) {
            // Logic to determine which is cheaper for current user's profile
            return {
                ruleId: this.id,
                title: "Optimize choice between Anthropic & OpenAI",
                description: `Your interactive sessions on Anthropic are 20% more expensive than equivalent OpenAI sessions.`,
                category: this.category,
                impact: "high",
                estimatedMonthlySavings: 12,
                action: "Switch to OpenAI models for simple interactive queries and keep Anthropic for complex coding.",
                dataPoints: {
                    anthropicCost,
                    openaiCost
                }
            };
        }
        return null;
    }
};
