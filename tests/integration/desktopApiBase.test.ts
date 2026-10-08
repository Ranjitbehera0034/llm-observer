/**
 * P1: how the dashboard decides where /api lives.
 *  - npm / Docker / browser build: same origin (relative URLs, any port)
 *  - desktop webview (tauri://localhost, http(s)://tauri.localhost): an absolute
 *    loopback URL, because the webview's own origin serves only static files
 *  - vite dev server: the local API on :4001
 */
import { describe, it, expect } from 'vitest';
import { resolveApiBase, isDesktopWebview, DEFAULT_DESKTOP_API_BASE } from '../../packages/dashboard/src/apiBase';

const loc = (protocol: string, hostname: string) => ({ protocol, hostname });

describe('isDesktopWebview', () => {
    it.each([
        ['tauri:', 'localhost'],
        ['http:', 'tauri.localhost'],
        ['https:', 'tauri.localhost'],
    ])('recognises %s//%s', (protocol, hostname) => {
        expect(isDesktopWebview(loc(protocol, hostname))).toBe(true);
    });

    it.each([
        ['http:', 'localhost'],
        ['http:', '127.0.0.1'],
        ['https:', 'dashboard.example.com'],
        ['http:', 'tauri.localhost.evil.example'],
        ['tauri:', 'evil.example'],
        ['file:', ''],
    ])('does not treat %s//%s as the desktop app', (protocol, hostname) => {
        expect(isDesktopWebview(loc(protocol, hostname))).toBe(false);
    });

    it('is false without a location (SSR, tests)', () => {
        expect(isDesktopWebview(undefined)).toBe(false);
    });
});

describe('resolveApiBase', () => {
    it('uses same-origin relative URLs in a normal production browser build', () => {
        expect(resolveApiBase({ location: loc('http:', 'localhost') })).toBe('');
        expect(resolveApiBase({ location: loc('http:', '127.0.0.1') })).toBe('');
        expect(resolveApiBase({ location: loc('https:', 'obs.example.com') })).toBe('');
    });

    it('ignores an injected value outside the desktop webview', () => {
        expect(resolveApiBase({ location: loc('http:', 'localhost'), injected: 'http://127.0.0.1:9999' })).toBe('');
    });

    it('uses an absolute loopback URL in the desktop webview, with a documented default port', () => {
        expect(DEFAULT_DESKTOP_API_BASE).toBe('http://127.0.0.1:4001');
        for (const l of [loc('tauri:', 'localhost'), loc('http:', 'tauri.localhost'), loc('https:', 'tauri.localhost')]) {
            expect(resolveApiBase({ location: l })).toBe(DEFAULT_DESKTOP_API_BASE);
        }
    });

    it('uses the base the desktop shell injected', () => {
        expect(resolveApiBase({ location: loc('tauri:', 'localhost'), injected: 'http://127.0.0.1:16002' }))
            .toBe('http://127.0.0.1:16002');
        expect(resolveApiBase({ location: loc('tauri:', 'localhost'), injected: 'http://localhost:4010/' }))
            .toBe('http://localhost:4010');
        expect(resolveApiBase({ location: loc('tauri:', 'localhost'), injected: 'http://[::1]:4010' }))
            .toBe('http://[::1]:4010');
    });

    it.each([
        'https://evil.example',
        'http://evil.example:4001',
        'http://127.0.0.1.evil.example:4001',
        'http://127.0.0.1',
        'http://127.0.0.1:4001/api',
        'javascript:alert(1)',
        '',
        42,
        null,
        { toString: () => 'http://127.0.0.1:4001' },
    ])('never trusts an injected value that is not a loopback origin with a port: %j', (injected) => {
        expect(resolveApiBase({ location: loc('tauri:', 'localhost'), injected })).toBe(DEFAULT_DESKTOP_API_BASE);
    });

    it('lets an explicit build-time VITE_API_BASE_URL win everywhere', () => {
        expect(resolveApiBase({ envBase: 'http://api.test:1', location: loc('tauri:', 'localhost') })).toBe('http://api.test:1');
        expect(resolveApiBase({ envBase: 'http://api.test:1', location: loc('http:', 'localhost') })).toBe('http://api.test:1');
    });

    it('points the vite dev server at the local API', () => {
        expect(resolveApiBase({ dev: true, location: loc('http:', 'localhost') })).toBe('http://localhost:4001');
    });
});
