import { getDb } from '@llm-observer/database';

export const startStatsAggregation = () => {
    // Run every 5 minutes
    setInterval(aggregateStats, 5 * 60 * 1000);
    // Also run immediately on start
    aggregateStats();
};

export const aggregateStats = () => {
    const db = getDb();

    console.log('[StatsAggregator] Running aggregation...');

    try {
        // Find all requests that haven't been aggregated yet for today
        // For simplicity in this local-first tool, we'll just re-aggregate today's data
        const today = new Date().toISOString().split('T')[0];

        // 1. Get all projects
        const projects = db.prepare('SELECT id FROM projects').all() as { id: string }[];

        for (const project of projects) {
            // 2. Aggregate by provider/model for today
            const stats = db.prepare(`
                SELECT 
                    provider, 
                    model, 
                    count(*) as total_requests,
                    sum(total_tokens) as total_tokens,
                    sum(cost_usd) as total_cost_usd,
                    avg(latency_ms) as avg_latency_ms,
                    sum(CASE WHEN status = 'error' THEN 1 ELSE 0 END) as error_count,
                    sum(CASE WHEN status = 'blocked_budget' THEN 1 ELSE 0 END) as blocked_count
                FROM requests
                WHERE project_id = ? AND date(created_at) = ?
                GROUP BY provider, model
            `).all(project.id, today) as any[];

            for (const row of stats) {
                // 3. Upsert into daily_stats
                db.prepare(`
                    INSERT INTO daily_stats (
                        project_id, date, provider, model, 
                        total_requests, total_tokens, total_cost_usd, 
                        avg_latency_ms, error_count, blocked_count
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(project_id, date, provider, model) DO UPDATE SET
                        total_requests = excluded.total_requests,
                        total_tokens = excluded.total_tokens,
                        total_cost_usd = excluded.total_cost_usd,
                        avg_latency_ms = excluded.avg_latency_ms,
                        error_count = excluded.error_count,
                        blocked_count = excluded.blocked_count
                `).run(
                    project.id, today, row.provider, row.model,
                    row.total_requests, row.total_tokens, row.total_cost_usd,
                    Math.round(row.avg_latency_ms || 0), row.error_count, row.blocked_count
                );
            }
        }

        console.log(`[StatsAggregator] Aggregation complete for ${today}`);
    } catch (err) {
        console.error('[StatsAggregator] Error during stats aggregation:', err);
    }
};
