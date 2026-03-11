import { Router } from 'express';
import express from 'express';
import { getDb, createProject, updateBudget, deleteProject } from '@llm-observer/database';
import { checkProjectLimit, getLicenseInfo } from '../licenseManager';

export const projectsRouter = Router();

// Feature gate middleware for project limits
const featureGateMiddleware = async (req: express.Request, res: express.Response, next: express.NextFunction) => {
    try {
        const info = await getLicenseInfo();

        if (req.method === 'POST' && req.path === '/') {
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
        next();
    }
};

// GET /api/projects
projectsRouter.get('/', (req, res) => {
    try {
        const db = getDb();
        const stmt = db.prepare(`
            SELECT 
                p.id,
                p.name,
                COALESCE(p.daily_budget, 0) as daily_budget,
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

// POST /api/projects
projectsRouter.post('/', express.json(), featureGateMiddleware, async (req, res) => {
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

// PUT /api/projects/:id/budget
projectsRouter.put('/:id/budget', express.json(), (req, res) => {
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

// PUT /api/projects/:id
projectsRouter.put('/:id', express.json(), (req, res) => {
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

// DELETE /api/projects/:id
projectsRouter.delete('/:id', (req, res) => {
    try {
        if (req.params.id === 'default') {
            return res.status(400).json({ error: 'Cannot delete the default project' });
        }

        const db = getDb();
        const id = req.params.id;
        db.prepare('DELETE FROM requests WHERE project_id = ?').run(id);
        db.prepare('DELETE FROM alerts WHERE project_id = ?').run(id);
        db.prepare('DELETE FROM alert_rules WHERE project_id = ?').run(id);
        db.prepare('DELETE FROM daily_stats WHERE project_id = ?').run(id);
        deleteProject(id);

        res.json({ success: true });
    } catch (err) {
        console.error('API Error:', err);
        res.status(500).json({ error: 'Failed to delete project' });
    }
});
