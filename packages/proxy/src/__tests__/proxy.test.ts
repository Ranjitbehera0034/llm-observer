import request from 'supertest';
import express from 'express';
import { handleProxyRequest } from '../proxy';
import { initDb, getDb } from '@llm-observer/database';
import http from 'http';
import { internalLogger } from '../internalLogger';

// Mock the background tasks and managers to avoid side effects
jest.mock('../budgetGuard', () => ({
    budgetGuard: (req: any, res: any, next: any) => next(),
    incrementSpendCache: jest.fn()
}));
jest.mock('../rateLimitGuard', () => ({
    rateLimitGuard: (req: any, res: any, next: any) => next()
}));

const app = express();
app.use(express.json());

// TERMINAL HANDLER with async wait for test stability
app.all('/*', (req, res, next) => {
    (req as any).customTargetUrl = 'http://127.0.0.1:5005';
    
    // Monkey-patch res.end to know when we are truly done
    const originalEnd = res.end;
    const donePromise = new Promise<void>((resolve) => {
        res.end = function(...args: any[]) {
            const result = (originalEnd as any).apply(this, args);
            resolve();
            return result;
        };
    });

    handleProxyRequest(req as any, res as any, 'openai');
    
    // In a test environment, we might need to wait for the response to be sent
    // before the express handler "finishes" to avoid supertest getting a default 404
    // if it thinks no handler sent a response.
    // However, since handleProxyRequest is NOT awaited, we just hope res.end is called.
});

describe('Proxy Core Integration', () => {
    let mockTarget: http.Server;

    beforeAll(async () => {
        const db = initDb(':memory:');
        db.prepare('INSERT INTO projects (id, name, daily_budget) VALUES (?, ?, ?)').run('default', 'Default Project', 100.0);
        mockTarget = http.createServer((req, res) => {
            if (req.url?.includes('streaming')) {
                res.writeHead(200, { 'Content-Type': 'text/event-stream' });
                res.write('data: {"choices": [{"delta": {"content": "Hello"}}]}\n\n');
                setTimeout(() => {
                    res.write('data: {"choices": [{"delta": {"content": " World"}}], "usage": {"prompt_tokens": 5, "completion_tokens": 5, "total_tokens": 10}}\n\n');
                    res.end('data: [DONE]\n\n');
                }, 10);
            } else {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    id: 'chatcmpl-123',
                    choices: [{ message: { content: 'Mock response' } }],
                    usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 }
                }));
            }
        });
        mockTarget.listen(5005);
    });

    afterAll(() => {
        mockTarget.close();
    });

    it('intercepts and logs a basic JSON request', (done) => {
        request(app)
            .post('/v1/chat/completions')
            .send({
                model: 'gpt-4o',
                messages: [{ role: 'user', content: 'hi' }]
            })
            .expect(200)
            .end((err, res) => {
                if (err) return done(err);
                expect(res.body.choices[0].message.content).toBe('Mock response');
                
                setTimeout(async () => {
                    try {
                        await internalLogger.flush();
                        const db = getDb();
                        const log = db.prepare('SELECT * FROM requests WHERE is_streaming = 0 ORDER BY created_at DESC LIMIT 1').get() as any;
                        expect(log).toBeDefined();
                        expect(log.model).toBeDefined();
                        done();
                    } catch (e) {
                        done(e);
                    }
                }, 100);
            });
    });

    it('handles streaming responses chunk-by-chunk', (done) => {
        request(app)
            .post('/v1/chat/completions/streaming')
            .send({
                model: 'gpt-4o',
                messages: [{ role: 'user', content: 'hi' }],
                stream: true
            })
            .expect(200)
            .end((err, res) => {
                if (err) return done(err);
                expect(res.text).toContain('Hello');
                expect(res.text).toContain('World');
                
                setTimeout(async () => {
                    try {
                        await internalLogger.flush();
                        const db = getDb();
                        const log = db.prepare('SELECT * FROM requests WHERE is_streaming = 1 ORDER BY created_at DESC LIMIT 1').get() as any;
                        expect(log).toBeDefined();
                        expect(log.total_tokens).toBe(10);
                        done();
                    } catch (e) {
                        done(e);
                    }
                }, 100);
            });
    });
});
