import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { handleProxyRequest } from './proxy';
import { initDb, seedPricing, getDb, seedDefaultApiKey } from '@llm-observer/database';
import { initPricingCache } from './utils/pricing';
import { GoogleProvider } from './providers/google';
import { budgetGuard } from './budgetGuard';
import { rateLimitGuard } from './rateLimitGuard';
import { startAnomalyDetection } from './anomalyDetector';
import { startRetentionCleanup } from './retentionManager';
import { startCostOptimizer } from './costOptimizer';
import { startStatsAggregation } from './utils/statsAggregator';
import { syncManager } from './syncManager';
import { usageSyncManager } from './sync';
import './types';

const app = express();

const corsOptions = {
    origin: ['http://localhost:5173', 'http://127.0.0.1:5173', 'http://localhost:4001', 'http://127.0.0.1:4001', process.env.DASHBOARD_URL].filter(Boolean) as string[],
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-api-key']
};

app.use(cors(corsOptions));

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'ok', service: 'llm-observer-proxy' });
});

// We need JSON to parse the models, but we need to forward it carefully
// FIX SEC-06: Reduced from 50MB to prevent memory-exhaustion DoS
app.use(express.json({ limit: '5mb' }));

// Apply budget guard globally before proxying
app.use(budgetGuard);
// Apply rate limit guard globally before proxying
app.use(rateLimitGuard);

// Route handlers based on provider path
app.all('/v1/openai/*', (req, res) => {
    // Strip /v1/openai from the path if needed, wait, OpenAI base url doesn't include the path.
    // Actually, target URL is "https://api.openai.com". The path will be appended.
    // `req.url` includes `/v1/openai/...`, so we need to rewrite it:
    req.url = req.url.replace('/v1/openai', '/v1');
    handleProxyRequest(req, res, 'openai');
});

app.all('/v1/anthropic/*', (req, res) => {
    req.url = req.url.replace('/v1/anthropic', '/v1');
    handleProxyRequest(req, res, 'anthropic');
});

app.all('/v1/google/*', (req, res) => {
    req.url = req.url.replace('/v1/google', '/v1beta'); // Map to correct API version
    handleProxyRequest(req, res, 'google');
});

app.all('/v1/mistral/*', (req, res) => {
    req.url = req.url.replace('/v1/mistral', '/v1');
    handleProxyRequest(req, res, 'mistral');
});

app.all('/v1/groq/*', (req, res) => {
    // Groq's OpenAI-compatible API lives at api.groq.com/openai/v1/*
    // The provider base URL already includes /openai, so we map /v1/groq → /v1
    req.url = req.url.replace('/v1/groq', '/v1');
    handleProxyRequest(req, res, 'groq');
});

// Custom/Local provider route
// Example: http://localhost:4000/v1/custom/http%3A%2F%2Flocalhost%3A11434/v1/chat/completions
app.all('/v1/custom/:targetBaseUrl/*', (req, res) => {
    const encodedUrl = req.params.targetBaseUrl;
    try {
        const decodedUrl = decodeURIComponent(encodedUrl);
        // The rest of the path is in req.url after the parameter
        // Original req.url like: /v1/custom/http%3A%2F%2Flocalhost%3A11434/v1/chat/completions
        // We want to rewrite req.url to just the suffix
        req.url = req.url.replace(`/v1/custom/${encodedUrl}`, '');

        // Pass the target URL through req object
        req.customTargetUrl = decodedUrl;
        handleProxyRequest(req, res, 'custom');
    } catch (e) {
        res.status(400).json({ error: 'Invalid targetBaseUrl encoding' });
    }
});

const PORT = process.env.PROXY_PORT || 4000;
const DASHBOARD_PORT = process.env.DASHBOARD_PORT || 4001;

import { dashboardApi } from './dashboardApi';

// Create a separate app for the dashboard API
const dashboardApp = express();
dashboardApp.use(cors(corsOptions));
dashboardApp.use(express.json());
// Mount the dashboard API router
dashboardApp.use('/api', dashboardApi);

// Import and register sync routes
import syncRoutes from './routes/sync.routes';
import subscriptionRoutes from './routes/subscriptions.routes';
import overviewRoutes from './routes/overview.routes';

dashboardApp.use('/api/sync', syncRoutes);
dashboardApp.use('/api/subscriptions', subscriptionRoutes);
dashboardApp.use('/api/overview', overviewRoutes);

// Fallback to static Dashboard build if not hitting API
// In development: ../../dashboard/dist
// In bundled package: ./dashboard
const devDashboardDist = path.join(__dirname, '../../dashboard/dist');
const bundledDashboardDist = path.join(__dirname, 'dashboard');
const dashboardDist = fs.existsSync(bundledDashboardDist) ? bundledDashboardDist : devDashboardDist;

dashboardApp.use(express.static(dashboardDist));

dashboardApp.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    if (fs.existsSync(path.join(dashboardDist, 'index.html'))) {
        res.sendFile(path.join(dashboardDist, 'index.html'));
    } else {
        res.status(404).send('Dashboard assets not found. Run npm build in dashboard package.');
    }
});

// --- Boot Sequence ---
async function bootstrap() {
    try {
        // 1. Initialize DB and run migrations FIRST
        const db = initDb();
        console.log('Database schema intialized successfully.');

        // 2. Refresh bundled default pricing, Remote Registry & Auth
        seedPricing();
        initPricingCache();
        seedDefaultApiKey();
        console.log('Pricing engine and Auth ready.');

        // 3. Ensure a default project exists for MVP usability
        const row = db.prepare('SELECT count(*) as count FROM projects WHERE id = ?').get('default') as any;
        if (row.count === 0) {
            db.prepare(`INSERT INTO projects (id, name, daily_budget) VALUES (?, ?, ?)`).run('default', 'My Local Project', 5.0);
        }

        // 4. Start accepting Proxy Traffic
        app.listen(Number(PORT), '127.0.0.1', () => {
            console.log(`🚀 LLM Observer Proxy running on http://127.0.0.1:${PORT}`);
        });

        // 5. Start background tasks
        startAnomalyDetection();
        startRetentionCleanup();
        startCostOptimizer();
        startStatsAggregation();
        syncManager.start();
        usageSyncManager.start();

    } catch (err) {
        console.error('Fatal Initialization Error:', err);
        process.exit(1);
    }
}

bootstrap();

// FIX SEC-03: Bind to 127.0.0.1 only — dashboard must not be reachable from LAN
dashboardApp.listen(Number(DASHBOARD_PORT), '127.0.0.1', () => {
    console.log(`📊 Dashboard API running on http://127.0.0.1:${DASHBOARD_PORT}`);
});
