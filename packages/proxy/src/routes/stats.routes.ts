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
                COALESCE(sum(CASE WHEN pricing_unknown = 1 THEN NULL ELSE cost_usd END), 0) as total_spend,
                count(*) as total_requests,
                sum(CASE WHEN pricing_unknown = 1 THEN 1 ELSE 0 END) as unpriced_requests,
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
            unpricedRequestsToday: stats.unpriced_requests || 0,
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
                COALESCE(sum(CASE WHEN pricing_unknown = 1 THEN NULL ELSE cost_usd END), 0) as cost,
                count(*) as requests,
                sum(CASE WHEN pricing_unknown = 1 THEN 1 ELSE 0 END) as unpriced_requests
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
                COALESCE(sum(CASE WHEN pricing_unknown = 1 THEN NULL ELSE cost_usd END), 0) as cost,
                COALESCE(sum(total_tokens), 0) as tokens,
                count(*) as requests,
                sum(CASE WHEN pricing_unknown = 1 THEN 1 ELSE 0 END) as unpriced_requests
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
                COALESCE(sum(CASE WHEN pricing_unknown = 1 THEN NULL ELSE cost_usd END), 0) as cost,
                COALESCE(sum(total_tokens), 0) as tokens,
                count(*) as requests,
                sum(CASE WHEN pricing_unknown = 1 THEN 1 ELSE 0 END) as unpriced_requests
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

// Export the same unknown-price semantics used by request detail/list views.
statsRouter.get('/export', (req, res) => {
    const format = String(req.query.format || 'json');
    if (!['json', 'csv'].includes(format)) return res.status(400).json({ error: 'Use json or csv.' });
    const days = Math.min(365, Math.max(1, parseInt(String(req.query.days)) || 30));
    const project = String(req.query.projectId || 'default');
    try {
        const rows = getDb().prepare(`SELECT id, provider, model, created_at, prompt_tokens, completion_tokens,
            CASE WHEN pricing_unknown = 1 THEN NULL ELSE cost_usd END AS cost_usd,
            CASE WHEN pricing_unknown = 1 THEN 'unpriced' ELSE 'estimated' END AS pricing_status
            FROM requests WHERE project_id = ? AND julianday(created_at) >= julianday('now', ?)
            ORDER BY created_at, id`).all(project, `-${days} days`) as Record<string, unknown>[];
        if (format === 'json') return res.json({ data: rows, unpriced_requests: rows.filter(r => r.cost_usd === null).length });
        const columns = ['id', 'provider', 'model', 'created_at', 'prompt_tokens', 'completion_tokens', 'cost_usd', 'pricing_status'];
        const cell = (value: unknown) => {
            if (value == null) return '';
            const text = String(value);
            const safe = /^[=+@\-\t\r]/.test(text) ? "'" + text : text;
            return '"' + safe.replace(/"/g, '""') + '"';
        };
        res.type('text/csv').send([columns.join(','), ...rows.map(row => columns.map(key => cell(row[key])).join(','))].join('\n'));
    } catch { res.status(500).json({ error: 'Export failed.' }); }
});
