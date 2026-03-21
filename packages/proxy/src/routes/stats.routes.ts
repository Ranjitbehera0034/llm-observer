import { Router } from 'express';
import { getDb, getCostOptimizationSuggestions, getPromptCacheSuggestions } from '@llm-observer/database';

export const statsRouter = Router();

// /api/stats/overview
statsRouter.get('/overview', (req, res) => {
    try {
        const db = getDb();
        const projectId = (req.query.projectId as string) || 'default';

        const statsStmt = db.prepare(`
            SELECT 
                COALESCE(sum(cost_usd), 0) as total_spend,
                count(*) as total_requests,
                COALESCE(avg(latency_ms), 0) as avg_latency,
                COALESCE(sum(case when status_code >= 400 then 1 else 0 end), 0) as error_count
            FROM requests 
            WHERE project_id = ? AND date(created_at, 'localtime') = date('now', 'localtime')
        `);
        const stats = (statsStmt.get(projectId) as any) || { total_spend: 0, total_requests: 0, avg_latency: 0, error_count: 0 };

        const projectStmt = db.prepare('SELECT daily_budget FROM projects WHERE id = ?');
        const project = (projectStmt.get(projectId) as any) || { daily_budget: 0 };

        const tokenStmt = db.prepare(`
            SELECT COALESCE(sum(total_tokens), 0) as tokens
            FROM requests
            WHERE project_id = ? AND date(created_at, 'localtime') = date('now', 'localtime')
        `);
        const tokenStats = (tokenStmt.get(projectId) as any) || { tokens: 0 };

        res.json({
            todaySpendUsd: stats.total_spend || 0,
            dailyBudgetUsd: project.daily_budget,
            totalRequestsToday: stats.total_requests || 0,
            avgLatencyMs: Math.round(stats.avg_latency || 0),
            errorRate: stats.total_requests > 0 ? (stats.error_count / stats.total_requests) * 100 : 0,
            totalTokensToday: tokenStats.tokens || 0
        });
    } catch (err) {
        console.error('API Error:', err);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// /api/stats/chart
statsRouter.get('/chart', (req, res) => {
    try {
        const db = getDb();
        const projectId = (req.query.projectId as string) || 'default';
        const days = Math.min(90, Math.max(1, parseInt(req.query.days as string) || 7));

        const chartStmt = db.prepare(`
            SELECT 
                date(created_at, 'localtime') as date,
                COALESCE(sum(cost_usd), 0) as cost,
                count(*) as requests
            FROM requests
            WHERE project_id = ? AND date(created_at, 'localtime') >= date('now', 'localtime', '-' || ? || ' days')
            GROUP BY date(created_at, 'localtime')
            ORDER BY date(created_at, 'localtime') ASC
        `);
        const data = chartStmt.all(projectId, days);

        res.json({ data });
    } catch (err) {
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// /api/stats/models
statsRouter.get('/models', (req, res) => {
    try {
        const db = getDb();
        const projectId = (req.query.projectId as string) || 'default';

        const modelStmt = db.prepare(`
            SELECT 
                model,
                COALESCE(sum(cost_usd), 0) as cost,
                COALESCE(sum(total_tokens), 0) as tokens,
                count(*) as requests
            FROM requests
            WHERE project_id = ?
            GROUP BY model
            ORDER BY cost DESC
        `);
        const data = modelStmt.all(projectId);

        res.json({ data });
    } catch (err) {
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// /api/stats/provider
statsRouter.get('/provider', (req, res) => {
    try {
        const db = getDb();
        const projectId = (req.query.projectId as string) || 'default';
        const stmt = db.prepare(`
            SELECT 
                provider, 
                COALESCE(sum(cost_usd), 0) as cost, 
                COALESCE(sum(total_tokens), 0) as tokens, 
                count(*) as requests
            FROM requests 
            WHERE project_id = ?
            GROUP BY provider 
            ORDER BY cost DESC
        `);
        res.json({ data: stmt.all(projectId) });
    } catch (err) {
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// /api/stats/optimizer
statsRouter.get('/optimizer', (req, res) => {
    try {
        const projectId = (req.query.projectId as string) || 'default';
        const costOptimizations = getCostOptimizationSuggestions(projectId);
        const promptOptimizations = getPromptCacheSuggestions(projectId);
        res.json({ data: [...costOptimizations, ...promptOptimizations] });
    } catch (err) {
        res.status(500).json({ error: 'Internal Server Error' });
    }
});
