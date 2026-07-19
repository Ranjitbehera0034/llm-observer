// In dev, Vite serves the UI on :5173 while the API runs separately on :4001.
// In production the API server serves the dashboard itself, so same-origin
// relative URLs must be used — the user may run on any port (LLM_OBSERVER_PORT).
export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL
    || (import.meta.env.DEV ? 'http://localhost:4001' : '');
