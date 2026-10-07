import { OptimizationRule, OptimizationResult, RuleContext } from '../../types';

// Assumed saving from running an Opus session on Sonnet instead. A conservative
// figure: the real gap depends on which Opus/Sonnet versions are in use.
const OPUS_TO_SONNET_SAVING = 0.4;

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
            const opusSessions = sessions.filter(s => s.model_primary?.toLowerCase().includes('opus'));
            return {
                name: p,
                opusPct: opusSessions.length / sessions.length,
                totalSessions: sessions.length,
                opusCost: opusSessions.reduce((acc, s) => acc + (s.estimated_cost_usd || 0), 0)
            };
        });

        const outlier = projectStats.find(p => {
            const others = projectStats.filter(o => o !== p);
            const othersAvg = others.reduce((acc, o) => acc + o.opusPct, 0) / others.length;
            return p.opusPct > 0.8 && p.opusPct > othersAvg * 2;
        });

        if (!outlier) return null;

        const others = projectStats.filter(p => p !== outlier);
        const avgOpusPct = others.reduce((acc, p) => acc + p.opusPct, 0) / others.length;

        // Only the Opus spend above the other projects' typical share is at stake.
        const excessOpusCost = outlier.opusCost * (1 - avgOpusPct / outlier.opusPct);
        const estimatedMonthlySavings = excessOpusCost * OPUS_TO_SONNET_SAVING;

        return {
            ruleId: this.id,
            title: `Model mismatch in project ${outlier.name}`,
            description: `Project '${outlier.name}' uses Opus for ${Math.round(outlier.opusPct * 100)}% of sessions, while other projects average ${Math.round(avgOpusPct * 100)}%.`,
            category: this.category,
            impact: "medium",
            estimatedMonthlySavings,
            basis: "heuristic",
            action: `Review model settings for ${outlier.name} and consider testing Sonnet to match your other projects.`,
            dataPoints: {
                outlier,
                avgOpusPct
            }
        };
    }
};
