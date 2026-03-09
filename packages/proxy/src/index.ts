import express from 'express';
import cors from 'cors';
import path from 'path';
import { handleProxyRequest } from './proxy';
import { initDb, seedPricing, getDb, seedDefaultApiKey } from '@llm-observer/database';
import { initPricingCache } from './utils/pricing';
import { GoogleProvider } from './providers/google';
import { budgetGuard } from './budgetGuard';
import { rateLimitGuard } from './rateLimitGuard';

const app = express();

const corsOptions = {
    origin: ['http://localhost:5173', 'http://127.0.0.1:5173', 'http://localhost:4001', process.env.DASHBOARD_URL].filter(Boolean) as string[],
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-api-key']
};

app.use(cors(corsOptions));

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'ok', service: 'llm-observer-proxy' });
});

// We need JSON to parse the models, but we need to forward it carefully
app.use(express.json({ limit: '50mb' }));

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

const PORT = process.env.PROXY_PORT || 4000;
const DASHBOARD_PORT = process.env.DASHBOARD_PORT || 4001;

import { dashboardApi } from './dashboardApi';

// Create a separate app for the dashboard API
const dashboardApp = express();
dashboardApp.use(cors(corsOptions));
dashboardApp.use(express.json());
// Mount the dashboard API router
dashboardApp.use('/api', dashboardApi);

// Fallback to static Dashboard build if not hitting API
const dashboardDist = path.join(__dirname, '../../dashboard/dist');
dashboardApp.use(express.static(dashboardDist));

dashboardApp.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    res.sendFile(path.join(dashboardDist, 'index.html'));
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
        app.listen(PORT, () => {
            console.log(`🚀 LLM Observer Proxy running on http://localhost:${PORT}`);
        });

    } catch (err) {
        console.error('Fatal Initialization Error:', err);
        process.exit(1);
    }
}

bootstrap();

dashboardApp.listen(DASHBOARD_PORT, () => {
    console.log(`📊 Dashboard API running on http://localhost:${DASHBOARD_PORT}`);
});
