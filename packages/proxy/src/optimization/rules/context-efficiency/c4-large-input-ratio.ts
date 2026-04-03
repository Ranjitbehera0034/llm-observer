import { OptimizationRule, OptimizationResult, RuleContext } from '../../types';

export const c4LargeInputRatio: OptimizationRule = {
    id: "large-input-small-output",
    name: "Reduce disproportionate input context",
    category: "context-efficiency",
    minDataDays: 7,
    evaluate(context: RuleContext): OptimizationResult | null {
        const wastefulSessions = context.sessions.filter(s => 
            (s.input_tokens || 0) > (s.output_tokens || 0) * 10 && (s.input_tokens || 0) > 5000
        );

        if (wastefulSessions.length < 5) return null;

        const totalCostOfWasteful = wastefulSessions.reduce((acc, s) => acc + (s.estimated_cost_usd || 0), 0);
        const estimatedMonthlySavings = totalCostOfWasteful * 0.3; // 30% savings by prompt engineering

        return {
            ruleId: this.id,
            title: "Sending too much context for small questions",
            description: `${Math.round((wastefulSessions.length / context.sessions.length) * 100)}% of your sessions send 10x more context than the response needs.`,
            category: this.category,
            impact: "low",
            estimatedMonthlySavings,
            action: "Try smaller, focused prompts or only include relevant snippets instead of entire files.",
            dataPoints: {
                wastefulCount: wastefulSessions.length
            }
        };
    }
};
