import { Router } from 'express';
import express from 'express';
import { getDb, createApiKey } from '@llm-observer/database';

export const authRouter = Router();

// GET /api/auth/keys
authRouter.get('/keys', (req, res) => {
    try {
        const db = getDb();
        const projectId = (req.query.projectId as string) || 'default';
        const keys = db.prepare('SELECT id, name, key_hint, created_at, last_used_at FROM api_keys WHERE project_id = ? ORDER BY created_at DESC').all(projectId);
        res.json({ data: keys });
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch keys' });
    }
});

// POST /api/auth/keys
authRouter.post('/keys', express.json(), (req, res) => {
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

// DELETE /api/auth/keys/:id
authRouter.delete('/keys/:id', (req, res) => {
    try {
        const db = getDb();
        db.prepare('DELETE FROM api_keys WHERE id = ?').run(req.params.id);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Failed to delete key' });
    }
});
