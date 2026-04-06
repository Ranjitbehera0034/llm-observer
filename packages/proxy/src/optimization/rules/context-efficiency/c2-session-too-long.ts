import { OptimizationRule, OptimizationResult, RuleContext } from '../../types';

export const c2SessionTooLong: OptimizationRule = {
    id: "session-context-bloat",
    name: "Avoid session context bloat",
    category: "context-efficiency",
    minDataDays: 7,
    evaluate(context: RuleContext): OptimizationResult | null {
        const longSessions = context.sessions.filter(s => (s.message_count || 0) > 30);
        if (longSessions.length === 0) return null;

        // Check cost acceleration (simplified for static analysis)
        const expensiveLongSessions = longSessions.filter(s => (s.estimated_cost_usd || 0) > 2.0);
        if (expensiveLongSessions.length < 3) return null;

        const totalCostOfLongSessions = expensiveLongSessions.reduce((acc, s) => acc + (s.estimated_cost_usd || 0), 0);
        const estimatedMonthlySavings = totalCostOfLongSessions * 0.2; // 20% savings by splitting sessions

        return {
            ruleId: this.id,
            title: "Long sessions are becoming expensive",
            description: `Sessions with >30 turns cost significantly more per turn as the context window fills up. You had ${expensiveLongSessions.length} sessions costing >$2 each.`,
            category: this.category,
            impact: "medium",
            estimatedMonthlySavings,
            action: "Start new sessions every 20-25 turns to keep context small and costs low.",
            dataPoints: {
                longSessionCount: expensiveLongSessions.length,
                avgCost: totalCostOfLongSessions / expensiveLongSessions.length
            }
        };
    }
};
