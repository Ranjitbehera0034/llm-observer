import request from 'supertest';
import express from 'express';
import http from 'http';
import { handleProxyRequest } from '../proxy';
import { initDb, getDb, createAlertRule } from '@llm-observer/database';
import { internalLogger, __resetAlertCooldownsForTests } from '../internalLogger';
import { requestEventEmitter } from '../dashboardApi';

jest.mock('../budgetGuard', () => ({
    budgetGuard: (_req: any, _res: any, next: any) => next(),
    incrementSpendCache: jest.fn()
}));
jest.mock('../rateLimitGuard', () => ({
    rateLimitGuard: (_req: any, _res: any, next: any) => next()
}));

const UPSTREAM_PORT = 15851;

const app = express();
app.use(express.json());
app.all('/*', (req, res) => {
    (req as any).customTargetUrl = `http://127.0.0.1:${UPSTREAM_PORT}`;
    handleProxyRequest(req as any, res as any, 'openai');
});

describe('request id is shared by the stored row, the alert and the SSE event', () => {
    let upstream: http.Server;

    beforeAll(async () => {
        const db = initDb(':memory:');
        db.prepare('INSERT INTO projects (id, name, daily_budget) VALUES (?, ?, ?)').run('default', 'Default Project', 100.0);
        createAlertRule({
            name: 'any latency', project_id: 'default', organization_id: 'default',
            condition_type: 'latency_spike', threshold: -1, time_window_minutes: null, webhook_url: null, email_notification: null
        });
        upstream = http.createServer((_req, res) => {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ id: 'c1', choices: [{ message: { content: 'ok' } }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }));
        });
        await new Promise<void>(r => upstream.listen(UPSTREAM_PORT, '127.0.0.1', r));
    });
    afterAll(async () => { await new Promise(r => upstream.close(r)); });

    it('links alerts.data.request_id and the SSE event id to the requests row', async () => {
        __resetAlertCooldownsForTests();
        const events: any[] = [];
        const listener = (e: any) => events.push(e);
        requestEventEmitter.on('new_request', listener);
        try {
            await request(app).post('/v1/chat/completions').send({ model: 'gpt-4o', messages: [{ role: 'user', content: 'hi' }] }).expect(200);
            for (let i = 0; i < 50 && events.length === 0; i++) await new Promise(r => setTimeout(r, 20));
            await new Promise(r => setTimeout(r, 50)); // let the alert insert settle
            await internalLogger.flush();
        } finally {
            requestEventEmitter.off('new_request', listener);
        }

        expect(events).toHaveLength(1);
        const rows = getDb().prepare('SELECT id FROM requests').all() as any[];
        expect(rows).toHaveLength(1);
        expect(events[0].id).toBeTruthy();
        expect(events[0].id).toBe(rows[0].id);

        const alerts = getDb().prepare("SELECT data FROM alerts WHERE type = 'latency_spike'").all() as any[];
        expect(alerts).toHaveLength(1);
        expect(JSON.parse(alerts[0].data).request_id).toBe(rows[0].id);
    });
});

describe('request id is shared with the alert for an upstream failure (502)', () => {
    const DEAD_PORT = 15852; // nothing listens here
    const deadApp = express();
    deadApp.use(express.json());
    deadApp.all('/*', (req, res) => {
        (req as any).customTargetUrl = `http://127.0.0.1:${DEAD_PORT}`;
        handleProxyRequest(req as any, res as any, 'openai');
    });

    it('links alerts.data.request_id to the stored error row', async () => {
        const db = getDb();
        db.prepare('DELETE FROM requests').run();
        db.prepare('DELETE FROM alerts').run();
        db.prepare('DELETE FROM alert_rules').run();
        createAlertRule({
            name: 'any error', project_id: 'default', organization_id: 'default',
            condition_type: 'error_rate', threshold: 1, time_window_minutes: 60, webhook_url: null, email_notification: null
        });
        __resetAlertCooldownsForTests();
        await request(deadApp).post('/v1/chat/completions').send({ model: 'gpt-4o', messages: [{ role: 'user', content: 'hi' }] }).expect(502);
        await new Promise(r => setTimeout(r, 100));
        await internalLogger.flush();
        await new Promise(r => setTimeout(r, 100));

        const rows = db.prepare('SELECT id, status_code FROM requests').all() as any[];
        expect(rows).toHaveLength(1);
        expect(rows[0].status_code).toBe(502);
        const alerts = db.prepare('SELECT type, data FROM alerts').all() as any[];
        expect(alerts.length).toBeGreaterThan(0);
        expect(JSON.parse(alerts[0].data).request_id).toBe(rows[0].id);
    });
});
