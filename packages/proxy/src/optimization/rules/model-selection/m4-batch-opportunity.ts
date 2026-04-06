import { OptimizationRule, OptimizationResult, RuleContext } from '../../types';

export const m4BatchOpportunity: OptimizationRule = {
    id: "batch-api-opportunity",
    name: "Leverage Batch API for repetitive requests",
    category: "model-selection",
    minDataDays: 1,
    evaluate(context: RuleContext): OptimizationResult | null {
        const openaiSessions = context.sessions.filter(s => s.provider?.toLowerCase().includes('openai'));
        if (openaiSessions.length < 20) return null;

        // Group by model and similarity (simple token count bucket for now)
        const groups: Record<string, number> = {};
        openaiSessions.forEach(s => {
            const bucket = Math.round((s.input_tokens || 0) / 100) * 100;
            const key = `${s.model_primary}-${bucket}`;
            groups[key] = (groups[key] || 0) + 1;
        });

        const batchOpportunity = Object.entries(groups).find(([key, count]) => count > 20);
        if (!batchOpportunity) return null;

        const totalCostOfBatchable = openaiSessions.reduce((acc, s) => acc + (s.estimated_cost_usd || 0), 0);
        const estimatedMonthlySavings = totalCostOfBatchable * 0.5; // Batch API is 50% cheaper

        return {
            ruleId: this.id,
            title: "OpenAI Batch API Opportunity",
            description: `You made over 20 similar GPT-4o requests recently. The Batch API would cost 50% less ($${estimatedMonthlySavings.toFixed(2)} savings).`,
            category: this.category,
            impact: "medium",
            estimatedMonthlySavings,
            action: "Consider using the OpenAI Batch API for repetitive tasks to save 50% on costs.",
            dataPoints: {
                batchOpportunity
            }
        };
    }
};
