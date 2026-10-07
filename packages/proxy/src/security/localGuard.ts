import type { NextFunction, Request, Response } from 'express';

/**
 * Host/Origin guard for the local servers (:4000 proxy and :4001 dashboard).
 *
 * The loopback bind and the CORS allowlist are not enough on their own: CORS
 * only stops a page from READING a response, it does not stop the request from
 * executing, and a DNS-rebinding page is same-origin from the browser's point
 * of view. So:
 *
 *  - Host must be localhost, 127.0.0.1 or [::1] (or listed in
 *    LLM_OBSERVER_ALLOWED_HOSTS). A rebinding attack arrives with the attacker's
 *    hostname in Host and is refused with 421, which also covers GETs that read
 *    prompts, settings and the licence key.
 *  - State-changing requests (anything but GET/HEAD/OPTIONS) and the SSE stream
 *    must carry an Origin that is an exact match for a known local origin (or the
 *    server's own origin). A request with no Origin at all is a non-browser client
 *    (CLI, curl, SDKs) and is allowed, unless the browser says it is cross-site.
 */

const LOOPBACK_HOSTS = ['localhost', '127.0.0.1', '[::1]'];

// Origins the bundled clients run from. The desktop webview is tauri://localhost
// on macOS/Linux and http(s)://tauri.localhost on Windows; 5173 is the vite dev server.
const TAURI_ORIGINS = ['tauri://localhost', 'http://tauri.localhost', 'https://tauri.localhost'];
const VITE_DEV_PORT = 5173;

const SSE_PATH = /^\/api\/(?:requests\/)?events\/?$/;
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function envList(name: string): string[] {
    return (process.env[name] || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
}

/** "Host:4001" / "[::1]:4001" / "host." -> lowercase hostname without port. */
function hostnameOf(hostHeader: string): string | null {
    const h = hostHeader.trim().toLowerCase();
    if (!h || /[\s/\\@?#]/.test(h)) return null;
    const m = h.startsWith('[') ? /^(\[[0-9a-f:.]+\])(?::\d{1,5})?$/.exec(h) : /^([^:]+)(?::\d{1,5})?$/.exec(h);
    if (!m) return null;
    return m[1].replace(/\.$/, '');
}

function ports(): number[] {
    const proxy = Number(process.env.LLM_OBSERVER_PROXY_PORT || process.env.PROXY_PORT || 4000);
    const dashboard = Number(process.env.LLM_OBSERVER_PORT || process.env.DASHBOARD_PORT || 4001);
    return [proxy, dashboard, VITE_DEV_PORT].filter((p) => Number.isInteger(p) && p > 0);
}

function allowedHostnames(): Set<string> {
    const hosts = new Set<string>(LOOPBACK_HOSTS);
    for (const entry of envList('LLM_OBSERVER_ALLOWED_HOSTS')) {
        const name = hostnameOf(entry);
        if (name) hosts.add(name);
    }
    // An explicit, specific bind address (LLM_OBSERVER_HOST=192.168.1.5) is the
    // user opting in to being reached by that name.
    const bind = (process.env.LLM_OBSERVER_HOST || '').trim().toLowerCase();
    if (bind && bind !== '0.0.0.0' && bind !== '::') {
        const name = hostnameOf(bind.includes(':') && !bind.startsWith('[') ? `[${bind}]` : bind);
        if (name) hosts.add(name);
    }
    return hosts;
}

export function isHostAllowed(hostHeader: string | undefined): boolean {
    if (!hostHeader) return false;
    const name = hostnameOf(hostHeader);
    return name !== null && allowedHostnames().has(name);
}

function allowedOrigins(): Set<string> {
    const origins = new Set<string>(TAURI_ORIGINS);
    for (const host of allowedHostnames()) {
        for (const port of ports()) origins.add(`http://${host}:${port}`);
    }
    if (process.env.DASHBOARD_URL) origins.add(process.env.DASHBOARD_URL.replace(/\/+$/, ''));
    for (const o of envList('LLM_OBSERVER_ALLOWED_ORIGINS')) origins.add(o.replace(/\/+$/, ''));
    return origins;
}

/**
 * Exact-match Origin check. `hostHeader` is the (already validated) Host of the
 * request, so the server's own origin is accepted on any port.
 */
export function isOriginAllowed(origin: string, hostHeader?: string): boolean {
    if (!origin || origin === 'null') return false;
    const o = origin.trim().toLowerCase();
    if (allowedOrigins().has(o)) return true;
    return !!hostHeader && isHostAllowed(hostHeader) && o === `http://${hostHeader.trim().toLowerCase()}`;
}

/** Does this request carry an acceptable Origin (or none, from a non-browser client)? */
export function isRequestOriginOk(req: Pick<Request, 'headers'>): boolean {
    const origin = req.headers.origin;
    if (origin === undefined) return req.headers['sec-fetch-site'] !== 'cross-site';
    return isOriginAllowed(String(origin), req.headers.host);
}

function needsOriginCheck(req: Request): boolean {
    return !SAFE_METHODS.has(req.method) || SSE_PATH.test(req.path);
}

export function localGuard(req: Request, res: Response, next: NextFunction): void {
    if (!isHostAllowed(req.headers.host)) {
        res.status(421).json({
            error: 'Host not allowed. LLM Observer only answers to localhost, 127.0.0.1 and [::1]; ' +
                'add other names to LLM_OBSERVER_ALLOWED_HOSTS (comma-separated).',
        });
        return;
    }
    // Preflights carry no credentials and are answered by the CORS allowlist.
    if (req.method !== 'OPTIONS' && needsOriginCheck(req) && !isRequestOriginOk(req)) {
        res.status(403).json({ error: 'Origin not allowed.' });
        return;
    }
    next();
}
