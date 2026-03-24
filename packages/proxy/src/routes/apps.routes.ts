import { Router } from 'express';
import { getDb } from '@llm-observer/database';
import { AppCorrelator } from '../services/appCorrelator';

const router = Router();

/**
 * GET /api/apps
 * Get per-app spending summary.
 */
router.get('/', async (req, res) => {
    try {
        const period = (req.query.period as 'today' | 'week' | 'month') || 'today';
        const provider = req.query.provider as string;
        
        const data = await AppCorrelator.getAppSpend(period, provider);
        res.json(data);
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

/**
 * GET /api/apps/:name/detail
 * Get detailed info for one app.
 */
router.get('/:name/detail', async (req, res) => {
    try {
        const processName = req.params.name;
        const days = parseInt(req.query.days as string) || 30;
        
        const data = await AppCorrelator.getAppDetail(processName, days);
        res.json(data);
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

/**
 * PUT /api/apps/:name/alias
 * Update display name for a process.
 */
router.put('/:name/alias', async (req, res) => {
    try {
        const processName = req.params.name;
        const { display_name } = req.body;
        
        if (!display_name) {
            return res.status(400).json({ error: 'display_name is required' });
        }
        
        const db = getDb();
        db.prepare('INSERT OR REPLACE INTO app_aliases (process_name, display_name) VALUES (?, ?)')
          .run(processName, display_name);
          
        res.json({ success: true });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

export default router;
