import { OptimizationRule, OptimizationResult, RuleContext } from '../../types';

export const c1LowCacheRate: OptimizationRule = {
    id: "low-cache-hit-rate",
    name: "Improve prompt cache hit rate",
    category: "context-efficiency",
    minDataDays: 7,
    evaluate(context: RuleContext): OptimizationResult | null {
        const anthropicSessions = context.sessions.filter(s => 
            s.provider?.toLowerCase().includes('claude') || s.model_primary?.toLowerCase().includes('claude')
        );

        if (anthropicSessions.length < 10) return null;

        const totalInputTokens = anthropicSessions.reduce((acc, s) => acc + (s.input_tokens || 0), 0);
        const totalCacheRead = anthropicSessions.reduce((acc, s) => acc + (s.cache_read_tokens || 0), 0);
        const cacheHitRate = totalInputTokens > 0 ? totalCacheRead / totalInputTokens : 0;

        if (cacheHitRate > 0.3) return null;

        // Savings: assuming hitting 50% cache rate instead of current
        const costOfInput = anthropicSessions.reduce((acc, s) => acc + (s.estimated_cost_usd || 0) * 0.7, 0); // approx input cost share
        const estimatedMonthlySavings = costOfInput * (0.5 - cacheHitRate);

        if (estimatedMonthlySavings <= 0) return null;

        return {
            ruleId: this.id,
            title: "Improve your Anthropic cache hit rate",
            description: `Your cache hit rate is only ${Math.round(cacheHitRate * 100)}%. Consistent system prompts and focused sessions could improve this to 50%+.`,
            category: this.category,
            impact: "high",
            estimatedMonthlySavings,
            action: "Ensure your system prompts are identical across sessions and keep sessions focused on specific files to maximize caching.",
            dataPoints: {
                cacheHitRate,
                totalInputTokens
            }
        };
    }
};
