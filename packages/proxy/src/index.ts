import express from 'express';
import cors from 'cors';
import { handleProxyRequest } from './proxy';
import { initDb, seedPricing, getProject, createProject } from '@llm-observer/database';
import { GoogleProvider } from './providers/google';
import { budgetGuard } from './budgetGuard';

const app = express();

app.use(cors());

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'ok', service: 'llm-observer-proxy' });
});

// We need JSON to parse the models, but we need to forward it carefully
app.use(express.json({ limit: '50mb' }));

// Apply budget guard globally before proxying
app.use(budgetGuard);

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
dashboardApp.use(cors());
dashboardApp.use(express.json());
// Mount the dashboard API router
dashboardApp.use('/api', dashboardApi);

app.listen(PORT, () => {
    console.log(`🚀 LLM Observer Proxy running on http://localhost:${PORT}`);

    // Init DB and ensure default project exists
    try {
        const db = initDb();
        seedPricing();

        // Ensure default project exists
        const row = db.prepare('SELECT count(*) as count FROM projects WHERE id = ?').get('default') as any;
        if (row.count === 0) {
            db.prepare(`INSERT INTO projects (id, name, daily_budget) VALUES (?, ?, ?)`).run('default', 'My Local Project', 5.0);
        }

        console.log('Database initialized successfully.');
    } catch (err) {
        console.error('Database Init Error:', err);
    }
});

dashboardApp.listen(DASHBOARD_PORT, () => {
    console.log(`📊 Dashboard API running on http://localhost:${DASHBOARD_PORT}`);
});
