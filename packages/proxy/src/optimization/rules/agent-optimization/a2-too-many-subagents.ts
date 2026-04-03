import { OptimizationRule, OptimizationResult, RuleContext } from '../../types';

export const a2TooManySubagents: OptimizationRule = {
    id: "agent-sprawl-in-sessions",
    name: "Avoid agent sprawl",
    category: "agent-optimization",
    minDataDays: 7,
    evaluate(context: RuleContext): OptimizationResult | null {
        const sprawlSessions = context.sessions.filter(s => (s.subagent_count || 0) > 8);
        if (sprawlSessions.length < 3) return null;

        const totalCostOfSprawl = sprawlSessions.reduce((acc, s) => acc + (s.estimated_cost_usd || 0), 0);

        return {
            ruleId: this.id,
            title: "Session agent sprawl detected",
            description: `You have ${sprawlSessions.length} sessions spawning >8 subagents each. This complexity adds up quickly.`,
            category: this.category,
            impact: "medium",
            estimatedMonthlySavings: totalCostOfSprawl * 0.25,
            action: "Try breaking your tasks into smaller, more focused requests to keep agent hierarchies manageable.",
            dataPoints: {
                sprawlSessions: sprawlSessions.length
            }
        };
    }
};
