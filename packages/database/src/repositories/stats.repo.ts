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
