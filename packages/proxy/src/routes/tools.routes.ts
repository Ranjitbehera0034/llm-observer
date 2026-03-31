import { Router } from 'express';
import { getToolUsage } from '@llm-observer/database';

const router = Router();

router.get('/usage', (req, res) => {
    try {
        const days = req.query.days ? parseInt(req.query.days as string) : 30;
        const stats = getToolUsage(days);
        res.json(stats);
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

export default router;
