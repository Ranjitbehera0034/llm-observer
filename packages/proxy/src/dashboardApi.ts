import express, { Router } from 'express';
import { EventEmitter } from 'events';
import { getDb, createProject, updateBudget, deleteProject, getAlerts, acknowledgeAlert, getStatsByProvider, createApiKey, getAlertRules, createAlertRule, deleteAlertRule, getCostOptimizationSuggestions, getPromptCacheSuggestions, getSavedFilters, updateSavedFilters } from '@llm-observer/database';

export const requestEventEmitter = new EventEmitter();

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
        let page = parseInt(req.query.page as string) || 1;
        let limit = parseInt(req.query.limit as string) || 50;

        if (page < 1) page = 1;
        if (limit < 1) limit = 1;
        if (limit > 100) limit = 100;

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
    res.write('data: {"type":"connected"}\\n\\n');

    const onNewRequest = (requestData: any) => {
        // Send pushing immediate new events securely payloading small
        res.write(`data: ${JSON.stringify({ type: 'new_requests', data: [requestData] })}\\n\\n`);
    };

    requestEventEmitter.on('new_request', onNewRequest);

    // Keep connection alive with periodic pings (every 30s)
    const keepAliveTimer = setInterval(() => {
        res.write(':\\n\\n'); // Comment style keep-alive
    }, 30000);

    req.on('close', () => {
        clearInterval(keepAliveTimer);
        requestEventEmitter.off('new_request', onNewRequest);
    });
});

// /api/stats/by-provider
dashboardApi.get('/stats/by-provider', (req, res) => {
    try {
        const data = getStatsByProvider('default');
        res.json({ data });
    } catch (err) {
        console.error('API Error:', err);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// /api/projects - Create project
dashboardApi.post('/projects', (req, res) => {
    try {
        const id = createProject(req.body);
        res.json({ id, message: 'Project created' });
    } catch (err) {
        console.error('API Error:', err);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// /api/projects/:id - Update budget
dashboardApi.put('/projects/:id', (req, res) => {
    try {
        updateBudget(req.params.id, req.body);
        res.json({ message: 'Budget updated' });
    } catch (err) {
        console.error('API Error:', err);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// /api/projects/:id/filters - Get saved filters
dashboardApi.get('/projects/:id/filters', (req, res) => {
    try {
        const filters = getSavedFilters(req.params.id);
        res.json({ data: filters });
    } catch (err) {
        console.error('API Error:', err);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// /api/projects/:id/filters - Update saved filters
dashboardApi.put('/projects/:id/filters', express.json(), (req, res) => {
    try {
        updateSavedFilters(req.params.id, req.body.filters || []);
        res.json({ message: 'Filters updated' });
    } catch (err) {
        console.error('API Error:', err);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// /api/projects/:id - Delete project
dashboardApi.delete('/projects/:id', (req, res) => {
    try {
        deleteProject(req.params.id);
        res.json({ message: 'Project deleted' });
    } catch (err) {
        console.error('API Error:', err);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// /api/alerts
dashboardApi.get('/alerts', (req, res) => {
    try {
        const data = getAlerts('default');
        res.json({ data });
    } catch (err) {
        console.error('API Error:', err);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// /api/alerts/:id/ack
dashboardApi.put('/alerts/:id/ack', (req, res) => {
    try {
        acknowledgeAlert(req.params.id);
        res.json({ message: 'Alert acknowledged' });
    } catch (err) {
        console.error('API Error:', err);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// /api/pricing
dashboardApi.get('/pricing', (req, res) => {
    try {
        const db = getDb();
        const data = db.prepare('SELECT * FROM model_pricing').all();
        res.json({ data });
    } catch (err) {
        console.error('API Error:', err);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// /api/stats/unknown-pricing
dashboardApi.get('/stats/unknown-pricing', (req, res) => {
    try {
        const db = getDb();
        const projectId = 'default';
        const countStmt = db.prepare(`SELECT count(*) as count FROM requests WHERE project_id = ? AND pricing_unknown = 1`);
        const result = countStmt.get(projectId) as any;
        res.json({ count: result.count || 0 });
    } catch (err) {
        console.error('API Error:', err);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// --- API Keys Management ---

dashboardApi.get('/auth/keys', (req, res) => {
    try {
        const db = getDb();
        const stmt = db.prepare(`
            SELECT id, key_hint, name, project_id, organization_id, created_at, expires_at, last_used_at
            FROM api_keys
            ORDER BY created_at DESC
        `);
        const keys = stmt.all();
        res.json({ data: keys });
    } catch (err) {
        console.error('API Error:', err);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

dashboardApi.post('/auth/keys', express.json(), (req, res) => {
    try {
        const { name, projectId = 'default', organizationId = 'default' } = req.body;
        if (!name) return res.status(400).json({ error: 'Key name is required' });

        const result = createApiKey(name, projectId, organizationId);
        res.json({ data: result });
    } catch (err) {
        console.error('API Error:', err);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

dashboardApi.delete('/auth/keys/:id', (req, res) => {
    try {
        const db = getDb();
        db.prepare('DELETE FROM api_keys WHERE id = ?').run(req.params.id);
        res.json({ success: true });
    } catch (err) {
        console.error('API Error:', err);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// /api/stats/optimizer
dashboardApi.get('/stats/optimizer', (req, res) => {
    try {
        const costOptimizations = getCostOptimizationSuggestions('default');
        const promptOptimizations = getPromptCacheSuggestions('default');
        res.json({ data: [...costOptimizations, ...promptOptimizations] });
    } catch (err) {
        console.error('API Error:', err);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// /api/stats/export
dashboardApi.get('/stats/export', (req, res) => {
    try {
        const db = getDb();
        const projectId = 'default';
        const format = (req.query.format as string) || 'csv';
        const limit = parseInt(req.query.limit as string) || 10000;
        const days = parseInt(req.query.days as string) || 30;

        const stmt = db.prepare(`
            SELECT id, provider, model, prompt_tokens, completion_tokens, total_tokens, 
                   cost_usd, latency_ms, status_code, status, pricing_unknown, created_at
            FROM requests
            WHERE project_id = ? AND created_at >= date('now', '-' || ? || ' days')
            ORDER BY created_at DESC
            LIMIT ?
        `);
        const data = stmt.all(projectId, days, limit) as any[];

        if (format === 'json') {
            res.setHeader('Content-Type', 'application/json');
            res.setHeader('Content-Disposition', 'attachment; filename="llm-observer-export.json"');
            return res.send(JSON.stringify(data, null, 2));
        }

        if (format === 'csv') {
            res.setHeader('Content-Type', 'text/csv');
            res.setHeader('Content-Disposition', 'attachment; filename="llm-observer-export.csv"');

            if (data.length === 0) return res.send('no_data\\n');

            const headers = Object.keys(data[0]).join(',');
            const rows = data.map(row => {
                return Object.values(row).map(val => {
                    if (val === null || val === undefined) return '';
                    const str = String(val);
                    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
                        return `"${str.replace(/"/g, '""')}"`;
                    }
                    return str;
                }).join(',');
            });

            return res.send([headers, ...rows].join('\\n'));
        }

        res.status(400).json({ error: 'Unsupported format' });
    } catch (err) {
        console.error('API Error:', err);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});
