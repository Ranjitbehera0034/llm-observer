import { Router } from 'express';
import express from 'express';
import { EventEmitter } from 'events';
import { getDb, bulkInsertRequests } from '@llm-observer/database';

export const requestEventEmitter = new EventEmitter();
requestEventEmitter.setMaxListeners(50);

export const requestsRouter = Router();

// GET /api/requests
requestsRouter.get('/', (req, res) => {
    try {
        const db = getDb();
        const projectId = (req.query.projectId as string) || 'default';
        let page = parseInt(req.query.page as string) || 1;
        let limit = parseInt(req.query.limit as string) || 50;
        const provider = req.query.provider as string;
        const model = req.query.model as string;
        const status = req.query.status as string;

        if (page < 1) page = 1;
        if (limit < 1) limit = 1;
        if (limit > 100) limit = 100;
        const offset = (page - 1) * limit;

        // Build WHERE conditions separately for reuse
        const conditions: string[] = ['project_id = ?'];
        const filterParams: any[] = [projectId];

        if (provider) {
            conditions.push('provider = ?');
            filterParams.push(provider);
        }
        if (model) {
            conditions.push('model LIKE ?');
            filterParams.push(`%${model}%`);
        }
        if (status) {
            if (status === 'error') {
                conditions.push('status_code >= 400');
            } else {
                conditions.push('status = ?');
                filterParams.push(status);
            }
        }

        const whereClause = `WHERE ${conditions.join(' AND ')}`;

        // COUNT query — direct, no subquery
        const countStmt = db.prepare(`SELECT COUNT(*) as count FROM requests ${whereClause}`);
        const countRow = countStmt.get(...filterParams as []) as any;
        const count = countRow?.count ?? 0;

        // Data query
        const dataStmt = db.prepare(`
      SELECT
        id, provider, model, endpoint,
        COALESCE(prompt_tokens, 0)    AS prompt_tokens,
        COALESCE(completion_tokens, 0) AS completion_tokens,
        COALESCE(total_tokens, 0)     AS total_tokens,
        COALESCE(cost_usd, 0)         AS cost_usd,
        latency_ms, status_code, status, is_streaming, metadata, created_at
      FROM requests
      ${whereClause}
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `);
        const data = dataStmt.all(...filterParams as [], limit, offset);

        res.json({
            data,
            meta: {
                total: count,
                page,
                limit,
                totalPages: count === 0 ? 0 : Math.ceil(count / limit)
            }
        });
    } catch (err) {
        console.error('[REQUESTS ROUTE] Error:', err);
        res.status(500).json({ error: 'Internal Server Error', detail: (err as any)?.message });
    }
});

// GET /api/events — SSE real-time stream
requestsRouter.get('/events', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const origin = req.headers.origin || req.headers.host || '';
    if (origin && !origin.includes('localhost') && !origin.includes('127.0.0.1')) {
        return res.status(403).end();
    }

    res.write('data: {"type":"connected"}\n\n');

    const onNewRequest = (requestData: any) => {
        res.write(`data: ${JSON.stringify({ type: 'new_request', data: requestData })}\n\n`);
    };

    requestEventEmitter.on('new_request', onNewRequest);
    const keepAliveTimer = setInterval(() => { res.write(':\n\n'); }, 30000);

    const cleanup = () => {
        clearInterval(keepAliveTimer);
        requestEventEmitter.off('new_request', onNewRequest);
    };

    req.on('close', cleanup);
    req.on('error', cleanup);
    res.on('finish', cleanup);
    res.on('close', cleanup);
    res.on('error', cleanup);
});

// GET /api/requests/:id
requestsRouter.get('/:id', (req, res) => {
    try {
        const db = getDb();
        const stmt = db.prepare(`
      SELECT *,
        COALESCE(prompt_tokens, 0)     AS prompt_tokens,
        COALESCE(completion_tokens, 0) AS completion_tokens,
        COALESCE(total_tokens, 0)      AS total_tokens,
        COALESCE(cost_usd, 0)          AS cost_usd
      FROM requests
      WHERE id = ?
    `);
        const data = stmt.get(req.params.id);
        if (!data) return res.status(404).json({ error: 'Request not found' });
        res.json({ data });
    } catch (err) {
        console.error('[REQUEST DETAIL] Error:', err);
        res.status(500).json({ error: 'Internal Server Error', detail: (err as any)?.message });
    }
});

// POST /api/teams/:id/sync
requestsRouter.post('/:id/sync', express.json({ limit: '10mb' }), (req, res) => {
    try {
        const teamId = req.params.id;
        const requests = req.body.requests;
        if (!Array.isArray(requests)) {
            return res.status(400).json({ error: 'Payload must contain a "requests" array' });
        }
        const normalizedRequests = requests.map(r => ({ ...r, project_id: teamId }));
        bulkInsertRequests(normalizedRequests);
        res.json({ message: 'Synchronized successfully', count: normalizedRequests.length });
    } catch (err) {
        console.error('[SYNC ROUTE] Error:', err);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});