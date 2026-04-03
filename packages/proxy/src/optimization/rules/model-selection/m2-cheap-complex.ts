import { OptimizationRule, OptimizationResult, RuleContext } from '../../types';

export const m2CheapComplex: OptimizationRule = {
    id: "cheap-model-complex-tasks",
    name: "Use smarter models for complex tasks",
    category: "model-selection",
    minDataDays: 7,
    evaluate(context: RuleContext): OptimizationResult | null {
        const cheapModels = ['haiku', 'gpt-4o-mini', 'gpt-3.5'];
        const complexSessions = context.sessions.filter(s => 
            cheapModels.some(m => s.model_primary?.toLowerCase().includes(m)) &&
            (s.message_count || 0) > 5
        );

        const totalCheapSessions = context.sessions.filter(s => 
            cheapModels.some(m => s.model_primary?.toLowerCase().includes(m))
        ).length;

        if (totalCheapSessions === 0 || (complexSessions.length / totalCheapSessions) < 0.2) {
            return null;
        }

        return {
            ruleId: this.id,
            title: "Consider smarter models for complex tasks",
            description: `${Math.round((complexSessions.length / totalCheapSessions) * 100)}% of your cheap model sessions have >5 turns, suggesting possible retries.`,
            category: this.category,
            impact: "medium",
            estimatedMonthlySavings: 0, // Quality improvement, not direct savings
            action: "Consider using Sonnet/GPT-4o for complex tasks to reduce retries and save time.",
            dataPoints: {
                affectedSessions: complexSessions.length,
                totalCheapSessions
            }
        };
    }
};
