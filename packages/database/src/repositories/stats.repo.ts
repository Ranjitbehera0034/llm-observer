import { getDb } from '../db';

export const getStatsByProvider = (projectId: string = 'default', days: number = 30) => {
    const db = getDb();
    const stmt = db.prepare(`
        SELECT 
            provider, 
            sum(cost_usd) as cost,
            sum(total_tokens) as tokens,
            count(*) as requests
        FROM requests
        WHERE project_id = ? AND created_at >= date('now', '-' || ? || ' days')
        GROUP BY provider
        ORDER BY cost DESC
    `);
    return stmt.all(projectId, days);
};

export const getCostOptimizationSuggestions = (projectId: string = 'default') => {
    const db = getDb();
    const suggestions = [];

    // Rule 1: Expensive models with small payloads
    const smallPayloadsStmt = db.prepare(`
        SELECT 
            model,
            COUNT(*) as request_count,
            SUM(cost_usd) as total_spend,
            AVG(total_tokens) as avg_tokens
        FROM requests 
        WHERE project_id = ? 
            AND model IN ('gpt-4o', 'claude-3-5-sonnet-20241022', 'claude-3-5-sonnet-latest', 'claude-3-opus-20240229') 
            AND total_tokens < 1500
        GROUP BY model
        HAVING request_count > 5
    `);

    const smallPayloads = smallPayloadsStmt.all(projectId) as any[];

    for (const row of smallPayloads) {
        let alternative = '';
        let estimatedSavingsPercent = 0;

        if (row.model.includes('gpt-4o') && !row.model.includes('mini')) {
            alternative = 'gpt-4o-mini';
            estimatedSavingsPercent = 0.85;
        } else if (row.model.includes('sonnet') || row.model.includes('opus')) {
            alternative = 'claude-3-5-haiku-20241022';
            estimatedSavingsPercent = 0.75;
        }

        if (alternative) {
            const potentialSavings = row.total_spend * estimatedSavingsPercent;
            suggestions.push({
                type: 'model_downgrade',
                title: 'High-Performance Model Overkill',
                description: `You've sent ${row.request_count} requests to ${row.model} with a tiny token average (${Math.round(row.avg_tokens)}). Switching these to ${alternative} would have saved you $${potentialSavings.toFixed(2)} based on your recent activity.`,
                savings_usd: potentialSavings,
                model_impacted: row.model,
                suggested_model: alternative
            });
        }
    }

    // Rule 2: Long, Repetitive Prompts (Ideal for Anthropic/OpenAI Caching)
    const complexPromptsStmt = db.prepare(`
        SELECT 
            model,
            COUNT(*) as occurrences,
            SUM(cost_usd) as total_spend,
            AVG(prompt_tokens) as avg_prompt_tokens
        FROM requests
        WHERE project_id = ? AND prompt_tokens > 2000
        GROUP BY prompt_hash, model
        HAVING occurrences > 3
        ORDER BY total_spend DESC
        LIMIT 3
    `);

    const repetitiveComplex = complexPromptsStmt.all(projectId) as any[];
    for (const row of repetitiveComplex) {
        const potentialSavings = row.total_spend * 0.4; // 40-50% savings with caching
        suggestions.push({
            type: 'prompt_caching',
            title: 'Prompt Caching Opportunity',
            description: `We've detected heavy reuse of long prompts (> ${Math.round(row.avg_prompt_tokens)} tokens) on ${row.model}. Implementing Prompt Caching (Beta) could reduce your bill by ~$${potentialSavings.toFixed(2)} for this pattern.`,
            savings_usd: potentialSavings
        });
    }

    return suggestions.sort((a, b) => b.savings_usd - a.savings_usd);
};

export const getPromptCacheSuggestions = (projectId: string = 'default') => {
    const db = getDb();

    const stmt = db.prepare(`
        SELECT
            prompt_hash,
            COUNT(*) as occurrences,
            SUM(cost_usd) as total_wasted_cost,
            AVG(latency_ms) as avg_latency
        FROM requests
        WHERE project_id = ? AND prompt_hash IS NOT NULL
        GROUP BY prompt_hash
        HAVING occurrences > 5
        ORDER BY total_wasted_cost DESC
        LIMIT 10
    `);

    const duplications = stmt.all(projectId) as any[];
    return duplications.map(d => ({
        type: 'prompt_duplication',
        title: 'High Volume of Identical Prompts Detected',
        description: `An identical prompt (Hash: ${d.prompt_hash?.substring(0, 8)}...) was sent ${d.occurrences} times recently, costing $${d.total_wasted_cost.toFixed(2)}. Consider caching this response to eliminate these API calls and save an average of ${Math.round(d.avg_latency)}ms per request.`,
        savings_usd: d.total_wasted_cost,
        hash: d.prompt_hash,
        occurrences: d.occurrences
    }));
};
