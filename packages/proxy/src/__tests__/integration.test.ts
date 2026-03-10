// MOCKS MUST BE AT THE TOP
jest.mock('@llm-observer/database', () => {
    const original = jest.requireActual('@llm-observer/database');
    const path = require('path');
    const fs = require('fs');
    const database = require('better-sqlite3')(':memory:');

    const migrationDir = path.join(__dirname, '../../../../packages/database/src');
    ['001_initial.sql', '002_auth.sql', '003_alerts.sql'].forEach(file => {
        const fullPath = path.join(migrationDir, file);
        if (fs.existsSync(fullPath)) {
            database.exec(fs.readFileSync(fullPath, 'utf8'));
        }
    });

    try {
        database.exec('ALTER TABLE requests ADD COLUMN pricing_unknown BOOLEAN DEFAULT 0;');
        database.exec('ALTER TABLE model_pricing ADD COLUMN is_custom BOOLEAN DEFAULT 0;');
        database.exec('ALTER TABLE projects ADD COLUMN organization_id TEXT;');
        database.exec('ALTER TABLE requests ADD COLUMN prompt_hash TEXT;');
        database.exec('ALTER TABLE projects ADD COLUMN saved_filters TEXT DEFAULT "[]";');
    } catch (e) { }

    return {
        ...original,
        getDb: () => database,
        initDb: () => database,
        validateApiKey: () => ({ project_id: 'default' }),
        bulkInsertRequests: (batch: any[]) => {
            const stmt = database.prepare(`
                INSERT INTO requests (
                    id, project_id, provider, model, endpoint, 
                    prompt_tokens, completion_tokens, total_tokens, 
                    cost_usd, latency_ms, status_code, status, 
                    is_streaming, has_tools, error_message, 
                    request_body, response_body, pricing_unknown, tags, prompt_hash, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `);
            for (const req of batch) {
                stmt.run(
                    require('crypto').randomUUID(), req.project_id || 'default', req.provider, req.model, req.endpoint,
                    req.prompt_tokens, req.completion_tokens, req.total_tokens,
                    req.cost_usd, req.latency_ms, req.status_code, req.status,
                    req.is_streaming, req.has_tools, req.error_message,
                    req.request_body, req.response_body, req.pricing_unknown, req.tags, req.prompt_hash,
                    new Date().toISOString()
                );
            }
        }
    };
});

jest.mock('../internalLogger', () => {
    return {
        internalLogger: {
            add: async (data: any) => {
                const { bulkInsertRequests } = require('@llm-observer/database');
                bulkInsertRequests([data]);
            },
            flush: jest.fn()
        }
    };
});

import request from 'supertest';
import express from 'express';
import { handleProxyRequest } from '../proxy';
import { getDb } from '@llm-observer/database';
import { budgetGuard } from '../budgetGuard';
import { rateLimitGuard } from '../rateLimitGuard';
import http from 'http';

