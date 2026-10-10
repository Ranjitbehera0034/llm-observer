/**
 * The team-admin token lives in sessionStorage only: it goes away when the tab closes, and it is only ever
 * sent to this app's own /api/team/rollup route, which forwards it to the configured team server.
 * Storage can throw (private windows, blocked site data), so every access is guarded.
 */
const KEY = 'llmo_team_admin_token';

export function readAdminToken(): string | null {
    try { return window.sessionStorage.getItem(KEY); } catch { return null; }
}

export function saveAdminToken(token: string): void {
    try { window.sessionStorage.setItem(KEY, token); } catch { /* keep it in memory only */ }
}

export function forgetAdminToken(): void {
    try { window.sessionStorage.removeItem(KEY); } catch { /* nothing to do */ }
}
