import { OptimizationRule, OptimizationResult, RuleContext } from '../../types';

export const a1ExpensiveExplore: OptimizationRule = {
    id: "agent-expensive-explore",
    name: "Reduce expensive agent exploration",
    category: "agent-optimization",
    minDataDays: 7,
    evaluate(context: RuleContext): OptimizationResult | null {
        const exploreAgents = context.subagents.filter(s => s.agent_type === 'explore');
        const totalAgentCost = context.subagents.reduce((acc, s) => acc + (s.estimated_cost_usd || 0), 0);
        const exploreCost = exploreAgents.reduce((acc, s) => acc + (s.estimated_cost_usd || 0), 0);

        if (totalAgentCost === 0 || (exploreCost / totalAgentCost) < 0.4) return null;

        return {
            ruleId: this.id,
            title: "High cost for 'Explore' subagents",
            description: `'Explore' subagents cost $${exploreCost.toFixed(2)}, representing ${Math.round(exploreCost / totalAgentCost * 100)}% of your agent budget.`,
            category: this.category,
            impact: "medium",
            estimatedMonthlySavings: exploreCost * 0.3,
            action: "Be more specific in your initial prompts. Tell Claude exactly which files to read to minimize exploration time.",
            dataPoints: {
                exploreCost,
                totalAgentCost
            }
        };
    }
};
