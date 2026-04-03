import { OptimizationRule, OptimizationResult, RuleContext } from '../../types';

export const w3ProjectSprawl: OptimizationRule = {
    id: "workflow-project-sprawl",
    name: "Reduce project context switching",
    category: "workflow-efficiency",
    minDataDays: 3,
    evaluate(context: RuleContext): OptimizationResult | null {
        const days = [...new Set(context.sessions.map(s => s.started_at.split('T')[0]))];
        const daysWithSprawl = days.filter(d => {
            const daySessions = context.sessions.filter(s => s.started_at.startsWith(d));
            const projects = new Set(daySessions.map(s => s.project_name).filter(Boolean));
            return projects.size > 5;
        });

        if (daysWithSprawl.length === 0) return null;

        return {
            ruleId: this.id,
            title: "High project context switching",
            description: `You context-switched across >5 projects on ${daysWithSprawl.length} different days. Focused deep work is usually more cost-effective.`,
            category: this.category,
            impact: "low",
            estimatedMonthlySavings: 0,
            action: "Try to group tasks by project to minimize the overhead of re-contextualizing the AI.",
            dataPoints: {
                sprawlDays: daysWithSprawl.length
            }
        };
    }
};
