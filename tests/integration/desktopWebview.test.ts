/**
 * P1: the dashboard inside the desktop webview, in a real browser.
 *
 * The Tauri webview serves the production dashboard build from its own origin
 * (http://tauri.localhost on Windows, tauri://localhost on macOS/Linux) and the
 * Node sidecar answers on a loopback port. This test recreates the Windows shape
 * in headless Chromium: a static server stands in for Tauri's asset protocol
 * (including its index.html fallback for unknown paths), --host-resolver-rules maps
 * http://tauri.localhost (port 80, exactly the real origin) to it, and the real
 * built server (packages/proxy/dist/server.js) runs as the sidecar.
 *
 * What it cannot show: WKWebView / WebKitGTK behaviour for tauri://localhost
 * (Chromium cannot load that scheme) and https://tauri.localhost.
 *
 * Skips cleanly when Chromium, the dashboard build or the server build is absent.
 * Set LLM_OBSERVER_TEST_PORT_BASE to pick the ports (it uses base and base+1);
 * otherwise two free ports are chosen. Set CHROMIUM_PATH to use another browser.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import net from 'net';
import http from 'http';
import { spawn, type ChildProcess } from 'child_process';

const ROOT = path.resolve(__dirname, '../..');
const DASHBOARD_DIST = path.join(ROOT, 'packages/dashboard/dist');
const SERVER_JS = path.join(ROOT, 'packages/proxy/dist/server.js');

function findChromium(): string | undefined {
    const candidates: string[] = [];
    if (process.env.CHROMIUM_PATH) candidates.push(process.env.CHROMIUM_PATH);
    const browsers = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
    try {
        for (const d of fs.readdirSync(browsers).filter((n) => /^chromium-\d+$/.test(n))) {
            candidates.push(path.join(browsers, d, 'chrome-linux', 'chrome'));
        }
    } catch { /* no browsers dir */ }
    return candidates.find((c) => fs.existsSync(c));
}

async function loadPlaywright(): Promise<any | null> {
    try { return await import('playwright-core'); } catch { return null; }
}

function freePort(): Promise<number> {
    return new Promise((resolve, reject) => {
        const s = net.createServer();
        s.once('error', reject);
        s.listen(0, '127.0.0.1', () => { const p = (s.address() as net.AddressInfo).port; s.close(() => resolve(p)); });
    });
}

const chromiumPath = findChromium();
const buildsPresent = fs.existsSync(path.join(DASHBOARD_DIST, 'index.html')) && fs.existsSync(SERVER_JS);
const runnable = !!chromiumPath && buildsPresent;

const MIME: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };

