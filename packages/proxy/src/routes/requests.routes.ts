import { Router } from 'express';
import express from 'express';
import { EventEmitter } from 'events';
import { getDb, bulkInsertRequests } from '@llm-observer/database';

export const requestEventEmitter = new EventEmitter();

// Set max listeners to avoid memory leak warnings when many tabs open
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

        let query = `
            SELECT id, provider, model, endpoint, 
                   COALESCE(prompt_tokens, 0) as prompt_tokens, 
                   COALESCE(completion_tokens, 0) as completion_tokens, 
                   COALESCE(total_tokens, 0) as total_tokens,
                   COALESCE(cost_usd, 0) as cost_usd, 
                   latency_ms, status_code, status, is_streaming, created_at, metadata
            FROM requests
            WHERE project_id = ?
        `;
        const params: any[] = [projectId];

        if (provider) {
            query += ` AND provider = ?`;
            params.push(provider);
        }
        if (model) {
            query += ` AND model LIKE ?`;
            params.push(`%${model}%`);
        }
        if (status) {
            if (status === 'error') {
                query += ` AND status_code >= 400`;
            } else {
                query += ` AND status = ?`;
                params.push(status);
            }
        }

        const countQuery = `SELECT count(*) as count FROM (${query}) as sub`;

        query += ` ORDER BY created_at DESC LIMIT ? OFFSET ?`;
        params.push(limit, offset);

        const stmt = db.prepare(query);
        const data = stmt.all(...params);

        const countStmt = db.prepare(countQuery);
        const count = (countStmt.get(...params.slice(0, -2)) as any).count;

        res.json({
            data,
            meta: {
                total: count,
                page,
                limit,
                totalPages: Math.ceil(count / limit)
            }
        });
    } catch (err) {
        res.status(500).json({ error: 'Internal Server Error' });
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

    const keepAliveTimer = setInterval(() => {
        res.write(':\n\n');
    }, 30000);

    const cleanup = () => {
        clearInterval(keepAliveTimer);
        requestEventEmitter.off('new_request', onNewRequest);
    };

    req.on('close', cleanup);
    req.on('error', cleanup);
    req.on('end', cleanup);
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
                   COALESCE(prompt_tokens, 0) as prompt_tokens, 
                   COALESCE(completion_tokens, 0) as completion_tokens, 
                   COALESCE(total_tokens, 0) as total_tokens,
                   COALESCE(cost_usd, 0) as cost_usd 
            FROM requests WHERE id = ?
        `);
        const data = stmt.get(req.params.id);

        if (!data) {
            return res.status(404).json({ error: 'Request not found' });
        }
        res.json({ data });
    } catch (err) {
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// moved to top

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
        res.status(500).json({ error: 'Internal Server Error' });
    }
});
