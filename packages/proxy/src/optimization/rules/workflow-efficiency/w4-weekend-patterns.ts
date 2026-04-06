import { OptimizationRule, OptimizationResult, RuleContext } from '../../types';

export const w4WeekendPatterns: OptimizationRule = {
    id: "workflow-weekend-inefficiency",
    name: "Monitor weekend ROI",
    category: "workflow-efficiency",
    minDataDays: 14,
    evaluate(context: RuleContext): OptimizationResult | null {
        // This rule ideally uses roiData, but we'll use a simplified version for now
        const weekendSessions = context.sessions.filter(s => {
            const day = new Date(s.started_at).getDay();
            return day === 0 || day === 6; // Sunday or Saturday
        });

        if (weekendSessions.length < 5) return null;

        const weekendCost = weekendSessions.reduce((acc, s) => acc + (s.estimated_cost_usd || 0), 0);
        return {
            ruleId: this.id,
            title: "Weekend vs Weekday analysis",
            description: `You spent $${weekendCost.toFixed(2)} on weekends recently. Weekend AI work can sometimes be less focused, leading to higher costs per output.`,
            category: this.category,
            impact: "low",
            estimatedMonthlySavings: 0,
            action: "Check your ROI dashboard (ROI page) to see if weekend work is significantly less efficient than weekday work.",
            dataPoints: {
                weekendCost
            }
        };
    }
};
