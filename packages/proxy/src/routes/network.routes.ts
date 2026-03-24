import { Router } from 'express';
import { updateSetting, getDb } from '@llm-observer/database';
import { networkMonitor } from '../services/networkMonitor';

const router = Router();

/**
 * GET /api/network/status
 */
router.get('/status', (req, res) => {
    try {
        res.json(networkMonitor.getStatus());
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

/**
 * POST /api/network/start
 */
router.post('/start', async (req, res) => {
    try {
        updateSetting('network_monitor_enabled', 'true');
        await networkMonitor.start();
        res.json({ success: true, running: true });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

/**
 * POST /api/network/stop
 */
router.post('/stop', (req, res) => {
    try {
        updateSetting('network_monitor_enabled', 'false');
        networkMonitor.stop();
        res.json({ success: true, running: false });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

/**
 * DELETE /api/network/history
 */
router.delete('/history', (req, res) => {
    try {
        const db = getDb();
        db.prepare('DELETE FROM app_connections').run();
        res.json({ success: true });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

export default router;
