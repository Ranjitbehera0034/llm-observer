import { Router } from 'express';
import { activityStatus, setActivityReporting } from '../services/activityReporting';
export const activityRouter = Router();
activityRouter.get('/', (_req, res) => res.json(activityStatus()));
activityRouter.post('/', async (req, res) => {
    if (typeof req.body?.enabled !== 'boolean') return res.status(400).json({ error: 'enabled must be boolean' });
    try { await setActivityReporting(req.body.enabled); res.json(activityStatus()); }
    catch { res.status(503).json({ error: 'Activity reporting unavailable' }); }
});
