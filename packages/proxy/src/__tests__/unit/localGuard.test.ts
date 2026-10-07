/**
 * RM-5: Host/Origin guard on both ports, exercised through the real
 * createApp()/createDashboardApp() factories.
 */
import request from 'supertest';
import { initDb } from '@llm-observer/database';

jest.mock('../../proxy', () => ({
    ...jest.requireActual('../../proxy'),
    handleProxyRequest: (_req: any, res: any) => { res.status(200).json({ ok: true }); },
}));

import { createApp, createDashboardApp } from '../../app';

describe('RM-5 localGuard', () => {
    beforeAll(() => { initDb(':memory:'); });
    afterEach(() => {
        delete process.env.LLM_OBSERVER_ALLOWED_HOSTS;
        delete process.env.LLM_OBSERVER_ALLOWED_ORIGINS;
    });

    const dash = () => createDashboardApp();

    describe('Host header', () => {
        it.each(['localhost:4001', '127.0.0.1:4001', '[::1]:4001', 'localhost', 'LOCALHOST:4001'])('allows Host %s', async (host) => {
            const res = await request(dash()).get('/api/settings').set('Host', host);
            expect(res.status).toBe(200);
        });

        it.each(['evil.example', 'evil.example:4001', 'localhost.evil.com', '127.0.0.1.evil.com:4001', '192.168.1.5:4001', 'localhost@evil.com'])('rejects Host %s on the dashboard port', async (host) => {
            const res = await request(dash()).get('/api/settings').set('Host', host);
            expect([403, 421]).toContain(res.status);
            expect(res.body.error).toBeDefined();
        });

        it('rejects a rebinding Host on the proxy port, including /health', async () => {
            const res = await request(createApp()).get('/health').set('Host', 'rebind.evil.example:4000');
            expect([403, 421]).toContain(res.status);
            const ok = await request(createApp()).get('/health').set('Host', 'localhost:4000');
            expect(ok.status).toBe(200);
        });

        it('rejects a rebinding Host for static SPA routes too', async () => {
            const res = await request(dash()).get('/some/spa/route').set('Host', 'evil.example');
            expect([403, 421]).toContain(res.status);
        });

        it('honours LLM_OBSERVER_ALLOWED_HOSTS (with or without port, case-insensitive)', async () => {
            process.env.LLM_OBSERVER_ALLOWED_HOSTS = 'observer.lan, My-Box:4001';
            expect((await request(dash()).get('/api/settings').set('Host', 'observer.lan:4001')).status).toBe(200);
            expect((await request(dash()).get('/api/settings').set('Host', 'my-box')).status).toBe(200);
            expect([403, 421]).toContain((await request(dash()).get('/api/settings').set('Host', 'other.lan')).status);
        });
    });

    describe('Origin header', () => {
        const put = (origin?: string, host = 'localhost:4001') => {
            const r = request(dash()).put('/api/settings').set('Host', host).send({});
            return origin === undefined ? r : r.set('Origin', origin);
        };

        it('rejects a lookalike origin on PUT /api/settings', async () => {
            const res = await put('http://localhost.evil.com');
            expect(res.status).toBe(403);
        });

        it.each(['http://evil.com', 'http://localhost.evil.com:4001', 'https://localhost:4001', 'http://127.0.0.1.evil.com', 'null'])('rejects Origin %s', async (origin) => {
            expect((await put(origin)).status).toBe(403);
        });

        it.each([
            'http://localhost:4001', 'http://127.0.0.1:4001', 'http://localhost:5173', 'http://127.0.0.1:5173',
            'http://localhost:4000', 'tauri://localhost', 'http://tauri.localhost', 'https://tauri.localhost',
        ])('accepts Origin %s', async (origin) => {
            expect((await put(origin)).status).not.toBe(403);
        });

        it('accepts a same-origin request on a non-default port', async () => {
            const res = await put('http://localhost:4123', 'localhost:4123');
            expect(res.status).not.toBe(403);
        });

        it('accepts requests with no Origin (CLI, curl, SDKs)', async () => {
            const res = await put(undefined);
            expect(res.status).not.toBe(403);
        });

        it('rejects a cross-site browser request that hides its Origin', async () => {
            const res = await request(dash()).put('/api/settings').set('Host', 'localhost:4001').set('Sec-Fetch-Site', 'cross-site').send({});
            expect(res.status).toBe(403);
        });

        it('rejects a POST with a foreign Origin on the proxy port', async () => {
            const res = await request(createApp()).post('/v1/openai/chat/completions').set('Host', 'localhost:4000').set('Origin', 'http://evil.com').send({ model: 'gpt-4o', messages: [] });
            expect(res.status).toBe(403);
            const ok = await request(createApp()).post('/v1/openai/chat/completions').set('Host', 'localhost:4000').send({ model: 'gpt-4o', messages: [] });
            expect(ok.status).toBe(200);
        });

        it('honours LLM_OBSERVER_ALLOWED_ORIGINS', async () => {
            process.env.LLM_OBSERVER_ALLOWED_ORIGINS = 'https://observer.example';
            expect((await put('https://observer.example')).status).not.toBe(403);
        });

        it('lets the CORS preflight through for allowed origins and still answers Host checks', async () => {
            const res = await request(dash()).options('/api/settings').set('Host', 'localhost:4001').set('Origin', 'http://localhost:5173').set('Access-Control-Request-Method', 'PUT');
            expect(res.status).toBeLessThan(300);
            const bad = await request(dash()).options('/api/settings').set('Host', 'evil.example').set('Origin', 'http://localhost:5173').set('Access-Control-Request-Method', 'PUT');
            expect([403, 421]).toContain(bad.status);
        });
    });

    describe('SSE', () => {
        // The stream never ends, so assert only on the status line and abort.
        const status = (origin?: string): Promise<number> => new Promise((resolve, reject) => {
            const http = require('http');
            const server = dash().listen(0, '127.0.0.1', () => {
                const port = (server.address() as any).port;
                const headers: Record<string, string> = { Host: `localhost:${port}` };
                if (origin) headers.Origin = origin;
                const req = http.get({ hostname: '127.0.0.1', port, path: '/api/events', headers }, (res: any) => {
                    const code = res.statusCode;
                    req.destroy();
                    server.close();
                    resolve(code);
                });
                req.on('error', reject);
            });
        });

        it('rejects Origin: http://localhost.evil.com (substring match no longer passes)', async () => {
            expect(await status('http://localhost.evil.com')).toBe(403);
        });

        it('accepts the dashboard origin and requests with no Origin', async () => {
            expect(await status('http://localhost:4001')).toBe(200);
            expect(await status()).toBe(200);
        });
    });
});
