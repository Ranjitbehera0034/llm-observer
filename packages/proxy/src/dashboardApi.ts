import { Router } from 'express';
import { getDb } from '@llm-observer/database';

export const dashboardApi = Router();

// /api/stats/overview
dashboardApi.get('/stats/overview', (req, res) => {
    try {
        const db = getDb();
        const projectId = 'default';

        // Total spend today
        const spendStmt = db.prepare(`
            SELECT sum(cost_usd) as total_spend, count(*) as total_requests
            FROM requests 
            WHERE project_id = ? AND date(created_at) = date('now')
        `);
        const todayStats = (spendStmt.get(projectId) as any) || { total_spend: 0, total_requests: 0 };

        // Overall budget (from projects table)
        const projectStmt = db.prepare('SELECT daily_budget FROM projects WHERE id = ?');
        const project = (projectStmt.get(projectId) as any) || { daily_budget: 0 };

        // Total tracked tokens today
        const tokenStmt = db.prepare(`
            SELECT sum(total_tokens) as tokens
            FROM requests
            WHERE project_id = ? AND date(created_at) = date('now')
        `);
        const tokenStats = (tokenStmt.get(projectId) as any) || { tokens: 0 };

        res.json({
            todaySpendUsd: todayStats.total_spend || 0,
            dailyBudgetUsd: project.daily_budget,
            totalRequestsToday: todayStats.total_requests || 0,
            totalTokensToday: tokenStats.tokens || 0
        });
    } catch (err) {
        console.error('API Error:', err);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// /api/stats/chart (last 7 days by day)
dashboardApi.get('/stats/chart', (req, res) => {
    try {
        const db = getDb();
        const projectId = 'default';

        const chartStmt = db.prepare(`
            SELECT 
                date(created_at) as date,
                sum(cost_usd) as cost,
                count(*) as requests
            FROM requests
            WHERE project_id = ? AND created_at >= date('now', '-7 days')
            GROUP BY date(created_at)
            ORDER BY date(created_at) ASC
        `);
        const data = chartStmt.all(projectId);

        res.json({ data });
    } catch (err) {
        console.error('API Error:', err);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// /api/stats/models (breakdown by model)
dashboardApi.get('/stats/models', (req, res) => {
    try {
        const db = getDb();
        const projectId = 'default';

        const modelStmt = db.prepare(`
            SELECT 
                model, 
                sum(cost_usd) as cost,
                sum(total_tokens) as tokens,
                count(*) as requests
            FROM requests
            WHERE project_id = ?
            GROUP BY model
            ORDER BY cost DESC
        `);
        const data = modelStmt.all(projectId);

        res.json({ data });
    } catch (err) {
        console.error('API Error:', err);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});
