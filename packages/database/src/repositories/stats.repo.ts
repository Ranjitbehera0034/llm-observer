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
            AND model IN ('gpt-4o', 'claude-3-5-sonnet-20241022', 'claude-3-opus-20240229') 
            AND total_tokens < 1000
        GROUP BY model
        HAVING request_count > 10
    `);

    const smallPayloads = smallPayloadsStmt.all(projectId) as any[];

    for (const row of smallPayloads) {
        let alternative = '';
        let estimatedSavingsPercent = 0;

        if (row.model === 'gpt-4o') {
            alternative = 'gpt-4o-mini';
            estimatedSavingsPercent = 0.85; // Mini is significantly cheaper
        } else if (row.model.startsWith('claude')) {
            alternative = 'claude-3-5-haiku-20241022';
            estimatedSavingsPercent = 0.70;
        }

        if (alternative) {
            const potentialSavings = row.total_spend * estimatedSavingsPercent;
            suggestions.push({
                type: 'model_downgrade',
                title: 'Consider a lighter model for small tasks',
                description: `You routed ${row.request_count} requests to ${row.model} averaging only ${Math.round(row.avg_tokens)} tokens. Switching to ${alternative} could save roughly $${potentialSavings.toFixed(2)} based on your recent volume.`,
                savings_usd: potentialSavings,
                model_impacted: row.model,
                suggested_model: alternative
            });
        }
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