describe.skipIf(!runnable)('P1 dashboard in the desktop webview (headless Chromium)', () => {
    let tmp: string;
    let apiPort: number;
    let staticPort: number;
    let sidecar: ChildProcess;
    let sidecarLog = '';
    let staticServer: http.Server;
    let browser: any;

    beforeAll(async () => {
        const pw = await loadPlaywright();
        if (!pw) throw new Error('playwright-core is not installed');
        const base = Number(process.env.LLM_OBSERVER_TEST_PORT_BASE);
        apiPort = base ? base : await freePort();
        staticPort = base ? base + 1 : await freePort();
        const proxyPort = base ? base + 2 : await freePort();
        tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'llmo-desktop-'));

        // Stand-in for Tauri's asset protocol: static files, index.html for unknown paths.
        staticServer = http.createServer((req, res) => {
            let file = path.join(DASHBOARD_DIST, decodeURIComponent((req.url || '/').split('?')[0]));
            if (!file.startsWith(DASHBOARD_DIST) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
                file = path.join(DASHBOARD_DIST, 'index.html');
            }
            res.setHeader('content-type', MIME[path.extname(file)] || 'application/octet-stream');
            res.end(fs.readFileSync(file));
        });
        await new Promise<void>((r) => staticServer.listen(staticPort, '127.0.0.1', r));

        sidecar = spawn(process.execPath, [SERVER_JS], {
            env: {
                PATH: process.env.PATH,
                HOME: tmp,
                USERPROFILE: tmp,
                LLM_OBSERVER_DATA_DIR: tmp,
                LLM_OBSERVER_PORT: String(apiPort),
                LLM_OBSERVER_PROXY_PORT: String(proxyPort),
            },
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        sidecar.stdout!.on('data', (d) => { sidecarLog += d; });
        sidecar.stderr!.on('data', (d) => { sidecarLog += d; });

        for (let i = 0; i < 80; i++) {
            try { if ((await fetch(`http://127.0.0.1:${apiPort}/api/settings`)).ok) break; } catch { /* not up yet */ }
            await new Promise((r) => setTimeout(r, 250));
        }

        browser = await pw.chromium.launch({
            executablePath: chromiumPath,
            args: [`--host-resolver-rules=MAP tauri.localhost 127.0.0.1:${staticPort}`, '--no-sandbox'],
        });
    }, 60_000);

    afterAll(async () => {
        await browser?.close();
        if (sidecar && sidecar.exitCode === null) {
            sidecar.kill('SIGTERM');
            await new Promise((r) => { sidecar.once('exit', r); setTimeout(r, 5000); });
        }
        await new Promise<void>((r) => (staticServer ? staticServer.close(() => r()) : r()));
        if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
    });

    async function openPage(url: string, injectBase?: string) {
        const page = await browser.newPage();
        const api: { url: string; status: number; acao?: string; type?: string }[] = [];
        const failed: string[] = [];
        const consoleErrors: string[] = [];
        page.on('response', async (r: any) => {
            if (/\/api\//.test(r.url())) {
                const h = await r.allHeaders();
                api.push({ url: r.url(), status: r.status(), acao: h['access-control-allow-origin'], type: h['content-type'] });
            }
        });
        page.on('requestfailed', (r: any) => { if (/\/api\//.test(r.url())) failed.push(`${r.method()} ${r.url()} ${r.failure()?.errorText}`); });
        page.on('console', (m: any) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
        if (injectBase) await page.addInitScript((b: string) => { (window as any).__LLM_OBSERVER_API_BASE__ = b; }, injectBase);
        await page.goto(url);
        return { page, api, failed, consoleErrors };
    }

    it('calls the sidecar by absolute loopback URL and gets JSON back (Windows-shaped origin http://tauri.localhost)', async () => {
        const { page, api, failed, consoleErrors } = await openPage('http://tauri.localhost/', `http://127.0.0.1:${apiPort}`);
        try {
            await page.waitForResponse((r: any) => r.url().includes('/api/overview?period=today'), { timeout: 15_000 });
            await page.waitForTimeout(1500);
            expect(await page.evaluate(() => location.origin)).toBe('http://tauri.localhost');
            expect(api.length).toBeGreaterThan(5);
            expect(api.filter((a) => a.url.startsWith('http://tauri.localhost'))).toEqual([]);
            for (const a of api) {
                expect(a.url).toMatch(new RegExp(`^http://127\\.0\\.0\\.1:${apiPort}/api/`));
                expect(a.status).toBe(200);
                expect(a.type).toMatch(/application\/json/);
                expect(a.acao).toBe('http://tauri.localhost');
            }
            expect(failed).toEqual([]);
            expect(consoleErrors.filter((e) => /Failed to fetch|not valid JSON|CORS|blocked/i.test(e))).toEqual([]);
        } finally {
            await page.close();
        }
    }, 40_000);

    it('falls back to the documented default port when the shell injects nothing', async () => {
        // The default is 4001. Nothing listens there in this test, so requests must
        // target it (and fail) rather than silently hit the static origin.
        const { page, api, failed } = await openPage('http://tauri.localhost/');
        try {
            await page.waitForTimeout(2500);
            expect(api.filter((a) => a.url.startsWith('http://tauri.localhost'))).toEqual([]);
            expect(failed.length + api.length).toBeGreaterThan(0);
            for (const f of failed) expect(f).toContain('http://127.0.0.1:4001/api/');
            for (const a of api) expect(a.url).toMatch(/^http:\/\/127\.0\.0\.1:4001\/api\//);
        } finally {
            await page.close();
        }
    }, 30_000);

    it('opens the live event stream and can write (SSE and POST carry the Origin check)', async () => {
        const { page, api } = await openPage('http://tauri.localhost/requests', `http://127.0.0.1:${apiPort}`);
        try {
            await page.waitForResponse((r: any) => r.url().endsWith('/api/events'), { timeout: 15_000 });
            const sse = api.find((a) => a.url.endsWith('/api/events'));
            expect(sse?.status ?? 200).toBe(200);
            const post = await page.evaluate(async (base: string) => {
                const r = await fetch(`${base}/api/alerts/acknowledge-all`, { method: 'POST' });
                return r.status;
            }, `http://127.0.0.1:${apiPort}`);
            expect([200, 204]).toContain(post);
        } finally {
            await page.close();
        }
    }, 40_000);

    it('still refuses look-alike origins on the same server', async () => {
        const status = (origin: string) => new Promise<number>((resolve, reject) => {
            const req = http.request({ host: '127.0.0.1', port: apiPort, path: '/api/alerts/acknowledge-all', method: 'POST', headers: { Origin: origin } },
                (res) => { res.resume(); resolve(res.statusCode || 0); });
            req.on('error', reject);
            req.end();
        });
        expect([200, 204]).toContain(await status('http://tauri.localhost'));
        expect(await status('http://tauri.localhost.evil.example')).toBe(403);
        expect(await status('http://evil.example')).toBe(403);
    });

    it('control: the same build opened from the server itself keeps using relative URLs', async () => {
        const { page, api, failed } = await openPage(`http://127.0.0.1:${apiPort}/`);
        try {
            await page.waitForResponse((r: any) => r.url().includes('/api/overview?period=today'), { timeout: 15_000 });
            await page.waitForTimeout(1000);
            expect(api.length).toBeGreaterThan(5);
            for (const a of api) {
                expect(a.url.startsWith(`http://127.0.0.1:${apiPort}/api/`)).toBe(true);
                expect(a.status).toBe(200);
                expect(a.acao).toBeUndefined(); // same origin: no CORS involved
            }
            expect(failed).toEqual([]);
        } finally {
            await page.close();
        }
    }, 40_000);

    it('keeps the sidecar log free of crashes', () => {
        expect(sidecarLog).not.toMatch(/Fatal|EADDRINUSE|Cannot find module/);
    });
});
