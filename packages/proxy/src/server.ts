import type { Server } from 'http';
import { initDb, closeDb, seedPricing, seedDefaultApiKey, seedSyncProviders } from '@llm-observer/database';
import { initPricingCache } from './utils/pricing';
import { startAnomalyDetection } from './anomalyDetector';
import { startRetentionCleanup } from './retentionManager';
import { startCostOptimizer } from './costOptimizer';
import { startStatsAggregation } from './utils/statsAggregator';
import { startRateLimitPoller } from './rate-limits/poller';
import { startRateLimitPersistence } from './rateLimitGuard';
import { syncManager } from './syncManager';
import { usageSyncManager } from './sync';
import { networkMonitor } from './services/networkMonitor';
import { initParsers, stopParsers } from './parsers/manager';
import { startLicenseRevalidation } from './licenseManager';
import { startTelemetry } from './telemetry';
import { createApp, createDashboardApp } from './app';
import { internalLogger } from './internalLogger';
import { initOtlpReceiver, shutdownOtlp } from './otlp';
import './types';

// The app factories live in ./app and are re-exported so tests (and anything
// else) can build the real guard/route chain. Importing this module has no side
// effects: servers, timers and the database only start from main() below.
export { createApp, createDashboardApp } from './app';

// LLM_OBSERVER_* are the documented names; PROXY_PORT/DASHBOARD_PORT kept for backward compatibility
const PORT = process.env.LLM_OBSERVER_PROXY_PORT || process.env.PROXY_PORT || 4000;
const DASHBOARD_PORT = process.env.LLM_OBSERVER_PORT || process.env.DASHBOARD_PORT || 4001;
const HOST = process.env.LLM_OBSERVER_HOST || '127.0.0.1';

const SHUTDOWN_GRACE_MS = 5000;

/**
 * Listen, and turn a bind failure into an actionable message instead of an
 * unhandled 'error' event. A busy port exits non-zero so supervisors notice.
 */
export function listenOrExit(
    app: { listen: (port: number, host: string, cb: () => void) => Server },
    label: string,
    port: number,
    host: string,
    envVar: string,
    onListening: () => void,
    exit: (code: number) => void = (code) => process.exit(code)
): Server {
    const server = app.listen(port, host, onListening);
    server.once('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'EADDRINUSE') {
            console.error(
                `${label} cannot start: port ${port} on ${host} is already in use. ` +
                `Another LLM Observer (or a different program) is listening there. ` +
                `Stop it (run "llm-observer stop"), or choose a free port with ${envVar}=<port>.`
            );
        } else {
            console.error(`${label} failed to listen on ${host}:${port}: ${err.message}`);
        }
        exit(1);
    });
    return server;
}

export interface ShutdownDeps {
    servers: Server[];
    flush: () => Promise<void>;
    closeDatabase: () => void;
    exit: (code: number) => void;
    graceMs?: number;
}

/**
 * Build a once-only shutdown routine: stop accepting connections, flush queued
 * request rows to SQLite, close the database (checkpointing the WAL), then exit.
 * A hard timer guarantees exit even if a keep-alive connection never drains.
 */
export function createShutdownHandler(deps: ShutdownDeps): (signal: string) => Promise<void> {
    let started = false;
    return async (signal: string) => {
        if (started) return;
        started = true;
        console.log(`Received ${signal}, flushing and shutting down...`);

        const hardExit = setTimeout(() => {
            console.error('Shutdown timed out; exiting.');
            deps.exit(1);
        }, deps.graceMs ?? SHUTDOWN_GRACE_MS);
        hardExit.unref?.();

        let code = 0;
        // Stop accepting new connections; do not wait on open ones, the flush matters more.
        for (const server of deps.servers) {
            try { server.close(); } catch { /* not listening */ }
            (server as any).closeIdleConnections?.();
        }
        try {
            await deps.flush();
        } catch (err) {
            console.error('Failed to flush queued requests on shutdown:', err);
            code = 1;
        }
        try {
            deps.closeDatabase();
        } catch (err) {
            console.error('Failed to close database on shutdown:', err);
            code = 1;
        }
        clearTimeout(hardExit);
        deps.exit(code);
    };
}

