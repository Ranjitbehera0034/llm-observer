import { initDb, seedPricing, seedDefaultApiKey, seedSyncProviders } from '@llm-observer/database';
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
import { initParsers } from './parsers/manager';
import { startLicenseRevalidation } from './licenseManager';
import { startTelemetry } from './telemetry';
import { createApp, createDashboardApp } from './app';
import './types';

// The app factories live in ./app and are re-exported so tests (and anything
// else) can build the real guard/route chain. Importing this module has no side
// effects: servers, timers and the database only start from main() below.
export { createApp, createDashboardApp } from './app';

// LLM_OBSERVER_* are the documented names; PROXY_PORT/DASHBOARD_PORT kept for backward compatibility
const PORT = process.env.LLM_OBSERVER_PROXY_PORT || process.env.PROXY_PORT || 4000;
const DASHBOARD_PORT = process.env.LLM_OBSERVER_PORT || process.env.DASHBOARD_PORT || 4001;
const HOST = process.env.LLM_OBSERVER_HOST || '127.0.0.1';

// --- Boot Sequence ---
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
        createApp().listen(Number(PORT), HOST, () => {
            console.log(`🚀 LLM Observer Proxy running on http://${HOST}:${PORT}`);
        });

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

    } catch (err) {
        console.error('Fatal Initialization Error:', err);
        process.exit(1);
    }
}

function main() {
    bootstrap();

    // FIX SEC-03: Bind to 127.0.0.1 by default — dashboard must not be reachable from LAN unless LLM_OBSERVER_HOST is set explicitly
    createDashboardApp().listen(Number(DASHBOARD_PORT), HOST, () => {
        console.log(`📊 Dashboard API running on http://${HOST}:${DASHBOARD_PORT}`);
    });
}

// Only start when run as the entry point (node dist/server.js, ts-node src/server.ts).
// LLM_OBSERVER_AUTOSTART=1 starts it when the bundle is require()d by another
// script (packages/proxy/scripts/build-sidecar.js traces dependencies that way).
if (require.main === module || process.env.LLM_OBSERVER_AUTOSTART === '1') {
    main();
}
