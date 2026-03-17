import { getDb } from '@llm-observer/database';

/**
 * FIX BUG-04: Delta aggregation — only process requests since the last aggregation run.
 * Uses a watermark stored in settings to avoid re-scanning all of today's data every 5 minutes.
 */
export const startStatsAggregation = () => {
    // Run every 5 minutes
    setInterval(aggregateStats, 5 * 60 * 1000);
    // Also run immediately on start
    aggregateStats();
};

export const aggregateStats = () => {
    const db = getDb();

    try {
        // FIX BUG-04: Read the last aggregation watermark
        const watermarkRow = db.prepare("SELECT value FROM settings WHERE key = 'stats_last_aggregated_at'").get() as any;
        const lastAggregatedAt = watermarkRow?.value || '1970-01-01T00:00:00.000Z';
        const now = new Date().toISOString();

        // Get all projects that have new requests since last watermark
        const newProjects = db.prepare(`
            SELECT DISTINCT project_id 
            FROM requests 
            WHERE created_at > ?
        `).all(lastAggregatedAt) as { project_id: string }[];

        if (newProjects.length === 0) {
            return; // Nothing new to aggregate
        }

        console.log(`[StatsAggregator] Aggregating delta for ${newProjects.length} project(s)...`);

        const today = new Date().toISOString().split('T')[0];

        for (const { project_id } of newProjects) {
            // Only re-aggregate dates that have new data since last watermark
            const affectedDates = db.prepare(`
                SELECT DISTINCT date(created_at) as agg_date 
                FROM requests 
                WHERE project_id = ? AND created_at > ?
            `).all(project_id, lastAggregatedAt) as { agg_date: string }[];

            for (const { agg_date } of affectedDates) {
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
                `).all(project_id, agg_date) as any[];

                for (const row of stats) {
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
                        project_id, agg_date, row.provider, row.model,
                        row.total_requests, row.total_tokens, row.total_cost_usd,
                        Math.round(row.avg_latency_ms || 0), row.error_count, row.blocked_count
                    );
                }
            }
        }

        // FIX BUG-04: Update watermark so next run only processes new data
        db.prepare(`
            INSERT OR REPLACE INTO settings (key, value, updated_at) 
            VALUES ('stats_last_aggregated_at', ?, CURRENT_TIMESTAMP)
        `).run(now);

        console.log(`[StatsAggregator] Delta aggregation complete. Watermark: ${now}`);
    } catch (err) {
        console.error('[StatsAggregator] Error during stats aggregation:', err);
    }
};