// --- Boot Sequence ---
const servers: Server[] = [];

function bootstrap() {
    try {
        // 1. Initialize DB and run migrations FIRST
        const db = initDb();
        console.log('Database schema initialized successfully.');

        // 2. Refresh bundled default pricing, Remote Registry & Auth
        seedPricing();
        seedSyncProviders();
        initPricingCache();
        seedDefaultApiKey();
        console.log('Pricing engine and Auth ready.');

        // 3. Ensure a default project exists for MVP usability
        const row = db.prepare('SELECT count(*) as count FROM projects WHERE id = ?').get('default') as any;
        if (row.count === 0) {
            db.prepare(`INSERT INTO projects (id, name, daily_budget) VALUES (?, ?, ?)`).run('default', 'Default Project', 5.0);
        }

        // 4. Start accepting Proxy Traffic
        servers.push(listenOrExit(createApp(), 'LLM Observer Proxy', Number(PORT), HOST, 'LLM_OBSERVER_PROXY_PORT', () => {
            console.log(`🚀 LLM Observer Proxy running on http://${HOST}:${PORT}`);
        }));

        // 5. Start background tasks
        startRateLimitPersistence();
        startAnomalyDetection();
        startRetentionCleanup();
        startCostOptimizer();
        startStatsAggregation();
        startRateLimitPoller();
        syncManager.start();
        usageSyncManager.start();
        networkMonitor.start();
        initParsers();
        startLicenseRevalidation();
        startTelemetry();
        // Opt-in (otlp_receiver_enabled, off by default); a no-op unless the user turned it on
        void initOtlpReceiver();

    } catch (err) {
        console.error('Fatal Initialization Error:', err);
        process.exit(1);
    }
}

function main() {
    bootstrap();

    // FIX SEC-03: Bind to 127.0.0.1 by default — dashboard must not be reachable from LAN unless LLM_OBSERVER_HOST is set explicitly
    servers.push(listenOrExit(createDashboardApp(), 'LLM Observer Dashboard', Number(DASHBOARD_PORT), HOST, 'LLM_OBSERVER_PORT', () => {
        console.log(`📊 Dashboard API running on http://${HOST}:${DASHBOARD_PORT}`);
    }));

    installSignalHandlers();
}

/**
 * Shutdown work before the database closes: flush queued request logs and stop the parsers. They run in
 * parallel so a parse that is slow to finish (stopParsers waits at most a few seconds) can never delay the
 * flush, which is the data that matters. A parser failure is logged, a flush failure is thrown.
 */
export async function flushOnShutdown(): Promise<void> {
    const stopping = stopParsers().catch(err => { console.error('Failed to stop parsers on shutdown:', err); });
    try {
        await internalLogger.flush();
    } finally {
        await stopping;
    }
}

/**
 * Wires SIGTERM/SIGINT to the shutdown handler with the real logger flush and
 * database close. `proc` and `exit` are injectable so a test can drive it
 * without signalling the Jest process.
 */
export function installSignalHandlers(
    proc: { on(signal: 'SIGTERM' | 'SIGINT', listener: () => void): unknown } = process,
    exit: (code: number) => void = (code) => process.exit(code),
): void {
    const shutdown = createShutdownHandler({
        servers,
        flush: async () => {
            // A failing receiver shutdown must never keep the queued request logs from being written.
            try { await shutdownOtlp(); } catch (err) { console.error('Failed to stop the OTLP receiver on shutdown:', err); }
            await flushOnShutdown();
        },
        closeDatabase: closeDb,
        exit,
    });
    proc.on('SIGTERM', () => { void shutdown('SIGTERM'); });
    proc.on('SIGINT', () => { void shutdown('SIGINT'); });
}

// Only start when run as the entry point (node dist/server.js, ts-node src/server.ts).
// LLM_OBSERVER_AUTOSTART=1 starts it when the bundle is require()d by another
// script (packages/proxy/scripts/build-sidecar.js traces dependencies that way).
if (require.main === module || process.env.LLM_OBSERVER_AUTOSTART === '1') {
    main();
}
