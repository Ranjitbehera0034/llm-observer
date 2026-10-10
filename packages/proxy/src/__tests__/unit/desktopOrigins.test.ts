/**
 * P1: the desktop webview talks to the local server cross-origin. The page
 * origin is tauri://localhost (macOS, Linux) or http(s)://tauri.localhost
 * (Windows), the API is http://127.0.0.1:<port>. The Host/Origin guard has to
 * let exactly those origins through, and CORS has to answer them, otherwise the
 * browser blocks every response even though the server executed the request.
 */
import request from 'supertest';
import { initDb } from '@llm-observer/database';
import { isOriginAllowed } from '../../security/localGuard';
import { createApp, createDashboardApp } from '../../app';

const DESKTOP_ORIGINS = ['tauri://localhost', 'http://tauri.localhost', 'https://tauri.localhost'];

const NOT_DESKTOP_ORIGINS = [
    'tauri://localhost.evil.example',
    'tauri://evil.example',
    'tauri://localhost:1420',
    'http://tauri.localhost.evil.example',
    'http://evil.tauri.localhost',
    'http://tauri.localhost:4001',
    'https://tauri.localhost:8443',
    'http://localhost.evil.example',
    'ftp://tauri.localhost',
    'null',
];

describe('P1 desktop webview origins', () => {
    beforeAll(() => { initDb(':memory:'); });

    describe.each(DESKTOP_ORIGINS)('origin %s', (origin) => {
        it('is accepted by the guard', () => {
            expect(isOriginAllowed(origin, '127.0.0.1:4001')).toBe(true);
        });

        it.each([
            ['dashboard port', () => createDashboardApp(), '/api/settings'],
            ['proxy port', () => createApp(), '/health'],
        ])('gets a CORS answer for a GET on the %s', async (_name, make, path) => {
            const res = await request(make()).get(path).set('Host', '127.0.0.1:4001').set('Origin', origin);
            expect(res.status).toBe(200);
            expect(res.headers['access-control-allow-origin']).toBe(origin);
        });

        it('answers a preflight for a JSON POST/DELETE', async () => {
            const res = await request(createDashboardApp())
                .options('/api/settings')
                .set('Host', '127.0.0.1:4001')
                .set('Origin', origin)
                .set('Access-Control-Request-Method', 'DELETE')
                .set('Access-Control-Request-Headers', 'content-type');
            expect(res.status).toBe(204);
            expect(res.headers['access-control-allow-origin']).toBe(origin);
            expect(res.headers['access-control-allow-methods']).toMatch(/DELETE/);
            expect(res.headers['access-control-allow-headers']).toMatch(/content-type/i);
        });

        it('may send a state-changing request', async () => {
            const res = await request(createDashboardApp())
                .post('/api/alerts/acknowledge-all')
                .set('Host', '127.0.0.1:4001')
                .set('Origin', origin);
            expect(res.status).not.toBe(403);
            expect(res.status).not.toBe(421);
            expect(res.headers['access-control-allow-origin']).toBe(origin);
        });
    });

    describe.each(NOT_DESKTOP_ORIGINS)('origin %s', (origin) => {
        it('is refused by the guard', () => {
            expect(isOriginAllowed(origin, '127.0.0.1:4001')).toBe(false);
        });

        it('gets no CORS grant on a GET and is refused on a POST', async () => {
            const get = await request(createDashboardApp()).get('/api/settings').set('Host', '127.0.0.1:4001').set('Origin', origin);
            expect(get.headers['access-control-allow-origin']).toBeUndefined();
            const post = await request(createDashboardApp()).post('/api/alerts/acknowledge-all').set('Host', '127.0.0.1:4001').set('Origin', origin);
            expect(post.status).toBe(403);
        });
    });

    it('still refuses a rebinding Host even when the Origin is a desktop origin', async () => {
        const res = await request(createDashboardApp())
            .get('/api/settings')
            .set('Host', 'rebind.evil.example:4001')
            .set('Origin', 'tauri://localhost');
        expect(res.status).toBe(421);
    });
});
