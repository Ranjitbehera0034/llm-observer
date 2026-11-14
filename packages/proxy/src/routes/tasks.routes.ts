import { Router } from 'express';
import { createHash, randomUUID } from 'crypto';
import { getDb } from '@llm-observer/database';
import { runOptimizationEngine } from '../optimization/engine';
import { getLastResult } from '../services/aiAnalyst';
export const tasksRouter = Router();
const text = (value: unknown, max: number) => typeof value === 'string' && value.trim().length > 0 && value.length <= max;
tasksRouter.get('/', (_req, res) => res.json({ data: getDb().prepare('SELECT * FROM task_inbox ORDER BY created_at DESC LIMIT 500').all() }));
tasksRouter.post('/', (req, res) => {
    if (!text(req.body?.title, 200) || typeof req.body?.detail !== 'string' || req.body.detail.length > 10000) return res.status(400).json({ error: 'Title (1–200 characters) and detail (up to 10000) required' });
    const id = randomUUID();
    getDb().prepare('INSERT INTO task_inbox(id,source_key,source,title,detail) VALUES(?,?,?,?,?)').run(id, id, 'manual', req.body.title.trim(), req.body.detail);
    res.status(201).json({ id });
});
tasksRouter.post('/collect', async (_req, res) => {
    try {
        // This collection is local. It never triggers a paid model call.
        const optimization = await runOptimizationEngine(30, true);
        const ai = getLastResult();
        const candidates = [
            ...optimization.results.map(r => ({ key: `optimizer:${r.ruleId}`, source: 'optimizer', title: r.title, detail: `${r.description}\n\n${r.action}` })),
            ...(ai?.recommendations ?? []).map(r => ({ key: `ai:${createHash('sha256').update(r.title + '\n' + r.detail).digest('hex')}`, source: 'ai-analyst', title: r.title, detail: r.detail }))
        ];
        let added = 0;
        const db = getDb();
        db.transaction(() => {
            const insert = db.prepare('INSERT OR IGNORE INTO task_inbox(id,source_key,source,title,detail) VALUES(?,?,?,?,?)');
            for (const r of candidates.slice(0,100)) {
                if (text(r.title,200) && text(r.detail,10000)) added += insert.run(randomUUID(), r.key, r.source, r.title, r.detail).changes;
            }
        })();
        res.json({ added, candidates: candidates.length });
    } catch { res.status(500).json({ error: 'Could not collect recommendations' }); }
});
tasksRouter.patch('/:id', (req, res) => {
    if (!['todo','in_progress','done','dismissed'].includes(req.body?.status)) return res.status(400).json({ error: 'Invalid task status' });
    const result = getDb().prepare("UPDATE task_inbox SET status=?, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?").run(req.body.status, req.params.id);
    if (!result.changes) return res.status(404).json({ error: 'Task not found' });
    res.json({ updated: true });
});
