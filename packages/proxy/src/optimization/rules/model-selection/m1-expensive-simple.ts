import { OptimizationRule, OptimizationResult, RuleContext } from '../../types';

export const m1ExpensiveSimple: OptimizationRule = {
    id: "model-downgrade-simple-tasks",
    name: "Use cheaper models for simple tasks",
    category: "model-selection",
    minDataDays: 7,
    evaluate(context: RuleContext): OptimizationResult | null {
        const expensiveModels = ['opus', 'gpt-4o', 'sonnet-20241022', 'sonnet-latest'];
        const expensiveSessions = context.sessions.filter(s => 
            expensiveModels.some(m => s.model_primary?.toLowerCase().includes(m)) &&
            (s.output_tokens || 0) < 500
        );

        const totalSessions = context.sessions.filter(s => 
            expensiveModels.some(m => s.model_primary?.toLowerCase().includes(m))
        ).length;

        if (totalSessions === 0 || (expensiveSessions.length / totalSessions) < 0.3) {
            return null;
        }

        const totalCostOfSimpleOpus = expensiveSessions.reduce((acc, s) => acc + (s.estimated_cost_usd || 0), 0);
        // Assuming 75% savings by switching to Haiku/Mini
        const estimatedMonthlySavings = totalCostOfSimpleOpus * 0.75;

        return {
            ruleId: this.id,
            title: "Switch to cheaper models for autocomplete",
            description: `${Math.round((expensiveSessions.length / totalSessions) * 100)}% of your expensive model requests ($${totalCostOfSimpleOpus.toFixed(2)}) had <500 output tokens, suggesting simple tasks.`,
            category: this.category,
            impact: "high",
            estimatedMonthlySavings,
            action: "Switch to Sonnet/Haiku or GPT-4o-mini for autocomplete in your IDE settings",
            configSnippet: "Model settings for Continue/Cursor: claude-3-5-haiku-20241022 or gpt-4o-mini",
            dataPoints: {
                affectedSessions: expensiveSessions.length,
                totalExpensiveSessions: totalSessions
            }
        };
    }
};
