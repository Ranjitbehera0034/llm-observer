import { OptimizationRule, OptimizationResult, RuleContext } from '../../types';

export const m3ProjectMismatch: OptimizationRule = {
    id: "project-model-mismatch",
    name: "Standardize model selection across projects",
    category: "model-selection",
    minDataDays: 14,
    evaluate(context: RuleContext): OptimizationResult | null {
        const projects = [...new Set(context.sessions.map(s => s.project_name).filter(Boolean))];
        if (projects.length < 2) return null;

        const projectStats = projects.map(p => {
            const sessions = context.sessions.filter(s => s.project_name === p);
            const opusSessions = sessions.filter(s => s.model_primary?.toLowerCase().includes('opus')).length;
            return {
                name: p,
                opusPct: opusSessions / sessions.length,
                totalSessions: sessions.length
            };
        });

        const avgOpusPct = projectStats.reduce((acc, p) => acc + p.opusPct, 0) / projectStats.length;
        const outlier = projectStats.find(p => p.opusPct > 0.8 && p.opusPct > avgOpusPct * 2);

        if (!outlier) return null;

        return {
            ruleId: this.id,
            title: `Model mismatch in project ${outlier.name}`,
            description: `Project '${outlier.name}' uses Opus for ${Math.round(outlier.opusPct * 100)}% of sessions, while other projects average ${Math.round(avgOpusPct * 100)}%.`,
            category: this.category,
            impact: "medium",
            estimatedMonthlySavings: 15, // Arbitrary estimate
            action: `Review model settings for ${outlier.name} and consider testing Sonnet to match your other projects.`,
            dataPoints: {
                outlier,
                avgOpusPct
            }
        };
    }
};
