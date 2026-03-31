import { Router } from 'express';
import { getAgentSummary } from '@llm-observer/database';

const router = Router();

router.get('/summary', (req, res) => {
    try {
        const days = req.query.days ? parseInt(req.query.days as string) : 30;
        const stats = getAgentSummary(days);
        res.json(stats);
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

export default router;