describe('Proxy Integration Tests', () => {
    let app: express.Express;
    let mockServer: http.Server;
    let mockServerPort: number;

    const waitForRecord = async (query: string, params: any[]) => {
        const db = getDb();
        for (let i = 0; i < 10; i++) {
            const row = db.prepare(query).get(...params);
            if (row) return row;
            await new Promise(r => setTimeout(r, 100));
        }
        return null;
    };

    beforeAll((done) => {
        const mockTarget = express();
        mockTarget.use(express.json());

        mockTarget.post('/v1/chat/completions', (req, res) => {
            if (req.body.stream) {
                res.setHeader('Content-Type', 'text/event-stream');
                res.write('data: {"id":"1","object":"chat.completion.chunk","model":"gpt-4","choices":[{"delta":{"content":"Hello"},"index":0}]}\n\n');
                res.write('data: {"id":"1","object":"chat.completion.chunk","model":"gpt-4","choices":[{"delta":{"content":" world"},"index":0}]}\n\n');
                res.write('data: {"usage":{"prompt_tokens":10,"completion_tokens":5,"total_tokens":15}}\n\n');
                res.write('data: [DONE]\n\n');
                res.end();
            } else {
                res.json({
                    id: '1',
                    model: 'gpt-4',
                    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
                    choices: [{ message: { content: 'Hello world' } }]
                });
            }
        });

        mockServer = mockTarget.listen(0, () => {
            mockServerPort = (mockServer.address() as any).port;
            done();
        });
    });

    afterAll(() => {
        mockServer.close();
    });

    beforeEach(() => {
        app = express();
        app.use(express.json());
        app.use(budgetGuard);
        app.use(rateLimitGuard);

        app.all('/v1/openai/*', (req, res) => {
            req.url = req.url.replace('/v1/openai', '/v1');
            (req as any).customTargetUrl = `http://localhost:${mockServerPort}`;
            handleProxyRequest(req, res, 'openai');
        });

        app.all('/v1/custom/*', (req, res) => {
            const match = req.url.match(/\/v1\/custom\/([^\/]+)(.*)/);
            if (match) {
                const encodedUrl = match[1];
                (req as any).customTargetUrl = decodeURIComponent(encodedUrl);
                req.url = match[2];
                handleProxyRequest(req, res, 'custom');
            } else {
                res.status(404).send('Not Found');
            }
        });

        const db = getDb();
        db.prepare('DELETE FROM requests').run();
        db.prepare('INSERT OR IGNORE INTO projects (id, name, daily_budget) VALUES (?, ?, ?)').run('default', 'Default Project', 100.0);
        db.prepare('INSERT OR IGNORE INTO model_pricing (provider, model, input_cost_per_1m, output_cost_per_1m) VALUES (?, ?, ?, ?)').run('openai', 'gpt-4', 30.0, 60.0);
    });

    it('should proxy a standard request and log it to DB', async () => {
        const response = await request(app)
            .post('/v1/openai/chat/completions')
            .set('x-api-key', 'test-key')
            .send({ model: 'gpt-4', messages: [{ role: 'user', content: 'test' }] });

        expect(response.status).toBe(200);

        const reqRecord = await waitForRecord('SELECT * FROM requests WHERE project_id = ? AND is_streaming = 0', ['default']) as any;
        expect(reqRecord).toBeDefined();
        expect(reqRecord.cost_usd).toBeCloseTo(0.0006);
    });

    it('should proxy a streaming request and extract usage from SSE', async () => {
        const response = await request(app)
            .post('/v1/openai/chat/completions')
            .set('x-api-key', 'test-key')
            .send({ model: 'gpt-4', messages: [{ role: 'user', content: 'test' }], stream: true });

        expect(response.status).toBe(200);

        const reqRecord = await waitForRecord('SELECT * FROM requests WHERE project_id = ? AND is_streaming = 1', ['default']) as any;
        expect(reqRecord).toBeDefined();
        expect(reqRecord.prompt_tokens).toBe(10);
        expect(reqRecord.completion_tokens).toBe(5);
    });

    it('should capture custom tags from headers', async () => {
        const response = await request(app)
            .post('/v1/openai/chat/completions')
            .set('x-api-key', 'test-key')
            .set('x-llm-observer-tags', 'tag1,tag2')
            .send({ model: 'gpt-4', messages: [{ role: 'user', content: 'test' }] });

        expect(response.status).toBe(200);

        const reqRecord = await waitForRecord('SELECT tags FROM requests WHERE tags IS NOT NULL', []) as any;
        expect(reqRecord).toBeDefined();
        expect(reqRecord.tags).toBe('tag1,tag2');
    });

    it('should support custom/local provider route', async () => {
        const targetUrl = `http://localhost:${mockServerPort}`;
        const encodedTarget = encodeURIComponent(targetUrl);

        const response = await request(app)
            .post(`/v1/custom/${encodedTarget}/v1/chat/completions`)
            .set('x-api-key', 'test-key')
            .send({ model: 'local-llama', messages: [{ role: 'user', content: 'test' }] });

        expect(response.status).toBe(200);

        const reqRecord = await waitForRecord('SELECT provider, model FROM requests WHERE model = ?', ['local-llama']) as any;
        expect(reqRecord).toBeDefined();
        expect(reqRecord.provider).toBe('custom');
    });
});
