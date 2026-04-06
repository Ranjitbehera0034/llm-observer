import { OptimizationRule, OptimizationResult, RuleContext } from '../../types';

export const c3RedundantReads: OptimizationRule = {
    id: "redundant-file-reads",
    name: "Eliminate redundant file reads",
    category: "context-efficiency",
    minDataDays: 3,
    evaluate(context: RuleContext): OptimizationResult | null {
        // Redundant patterns from toolUsage summary (simplified)
        const redundantTools = context.toolUsage.filter(t => 
            t.tool_name?.toLowerCase().includes('read') && t.total_calls > 10
        );

        if (redundantTools.length === 0) return null;

        const totalWaste = redundantTools.reduce((acc, t) => acc + (t.total_cost || 0) * 0.5, 0); // 50% waste estimate

        return {
            ruleId: this.id,
            title: "Redundant file reads detected",
            description: `${redundantTools.length} tools are reading common files excessively (e.g. package.json seen ${redundantTools[0].total_calls} times).`,
            category: this.category,
            impact: "medium",
            estimatedMonthlySavings: totalWaste,
            action: "Add frequently read file contents to your CLAUDE.md or system prompt context to avoid constant re-reading.",
            dataPoints: {
                redundantTools
            }
        };
    }
};
