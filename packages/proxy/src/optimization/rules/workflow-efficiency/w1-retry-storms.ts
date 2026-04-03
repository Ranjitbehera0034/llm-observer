import { OptimizationRule, OptimizationResult, RuleContext } from '../../types';

export const w1RetryStorms: OptimizationRule = {
    id: "workflow-retry-storms",
    name: "Avoid repetitive retry storms",
    category: "workflow-efficiency",
    minDataDays: 3,
    evaluate(context: RuleContext): OptimizationResult | null {
        const retrySessions = context.sessions.filter(s => (s.message_count || 0) > 10 && (s.input_tokens || 0) > 5000);
        if (retrySessions.length < 3) return null;

        const totalRetryCost = retrySessions.reduce((acc, s) => acc + (s.estimated_cost_usd || 0), 0);
        return {
            ruleId: this.id,
            title: "Potential retry storms detected",
            description: `We've detected ${retrySessions.length} sessions where prompts seem to be repeated with little progress.`,
            category: this.category,
            impact: "medium",
            estimatedMonthlySavings: totalRetryCost * 0.15,
            action: "If the model isn't getting it right after 3 tries, stop and rephrase instead of repeating.",
            dataPoints: {
                retrySessions: retrySessions.length
            }
        };
    }
};
