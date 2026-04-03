import { OptimizationRule, OptimizationResult, RuleContext } from '../../types';

export const c5UnusedContext: OptimizationRule = {
    id: "unused-context-window",
    name: "Swap models with smaller context windows",
    category: "context-efficiency",
    minDataDays: 14,
    evaluate(context: RuleContext): OptimizationResult | null {
        // Threshold: sessions with very low context usage vs model limit (simplified)
        const smallContextSessions = context.sessions.filter(s => (s.input_tokens || 0) < 4000);
        if (smallContextSessions.length / context.sessions.length < 0.6) return null;

        return {
            ruleId: this.id,
            title: "Most of your sessions use < 4K tokens",
            description: "You are consistently using a fraction of the 128K/200K window. Smaller models are faster and cheaper for these tasks.",
            category: this.category,
            impact: "low",
            estimatedMonthlySavings: 5,
            action: "For simple questions and code edits, switch to cheaper models like Haiku or GPT-4o-mini.",
            dataPoints: {
                smallContextPct: Math.round((smallContextSessions.length / context.sessions.length) * 100)
            }
        };
    }
};
