// Where the dashboard's /api calls go. Pure (no import.meta, no window) so the
// rules can be unit-tested from the repo root; config.ts feeds it the real inputs.

/** Port the desktop app's bundled server listens on unless LLM_OBSERVER_PORT says otherwise. */
export const DEFAULT_DESKTOP_API_BASE = 'http://127.0.0.1:4001';

export interface ApiBaseInput {
    /** VITE_API_BASE_URL, set at build time. Wins over everything. */
    envBase?: string;
    /** True under `vite dev`. */
    dev?: boolean;
    /** window.location (protocol and hostname are all that is read). */
    location?: { protocol: string; hostname: string };
    /** window.__LLM_OBSERVER_API_BASE__, set by the desktop shell before the page loads. */
    injected?: unknown;
}

/**
 * The Tauri webview serves the dashboard's static files from its own origin:
 * tauri://localhost on macOS and Linux, http(s)://tauri.localhost on Windows.
 * Relative /api URLs would land on that static host, not on the Node sidecar.
 */
export function isDesktopWebview(location?: { protocol: string; hostname: string }): boolean {
    if (!location) return false;
    if (location.protocol === 'tauri:') return location.hostname === 'localhost';
    return (location.protocol === 'http:' || location.protocol === 'https:') && location.hostname === 'tauri.localhost';
}

// The shell may only point the page at this machine's loopback, with an explicit port.
const LOOPBACK_ORIGIN = /^http:\/\/(?:127\.0\.0\.1|localhost|\[::1\]):\d{1,5}\/?$/;

export function resolveApiBase(input: ApiBaseInput): string {
    if (input.envBase) return input.envBase;
    if (input.dev) return 'http://localhost:4001';
    if (isDesktopWebview(input.location)) {
        if (typeof input.injected === 'string' && LOOPBACK_ORIGIN.test(input.injected)) {
            return input.injected.replace(/\/+$/, '');
        }
        return DEFAULT_DESKTOP_API_BASE;
    }
    // npm, Docker, any browser: the server that served this page also serves /api,
    // on whatever port the user configured.
    return '';
}
