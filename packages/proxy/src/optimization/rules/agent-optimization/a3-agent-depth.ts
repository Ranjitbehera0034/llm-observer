import { OptimizationRule, OptimizationResult, RuleContext } from '../../types';

export const a3AgentDepth: OptimizationRule = {
    id: "agent-depth-inefficiency",
    name: "Reduce excessive agent depth",
    category: "agent-optimization",
    minDataDays: 7,
    evaluate(context: RuleContext): OptimizationResult | null {
        const deepSessions = context.sessions.filter(s => (s.deepest_agent_depth || 0) > 5);
        if (deepSessions.length < 3) return null;

        const totalCostOfDeep = deepSessions.reduce((acc, s) => acc + (s.estimated_cost_usd || 0), 0);
        return {
            ruleId: this.id,
            title: "Deep agent hierarchies detected",
            description: `Some sessions reached an agent depth of ${Math.max(...deepSessions.map(s => s.deepest_agent_depth || 0))}. Deep hierarchies often lead to loops and redundancy.`,
            category: this.category,
            impact: "medium",
            estimatedMonthlySavings: totalCostOfDeep * 0.2,
            action: "Monitor sessions that go very deep. They may be stuck or struggling with a task that needs human intervention.",
            dataPoints: {
                deepSessionCount: deepSessions.length
            }
        };
    }
};
