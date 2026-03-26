import request from 'supertest';
import express from 'express';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import http from 'http';

// ─── Mock DB and Logger ─────────────────────────────────────
vi.mock('@llm-observer/database', () => ({
    getDb: () => ({
        prepare: () => ({ all: () => [], get: () => ({}), run: () => ({ changes: 1 }) })
    }),
    getSetting: () => null,
}));

const mockLoggerAdd = vi.fn().mockResolvedValue(true);
vi.mock('../../packages/proxy/src/internalLogger', () => ({
    internalLogger: { add: mockLoggerAdd }
}));

// We must dynamically import so mocks apply
const { handleProxyRequest } = await import('../../packages/proxy/src/proxy');

// ─── Create Test Proxy App ──────────────────────────────────
const proxyApp = express();
proxyApp.use(express.json({ limit: '5mb' }));

proxyApp.all('/v1/custom/:targetBaseUrl/*', (req: any, res) => {
    const encodedUrl = req.params.targetBaseUrl;
    req.customTargetUrl = decodeURIComponent(encodedUrl);
    req.url = req.url.replace(`/v1/custom/${encodedUrl}`, '');
    handleProxyRequest(req, res, 'custom');
});

proxyApp.all('/v1/openai/*', (req: any, res) => {
    // For OpenAI, we override the target url so we can test the pipeline locally
    req.customTargetUrl = `http://127.0.0.1:${TARGET_SERVER_PORT}`;
    req.url = req.url.replace('/v1/openai', '/v1');
    handleProxyRequest(req, res, 'openai');
});

// ─── Dummy Target Server (simulating OpenAI/Provider) ───────
let targetServer: http.Server;
const TARGET_SERVER_PORT = 8999;

beforeAll(async () => {
    targetServer = http.createServer((req, res) => {
        // Echo back headers and body for inspection
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
            const forcedStatus = req.headers['x-test-error-status'];
            if (forcedStatus) {
                const status = parseInt(forcedStatus as string, 10);
                const payload = { error: { message: "Test error" } };
                const headers: any = { 'Content-Type': 'application/json' };
                if (status === 429) {
                    headers['Retry-After'] = '60';
                }
                res.writeHead(status, headers);
                res.end(JSON.stringify(payload));
                return;
            }

            if (req.url === '/v1/chat/completions') {
                let parsed: any = {};
                try {
                    parsed = body ? JSON.parse(body) : {};
                } catch (e) {}

                if (parsed.stream) {
                    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
                    res.write('data: {"choices": [{"delta": {"content": "Hello"}}]}\n\n');
                    res.write('data: [DONE]\n\n');
                    res.end();
                } else {
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ 
                        receivedBody: parsed,
                        headers: req.headers,
                        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }
                    }));
                }
            } else {
                console.log(`Dummy server received unexpected: ${req.method} ${req.url}`);
                res.writeHead(404);
                res.end('Not found');
            }
        });
    });
    return new Promise<void>((resolve) => targetServer.listen(TARGET_SERVER_PORT, () => resolve()));
});

afterAll(async () => {
    return new Promise<void>((resolve) => targetServer.close(() => resolve()));
});

// ─── Tests ──────────────────────────────────────────────────
describe('Proxy Forwarding Tests', () => {
    it('successfully forwards non-streaming request to local dummy target (OpenAI provider mode)', async () => {
        const payload = { model: 'gpt-3.5-turbo', messages: [{ role: 'user', content: 'test' }] };
        const res = await request(proxyApp)
            .post('/v1/openai/chat/completions')
            .set('Authorization', 'Bearer dummy-key')
            .send(payload);

        expect(res.status).toBe(200);
        expect(res.body.receivedBody.model).toBe('gpt-3.5-turbo');
        expect(res.body.headers['authorization']).toBe('Bearer dummy-key');
        
        // Ensure the logger was called
        expect(mockLoggerAdd).toHaveBeenCalled();
        const logData = mockLoggerAdd.mock.calls[mockLoggerAdd.mock.calls.length - 1][0];
        expect(logData.provider).toBe('openai');
        expect(logData.model).toBe('gpt-3.5-turbo');
        expect(logData.status_code).toBe(200);
        expect(logData.is_streaming).toBe(false);
    });

    it('successfully streams response from local dummy target', async () => {
        const payload = { model: 'gpt-3.5-turbo', stream: true, messages: [{ role: 'user', content: 'test' }] };
        const res = await request(proxyApp)
            .post('/v1/openai/chat/completions')
            .send(payload);

        if (res.status !== 200) {
            console.log('Stream test failed with body:', res.text);
        }
        expect(res.status).toBe(200);
        expect(res.text).toContain('data: {"choices": [{"delta": {"content": "Hello"}}]}');
        expect(res.headers['content-type']).toContain('text/event-stream');

        // Allow micro-tick for stream end event logging
        await new Promise(resolve => setTimeout(resolve, 50));
        
        expect(mockLoggerAdd).toHaveBeenCalled();
        const logData = mockLoggerAdd.mock.calls[mockLoggerAdd.mock.calls.length - 1][0];
        expect(logData.is_streaming).toBe(true);
    });

    it('intercepts 429 and enriches it with _source and _observer_note, preserving Retry-After', async () => {
        const payload = { model: 'gpt-3.5-turbo', messages: [{ role: 'user', content: 'test' }] };
        const res = await request(proxyApp)
            .post('/v1/openai/chat/completions')
            .set('X-Test-Error-Status', '429')
            .send(payload);

        expect(res.status).toBe(429);
        expect(res.headers['retry-after']).toBe('60');
        expect(res.body.error._source).toBe('openai');
        expect(res.body.error._observer_note).toContain('rate limited');
    });

    it('intercepts 402 and enriches it with _source and _observer_note', async () => {
        const payload = { model: 'gpt-3.5-turbo', messages: [{ role: 'user', content: 'test' }] };
        const res = await request(proxyApp)
            .post('/v1/openai/chat/completions')
            .set('X-Test-Error-Status', '402')
            .send(payload);

        expect(res.status).toBe(402);
        expect(res.body.error._source).toBe('openai');
        expect(res.body.error._observer_note).toContain('insufficient credits');
    });
});
