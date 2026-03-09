import { Router } from 'express';
import express from 'express';
import { EventEmitter } from 'events';
import {
    getDb,
    createApiKey,
    getAlertRules,
    createAlertRule,
    deleteAlertRule,
    getStatsByProvider,
    getAlerts,
    acknowledgeAlert,
    createProject,
    updateBudget,
    deleteProject,
    getSavedFilters,
    updateSavedFilters,
    bulkInsertRequests,
    getCostOptimizationSuggestions,
    getPromptCacheSuggestions,
    getAllSettings,
    updateSettings
} from '@llm-observer/database';
import { checkProjectLimit, getLicenseInfo, activateLicense } from './licenseManager';

export const requestEventEmitter = new EventEmitter();

export const dashboardApi = Router();

// /api/stats/overview
dashboardApi.get('/stats/overview', (req, res) => {
    try {
        const db = getDb();
        const projectId = (req.query.projectId as string) || 'default';

        const statsStmt = db.prepare(`
            SELECT 
                sum(cost_usd) as total_spend,
                count(*) as total_requests,
                avg(latency_ms) as avg_latency,
                sum(case when status_code >= 400 then 1 else 0 end) as error_count
            FROM requests 
            WHERE project_id = ? AND date(created_at) = date('now')
        `);
        const stats = (statsStmt.get(projectId) as any) || { total_spend: 0, total_requests: 0, avg_latency: 0, error_count: 0 };

        const projectStmt = db.prepare('SELECT daily_budget FROM projects WHERE id = ?');
        const project = (projectStmt.get(projectId) as any) || { daily_budget: 0 };

        const tokenStmt = db.prepare(`
            SELECT sum(total_tokens) as tokens
            FROM requests
            WHERE project_id = ? AND date(created_at) = date('now')
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
dashboardApi.get('/stats/chart', (req, res) => {
    try {
        const db = getDb();
        const projectId = (req.query.projectId as string) || 'default';

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
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// /api/stats/models
dashboardApi.get('/stats/models', (req, res) => {
    try {
        const db = getDb();
        const projectId = (req.query.projectId as string) || 'default';

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
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// /api/stats/provider
dashboardApi.get('/stats/provider', (req, res) => {
    try {
        const db = getDb();
        const projectId = (req.query.projectId as string) || 'default';
        const stmt = db.prepare(`
            SELECT 
                provider, 
                sum(cost_usd) as cost, 
                sum(total_tokens) as tokens, 
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
dashboardApi.get('/stats/optimizer', (req, res) => {
    try {
        const projectId = (req.query.projectId as string) || 'default';
        const costOptimizations = getCostOptimizationSuggestions(projectId);
        const promptOptimizations = getPromptCacheSuggestions(projectId);
        res.json({ data: [...costOptimizations, ...promptOptimizations] });
    } catch (err) {
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// Middleware to enforce feature limits (Tollbooth)
const featureGateMiddleware = async (req: express.Request, res: express.Response, next: express.NextFunction) => {
    try {
        const info = await getLicenseInfo();

        // Gating Project Creation
        if (req.method === 'POST' && req.path === '/projects') {
            const canCreate = await checkProjectLimit();
            if (!canCreate) {
                return res.status(403).json({
                    error: 'Payment Required',
                    message: `Free tier is limited to ${info.limits.maxProjects} project. Please upgrade to Pro for unlimited projects.`,
                    code: 'LIMIT_REACHED'
                });
            }
        }

        next();
    } catch (err) {
        console.error('Feature Gate Error:', err);
        next(); // Fallback to allow if check fails to avoid blocking the user due to bugs
    }
};

// /api/projects
dashboardApi.get('/projects', (req, res) => {
    try {
        const db = getDb();
        const stmt = db.prepare(`
            SELECT 
                p.id,
                p.name,
                p.daily_budget,
                COALESCE(SUM(r.cost_usd), 0) as total_spend_today,
                COUNT(r.id) as total_requests_today
            FROM projects p
            LEFT JOIN requests r ON p.id = r.project_id AND date(r.created_at) = date('now')
            GROUP BY p.id
        `);
        const data = stmt.all();

        res.json({ data });
    } catch (err) {
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// /api/projects (POST) - Create a new project (Gated by middleware)
dashboardApi.post('/projects', express.json(), featureGateMiddleware, async (req, res) => {
    try {
        const { name, daily_budget } = req.body;
        if (!name) return res.status(400).json({ error: 'Project name is required' });

        const result = createProject({
            name,
            daily_budget: daily_budget || 0,
            organization_id: 'default'
        });
        res.json({ data: result });
    } catch (err) {
        console.error('API Error:', err);
        res.status(500).json({ error: 'Failed to create project' });
    }
});

// /api/projects/:id/budget (PUT) - Update budget settings
dashboardApi.put('/projects/:id/budget', express.json(), (req, res) => {
    try {
        const { daily_budget } = req.body;
        if (daily_budget === undefined) return res.status(400).json({ error: 'Budget amount required' });

        updateBudget(req.params.id, { daily: daily_budget });
        res.json({ success: true, message: 'Budget updated' });
    } catch (err) {
        console.error('API Error:', err);
        res.status(500).json({ error: 'Failed to update budget' });
    }
});

// /api/projects/:id (PUT) - General project update
dashboardApi.put('/projects/:id', express.json(), (req, res) => {
    try {
        const db = getDb();
        const { name, daily_budget, weekly_budget, monthly_budget, webhook_url } = req.body;

        const stmt = db.prepare(`
            UPDATE projects SET
                name = COALESCE(?, name),
                daily_budget = COALESCE(?, daily_budget),
                weekly_budget = COALESCE(?, weekly_budget),
                monthly_budget = COALESCE(?, monthly_budget),
                webhook_url = COALESCE(?, webhook_url)
            WHERE id = ?
        `);

        stmt.run(
            name || null,
            daily_budget ?? null,
            weekly_budget ?? null,
            monthly_budget ?? null,
            webhook_url || null,
            req.params.id
        );

        res.json({ success: true, message: 'Project updated' });
    } catch (err) {
        console.error('API Error:', err);
        res.status(500).json({ error: 'Failed to update project' });
    }
});

// /api/projects/:id (DELETE) - Delete a project
dashboardApi.delete('/projects/:id', (req, res) => {
    try {
        if (req.params.id === 'default') {
            return res.status(400).json({ error: 'Cannot delete the default project' });
        }

        deleteProject(req.params.id);
        res.json({ success: true });
    } catch (err) {
        console.error('API Error:', err);
        res.status(500).json({ error: 'Failed to delete project' });
    }
});

// /api/requests
dashboardApi.get('/requests', (req, res) => {
    try {
        const db = getDb();
        const projectId = (req.query.projectId as string) || 'default';
        let page = parseInt(req.query.page as string) || 1;
        let limit = parseInt(req.query.limit as string) || 50;
        const provider = req.query.provider as string;
        const model = req.query.model as string;
        const status = req.query.status as string;

        if (page < 1) page = 1;
        if (limit < 1) limit = 1;
        if (limit > 100) limit = 100;

        const offset = (page - 1) * limit;

        let query = `
            SELECT id, provider, model, endpoint, prompt_tokens, completion_tokens, total_tokens,
                   cost_usd, latency_ms, status_code, status, is_streaming, created_at
            FROM requests
            WHERE project_id = ?
        `;
        const params: any[] = [projectId];

        if (provider) {
            query += ` AND provider = ?`;
            params.push(provider);
        }
        if (model) {
            query += ` AND model LIKE ?`;
            params.push(`%${model}%`);
        }
        if (status) {
            if (status === 'error') {
                query += ` AND status_code >= 400`;
            } else {
                query += ` AND status = ?`;
                params.push(status);
            }
        }

        const countQuery = `SELECT count(*) as count FROM (${query}) as sub`;

        query += ` ORDER BY created_at DESC LIMIT ? OFFSET ?`;
        params.push(limit, offset);

        const stmt = db.prepare(query);
        const data = stmt.all(...params);

        const countStmt = db.prepare(countQuery);
        const count = (countStmt.get(...params.slice(0, -2)) as any).count;

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
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// /api/requests/:id
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
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// /api/events
dashboardApi.get('/events', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    res.write('data: {"type":"connected"}\n\n');

    const onNewRequest = (requestData: any) => {
        res.write(`data: ${JSON.stringify({ type: 'new_request', data: requestData })}\n\n`);
    };

    requestEventEmitter.on('new_request', onNewRequest);

    const keepAliveTimer = setInterval(() => {
        res.write(':\n\n');
    }, 30000);

    req.on('close', () => {
        clearInterval(keepAliveTimer);
        requestEventEmitter.off('new_request', onNewRequest);
    });
});

// --- API Keys ---
dashboardApi.get('/auth/keys', (req, res) => {
    try {
        const db = getDb();
        const projectId = (req.query.projectId as string) || 'default';
        const keys = db.prepare('SELECT id, name, key_hint, created_at, last_used_at FROM api_keys WHERE project_id = ? ORDER BY created_at DESC').all(projectId);
        res.json({ data: keys });
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch keys' });
    }
});

dashboardApi.post('/auth/keys', express.json(), (req, res) => {
    try {
        const { name, projectId } = req.body;
        if (!name) return res.status(400).json({ error: 'Name is required' });
        const targetProject = projectId || 'default';
        const result = createApiKey(name, targetProject, 'default');
        res.json({ data: result });
    } catch (err) {
        res.status(500).json({ error: 'Failed to create key' });
    }
});

dashboardApi.delete('/auth/keys/:id', (req, res) => {
    try {
        const db = getDb();
        db.prepare('DELETE FROM api_keys WHERE id = ?').run(req.params.id);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Failed to delete key' });
    }
});

// --- Alert Rules ---
dashboardApi.get('/alert-rules', (req, res) => {
    try {
        const projectId = (req.query.projectId as string) || 'default';
        const rules = getAlertRules(projectId);
        res.json({ data: rules });
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch alert rules' });
    }
});

dashboardApi.post('/alert-rules', express.json(), (req, res) => {
    try {
        const { projectId } = req.body;
        const targetProject = projectId || 'default';
        const id = createAlertRule({ ...req.body, project_id: targetProject, organization_id: 'default' });
        res.json({ data: { id } });
    } catch (err) {
        res.status(500).json({ error: 'Failed to create alert rule' });
    }
});

dashboardApi.delete('/alert-rules/:id', (req, res) => {
    try {
        deleteAlertRule(req.params.id);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Failed to delete alert rule' });
    }
});

// --- Settings ---
dashboardApi.get('/settings', (req, res) => {
    try {
        const settingsMap = getAllSettings();
        res.json({ data: settingsMap });
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch settings' });
    }
});

dashboardApi.put('/settings', express.json(), (req, res) => {
    try {
        updateSettings(req.body);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Failed to update settings' });
    }
});

// --- License ---
dashboardApi.get('/license/status', async (req, res) => {
    try {
        const info = await getLicenseInfo();
        res.json({ data: info });
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch license status' });
    }
});

dashboardApi.post('/license/activate', express.json(), async (req, res) => {
    try {
        const { key } = req.body;
        if (!key) return res.status(400).json({ error: 'License key is required' });

        const result = await activateLicense(key);
        if (result.success) {
            res.json({ success: true, message: result.message });
        } else {
            res.status(400).json({ error: result.message });
        }
    } catch (err) {
        console.error('License Activation Error:', err);
        res.status(500).json({ error: 'Failed to activate license' });
    }
});

// --- Other ---
dashboardApi.get('/alerts', (req, res) => {
    try {
        const projectId = (req.query.projectId as string) || 'default';
        const data = getAlerts(projectId);
        res.json({ data });
    } catch (err) {
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

dashboardApi.put('/alerts/:id/ack', (req, res) => {
    try {
        acknowledgeAlert(req.params.id);
        res.json({ message: 'Alert acknowledged' });
    } catch (err) {
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

dashboardApi.post('/teams/:id/sync', express.json({ limit: '10mb' }), (req, res) => {
    try {
        const teamId = req.params.id;
        const requests = req.body.requests;
        if (!Array.isArray(requests)) {
            return res.status(400).json({ error: 'Payload must contain a "requests" array' });
        }
        const normalizedRequests = requests.map(r => ({ ...r, project_id: teamId }));
        bulkInsertRequests(normalizedRequests);
        res.json({ message: 'Synchronized successfully', count: normalizedRequests.length });
    } catch (err) {
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
        res.status(500).json({ error: 'Internal Server Error' });
    }
});


