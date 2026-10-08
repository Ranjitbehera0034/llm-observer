import { resolveApiBase } from './apiBase';

// - vite dev: the UI is on :5173, the API runs separately on :4001.
// - browser / npm / Docker production build: the API server serves the dashboard
//   itself, so same-origin relative URLs must be used; the user may run on any
//   port (LLM_OBSERVER_PORT).
// - desktop app: the webview serves static files only; the API is the bundled
//   sidecar on loopback. The shell injects its port as window.__LLM_OBSERVER_API_BASE__
//   (default http://127.0.0.1:4001). See docs/guide/desktop.md.
export const API_BASE_URL = resolveApiBase({
    envBase: import.meta.env.VITE_API_BASE_URL,
    dev: import.meta.env.DEV,
    location: typeof window !== 'undefined' ? window.location : undefined,
    injected: typeof window !== 'undefined'
        ? (window as unknown as { __LLM_OBSERVER_API_BASE__?: unknown }).__LLM_OBSERVER_API_BASE__
        : undefined,
});
