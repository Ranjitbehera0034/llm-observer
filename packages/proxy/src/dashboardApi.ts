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

// /api/projects - List of projects with cost aggregations
dashboardApi.get('/projects', (req, res) => {
    try {
        const db = getDb();

        // Join projects with requests to get total spend per project
        const stmt = db.prepare(`
            SELECT 
                p.id, 
                p.name, 
                p.daily_budget as daily_budget,
                COALESCE(SUM(r.cost_usd), 0) as total_spend_today,
                COUNT(r.id) as total_requests_today
            FROM projects p
            LEFT JOIN requests r ON p.id = r.project_id AND date(r.created_at) = date('now')
            GROUP BY p.id
        `);
        const data = stmt.all();

        res.json({ data });
    } catch (err) {
        console.error('API Error:', err);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// /api/requests - Paginated list of requests
dashboardApi.get('/requests', (req, res) => {
    try {
        const db = getDb();
        const projectId = 'default';
        const page = parseInt(req.query.page as string) || 1;
        const limit = parseInt(req.query.limit as string) || 50;
        const offset = (page - 1) * limit;

        const stmt = db.prepare(`
            SELECT id, provider, model, endpoint, prompt_tokens, completion_tokens, total_tokens, 
                   cost_usd, latency_ms, status_code, status, is_streaming, created_at
            FROM requests
            WHERE project_id = ?
            ORDER BY created_at DESC
            LIMIT ? OFFSET ?
        `);
        const data = stmt.all(projectId, limit, offset);

        const countStmt = db.prepare('SELECT count(*) as count FROM requests WHERE project_id = ?');
        const count = (countStmt.get(projectId) as any).count;

        res.json({
            data,
            meta: {
                total: count,
                page,
                limit,
                totalPages: Math.ceil(count / limit)
            }
        });
    } catch (err) {
        console.error('API Error:', err);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// /api/requests/:id - Detail view for a request (includes body JSONs)
dashboardApi.get('/requests/:id', (req, res) => {
    try {
        const db = getDb();
        const stmt = db.prepare('SELECT * FROM requests WHERE id = ?');
        const data = stmt.get(req.params.id);

        if (!data) {
            return res.status(404).json({ error: 'Request not found' });
        }
        res.json({ data });
    } catch (err) {
        console.error('API Error:', err);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// /api/requests/stream - SSE connection for live updates
dashboardApi.get('/requests/stream', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    // Send an initial ping to establish connection
    res.write('data: {"type":"connected"}\n\n');

    let keepAliveTimer: NodeJS.Timeout;
    let pollTimer: NodeJS.Timeout;

    // Better-sqlite3 does not easily support notify/listen hooks natively without recompiling / native addons,
    // so we'll use a fast poll approach (every 1s) to see if new requests arrived since last check
    let lastCheckedTime = new Date().toISOString();

    const checkNewRequests = () => {
        try {
            const db = getDb();
            const stmt = db.prepare(`
                SELECT id, provider, model, endpoint, prompt_tokens, completion_tokens, total_tokens, 
                       cost_usd, latency_ms, status_code, status, is_streaming, created_at
                FROM requests
                WHERE project_id = 'default' AND created_at > ?
                ORDER BY created_at ASC
            `);
            const newData = stmt.all(lastCheckedTime) as any[];

            if (newData.length > 0) {
                lastCheckedTime = newData[newData.length - 1].created_at;

                // Exclude the bodies to keep payloads small
                res.write(`data: ${JSON.stringify({ type: 'new_requests', data: newData })}\n\n`);
            }
        } catch (err) {
            console.error('SSE Poll Error:', err);
        }
    };

    pollTimer = setInterval(checkNewRequests, 1000);

    // Keep connection alive with periodic pings (every 30s)
    keepAliveTimer = setInterval(() => {
        res.write(':\n\n'); // Comment style keep-alive
    }, 30000);

    req.on('close', () => {
        clearInterval(pollTimer);
        clearInterval(keepAliveTimer);
    });
});
