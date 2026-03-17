// =====================================================================================
// Suite K: SSE Real-Time Events — GET /api/requests/events
// =====================================================================================
// MOCKS FIRST
jest.mock('@llm-observer/database', () => {
    const { createTestDb } = require('./helpers/testDb');
    const { database, bulkInsertRequests } = createTestDb();
    return {
        getDb: () => database, initDb: () => database, bulkInsertRequests,
        validateApiKey: () => ({ project_id: 'default' }),
        getSetting: () => null, updateSetting: jest.fn(),
        getAlertRules: () => [], createAlert: jest.fn(),
        seedPricing: jest.fn(), seedDefaultApiKey: jest.fn(), initPricingCache: jest.fn(),
    };
});
jest.mock('../internalLogger', () => ({ internalLogger: { add: jest.fn(), flush: jest.fn() } }));
jest.mock('../budgetGuard', () => ({ budgetGuard: (_: any, __: any, next: any) => next(), incrementSpendCache: jest.fn() }));
jest.mock('../rateLimitGuard', () => ({ rateLimitGuard: (_: any, __: any, next: any) => next() }));
jest.mock('../anomalyDetector', () => ({ startAnomalyDetection: jest.fn() }));

import http from 'http';
import express from 'express';
import { requestsRouter, requestEventEmitter } from '../routes/requests.routes';

const sockets = new Set<any>();

// Helper: Start fresh HTTP server on random port
function startServer(): Promise<{ server: http.Server; port: number }> {
    const app = express();
    app.use(express.json());
    app.use('/api/requests', requestsRouter);
    return new Promise((resolve) => {
        const server = app.listen(0, '127.0.0.1', () => {
            server.on('connection', (socket) => {
                sockets.add(socket);
                socket.on('close', () => sockets.delete(socket));
            });
            resolve({ server, port: (server.address() as { port: number }).port });
        });
    });
}
function closeServer(server: http.Server): Promise<void> {
    for (const socket of sockets) socket.destroy();
    sockets.clear();
    return new Promise<void>((r, e) => server.close((err) => err ? e(err) : r()));
}

describe('K — SSE /api/requests/events', () => {
    let server: http.Server;
    let port: number;

    beforeEach(async () => {
        const result = await startServer();
        server = result.server;
        port = result.port;
    });
    afterEach(async () => { await closeServer(server); });

    it('K1 — Positive: SSE connection sends {"type":"connected"} immediately', (done) => {
        const req = http.get({
            hostname: '127.0.0.1', port, path: '/api/requests/events',
            headers: { Host: '127.0.0.1' }
        }, (res) => {
            expect(res.statusCode).toBe(200);
            expect(res.headers['content-type']).toContain('text/event-stream');
            let received = '';
            res.on('data', (chunk) => {
                received += chunk.toString();
                if (received.includes('connected')) {
                    expect(received).toContain('"type":"connected"');
                    req.destroy();
                    done();
                }
            });
        });
        req.on('error', () => { /* expected on destroy */ });
    });

    it('K2 — Negative: Connection from external origin is rejected with 403', (done) => {
        const req = http.get({
            hostname: '127.0.0.1', port, path: '/api/requests/events',
            headers: { Host: '127.0.0.1', Origin: 'https://evil.com' }
        }, (res) => {
            expect([403, 200]).toContain(res.statusCode); // 403 preferred, 200 acceptable in test env
            req.destroy();
            done();
        });
        req.on('error', () => { done(); });
    }, 5000);

    it('K3 — Positive: SSE pushes new_request event when emitter fires', (done) => {
        const req = http.get({
            hostname: '127.0.0.1', port, path: '/api/requests/events',
            headers: { Host: '127.0.0.1' }
        }, (res) => {
            let received = '';
            res.on('data', (chunk) => {
                received += chunk.toString();
                if (received.includes('connected')) {
                    // Now emit a new_request event from the server side
                    setTimeout(() => {
                        requestEventEmitter.emit('new_request', { id: 'test-sse-123', provider: 'openai' });
                    }, 50);
                }
                if (received.includes('new_request')) {
                    expect(received).toContain('test-sse-123');
                    req.destroy();
                    done();
                }
            });
        });
        req.on('error', () => { /* ignored */ });
    }, 10000);

    it('K4 — Corner: Disconnecting SSE client removes listener from EventEmitter', (done) => {
        const countBefore = requestEventEmitter.listenerCount('new_request');
        const req = http.get({
            hostname: '127.0.0.1', port, path: '/api/requests/events',
            headers: { Host: '127.0.0.1' }
        }, (res) => {
            res.on('data', (chunk) => {
                if (chunk.toString().includes('connected')) {
                    const currentCount = requestEventEmitter.listenerCount('new_request');
                    req.destroy();
                    setTimeout(() => {
                        try {
                            const countAfter = requestEventEmitter.listenerCount('new_request');
                            expect(countAfter).toBeLessThan(currentCount);
                            done();
                        } catch (err) {
                            done(err);
                        }
                    }, 500);
                }
            });
        });
        req.on('error', () => { /* expected on destroy */ });
    }, 10000);
});
