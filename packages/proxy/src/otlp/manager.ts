import type http from 'http';
import { getSetting } from '@llm-observer/database';
import { createReceiverServer, newStats, ReceiverStats, MAX_BODY_BYTES } from './receiver';

export { MAX_BODY_BYTES };

/** Setting that switches the receiver on. Anything but the string 'true' means off (the default). */
export const OTLP_SETTING = 'otlp_receiver_enabled';
export const DEFAULT_OTLP_PORT = 4318;
/** Loopback only. Not configurable: the receiver has no authentication. */
export const OTLP_HOST = '127.0.0.1';

export function resolveOtlpPort(env: NodeJS.ProcessEnv = process.env): number {
    const raw = env.LLM_OBSERVER_OTLP_PORT;
    if (raw === undefined || raw.trim() === '') return DEFAULT_OTLP_PORT;
    const port = Number(raw);
    return Number.isInteger(port) && port >= 1 && port <= 65535 ? port : DEFAULT_OTLP_PORT;
}

export interface OtlpStatus extends ReceiverStats {
    listening: boolean;
    host: string;
    port: number;
    endpoint: string;
    lastError: string | null;
}

export interface OtlpManagerOptions {
    /** Fixed port (tests). Default: LLM_OBSERVER_OTLP_PORT, else 4318, read each time the receiver starts. */
    port?: number;
    getSetting?: (key: string) => string | null;
}

export interface OtlpManager {
    /** Make the listener match the setting: start it when enabled, stop it when not. Never throws. */
    reconcile(): Promise<void>;
    stop(): Promise<void>;
    status(): OtlpStatus;
}

export function createOtlpManager(opts: OtlpManagerOptions = {}): OtlpManager {
    const read = opts.getSetting ?? getSetting;
    const stats = newStats();
    let server: http.Server | null = null;
    let boundPort = opts.port ?? resolveOtlpPort();
    let lastError: string | null = null;
    // start/stop calls are serialised so a quick on-off-on cannot interleave binds and closes
    let chain: Promise<void> = Promise.resolve();
    const enqueue = (fn: () => Promise<void>): Promise<void> => {
        const next = chain.then(fn, fn);
        chain = next.catch(() => undefined);
        return next;
    };

    const start = (): Promise<void> => new Promise(resolve => {
        const port = opts.port ?? resolveOtlpPort();
        const candidate = createReceiverServer(stats);
        candidate.once('error', (err: NodeJS.ErrnoException) => {
            lastError = err.code === 'EADDRINUSE'
                ? `Port ${port} on ${OTLP_HOST} is already in use (EADDRINUSE). Pick another with LLM_OBSERVER_OTLP_PORT.`
                : `Could not listen on ${OTLP_HOST}:${port}: ${err.message}`;
            console.error(`[OTLP] ${lastError}`);
            server = null;
            resolve();
        });
        candidate.listen(port, OTLP_HOST, () => {
            candidate.removeAllListeners('error');
            candidate.on('error', err => console.error('[OTLP] server error:', err.message));
            server = candidate;
            boundPort = port;
            lastError = null;
            console.log(`OTLP receiver listening on http://${OTLP_HOST}:${port} (opt-in; JSON only)`);
            resolve();
        });
    });

    const halt = (): Promise<void> => new Promise(resolve => {
        const s = server;
        server = null;
        if (!s) return resolve();
        s.close(() => resolve());
        (s as any).closeAllConnections?.();
    });

    return {
        reconcile: () => enqueue(async () => {
            let enabled = false;
            try {
                enabled = read(OTLP_SETTING) === 'true';
            } catch (err) {
                lastError = `Could not read the ${OTLP_SETTING} setting: ${(err as Error).message}`;
            }
            if (enabled && !server) await start();
            else if (!enabled && server) { await halt(); console.log('OTLP receiver stopped'); }
            else if (!enabled) lastError = null;
        }),
        stop: () => enqueue(halt),
        status: () => {
            const port = server ? boundPort : (opts.port ?? resolveOtlpPort());
            return { ...stats, listening: server !== null, host: OTLP_HOST, port, endpoint: `http://${OTLP_HOST}:${port}`, lastError };
        },
    };
}
