import { Router } from 'express';
import { 
    getSessions, 
    getSessionById, 
    getSessionSummary, 
    getSessionsByProject, 
    getSessionsByModel, 
    getMostExpensiveSessions,
    getSubagentsBySession
} from '@llm-observer/database';
import { triggerParseCycle, getProviderStatus } from '../parsers/manager';

const router = Router();

router.get('/summary', (req, res) => {
    try {
        const stats = getSessionSummary(req.query);
        res.json(stats);
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

router.get('/expensive', (req, res) => {
    try {
        const limit = req.query.limit ? parseInt(req.query.limit as string) : 10;
        const sessions = getMostExpensiveSessions(limit);
        res.json(sessions);
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

router.get('/by-project', (req, res) => {
    try {
        const stats = getSessionsByProject();
        res.json(stats);
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

router.get('/by-model', (req, res) => {
    try {
        const stats = getSessionsByModel();
        res.json(stats);
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

router.get('/providers', (req, res) => {
    res.json(getProviderStatus());
});

router.post('/refresh', async (req, res) => {
    try {
        triggerParseCycle(); // non-blocking, runs in background
        res.json({ message: 'Parsing cycle triggered' });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

router.get('/:id', (req, res) => {
    try {
        const session = getSessionById(req.params.id);
        if (!session) {
            return res.status(404).json({ error: 'Session not found' });
        }
        res.json(session);
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

router.get('/:id/agents', (req, res) => {
    try {
        const session = getSessionById(req.params.id);
        if (!session) {
            return res.status(404).json({ error: 'Session not found' });
        }
        const agents = getSubagentsBySession(req.params.id);
        res.json({
            parent: session,
            subagents: agents
        });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

router.get('/', (req, res) => {
    try {
        const sessions = getSessions(req.query);
        res.json({ data: sessions });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

export default router;
