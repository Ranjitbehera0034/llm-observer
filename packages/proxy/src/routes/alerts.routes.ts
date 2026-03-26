import { Router } from 'express';
import { getDb } from '@llm-observer/database';

const router = Router();

/**
 * Unified Alerts API
 * Supports both legacy project-level alerts and new budget-level alerts (v1.4.0).
 */

// GET /api/alerts - List alerts
router.get('/', async (req, res) => {
    try {
        const db = getDb();
        const all = req.query.all === 'true';
        const limit = parseInt(req.query.limit as string) || 50;
        const projectId = req.query.projectId as string;
        const budgetId = req.query.budgetId as string;
        
        let query = 'SELECT * FROM alerts';
        const params: any[] = [];
        const conditions: string[] = [];

        if (!all) {
            conditions.push('acknowledged = 0');
        }

        if (projectId) {
            conditions.push('project_id = ?');
            params.push(projectId);
        }

        if (budgetId) {
            conditions.push('budget_id = ?');
            params.push(budgetId);
        }

        if (conditions.length > 0) {
            query += ' WHERE ' + conditions.join(' AND ');
        }

        query += ' ORDER BY created_at DESC LIMIT ?';
        params.push(limit);

        const alerts = db.prepare(query).all(...params);
        res.json({ data: alerts }); // Maintain { data: [] } structure for backward compatibility
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/alerts/unread-count
router.get('/unread-count', async (req, res) => {
    try {
        const db = getDb();
        const row = db.prepare('SELECT COUNT(*) as count FROM alerts WHERE acknowledged = 0').get() as any;
        res.json({ count: row?.count || 0 });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/alerts/:id/acknowledge
router.post('/:id/acknowledge', async (req, res) => {
    try {
        const db = getDb();
        db.prepare('UPDATE alerts SET acknowledged = 1 WHERE id = ?').run(req.params.id);
        res.status(204).send();
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

// ALIAS for backward compatibility: PUT /api/alerts/:id/ack 
router.put('/:id/ack', async (req, res) => {
    try {
        const db = getDb();
        db.prepare('UPDATE alerts SET acknowledged = 1 WHERE id = ?').run(req.params.id);
        res.json({ message: 'Alert acknowledged' });
    } catch (err: any) {
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// POST /api/alerts/acknowledge-all
router.post('/acknowledge-all', async (req, res) => {
    try {
        const db = getDb();
        db.prepare('UPDATE alerts SET acknowledged = 1').run();
        res.status(204).send();
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

export default router;
