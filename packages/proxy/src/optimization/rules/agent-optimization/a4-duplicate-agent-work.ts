import { OptimizationRule, OptimizationResult, RuleContext } from '../../types';

export const a4DuplicateAgentWork: OptimizationRule = {
    id: "agent-duplicate-work",
    name: "Eliminate duplicate agent work",
    category: "agent-optimization",
    minDataDays: 3,
    evaluate(context: RuleContext): OptimizationResult | null {
        // Simplified detection of duplicate work across agents in same session
        const sessionsWithAgents = context.sessions.filter(s => (s.subagent_count || 0) > 2);
        if (sessionsWithAgents.length === 0) return null;

        return {
            ruleId: this.id,
            title: "Potential duplicate work between agents",
            description: "Multiple agents in the same session may be reading the same files or repeating operations.",
            category: this.category,
            impact: "medium",
            estimatedMonthlySavings: 5,
            action: "Check the Agent Tree in Session Details to identify redundant subagents and streamline your prompts.",
            dataPoints: {
                affectedSessions: sessionsWithAgents.length
            }
        };
    }
};
