import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { handleProxyRequest } from './proxy';
import { budgetGuard } from './budgetGuard';
import { rateLimitGuard } from './rateLimitGuard';
import { resolveRequestContext } from './requestContext';
import { dashboardApi } from './dashboardApi';
import { localGuard } from './security/localGuard';
import syncRoutes from './routes/sync.routes';
import subscriptionRoutes from './routes/subscriptions.routes';
import overviewRoutes from './routes/overview.routes';
import sessionsRoutes from './routes/sessions.routes';
import toolRoutes from './routes/tools.routes';
import agentRoutes from './routes/agents.routes';
import limitRoutes from './routes/limits.routes';
import heatmapRoutes from './routes/heatmap.routes';
import './types';

const corsOptions = {
    origin: ['http://localhost:5173', 'http://127.0.0.1:5173', 'http://localhost:4001', 'http://127.0.0.1:4001', process.env.DASHBOARD_URL].filter(Boolean) as string[],
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-api-key']
};


/**
 * The proxy app (default :4000): guards plus the /v1/<provider> routes.
 * Pure factory: no listen(), no timers, no database initialisation, so tests
 * can mount the real guard/route chain against their own database.
 */
export function createApp(): express.Express {
    const app = express();
    // First, so a rebinding/CSRF request is refused before anything else runs
    app.use(localGuard);
    app.use(cors(corsOptions));

    // Health check
    app.get('/health', (req, res) => {
        res.json({ status: 'ok', service: 'llm-observer-proxy' });
    });

    // We need JSON to parse the models, but we need to forward it carefully
    // FIX SEC-06: Reduced from 50MB to prevent memory-exhaustion DoS
    app.use(express.json({ limit: '5mb' }));

    // Resolve provider/model from the URL so provider- and model-scoped budgets match
    app.use(resolveRequestContext);

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

    // Ollama — first-class provider (dedicated route + parser, not the generic
    // custom fallback). Talks to Ollama's OpenAI-compatible surface; base URL
    // defaults to http://localhost:11434 and is overridable via Settings.
    app.all('/v1/ollama/*', (req, res) => {
        req.url = req.url.replace('/v1/ollama', '/v1');
        handleProxyRequest(req, res, 'ollama');
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

    return app;
}

/**
 * The dashboard API + SPA app (default :4001). Same contract as createApp().
 */
export function createDashboardApp(): express.Express {
    const dashboardApp = express();
    dashboardApp.use(localGuard);
    dashboardApp.use(cors(corsOptions));
    dashboardApp.use(express.json());
    // Mount the dashboard API router
    dashboardApp.use('/api', dashboardApi);

    dashboardApp.use('/api/sync', syncRoutes);
    dashboardApp.use('/api/subscriptions', subscriptionRoutes);
    dashboardApp.use('/api/overview', overviewRoutes);
    dashboardApp.use('/api/sessions', sessionsRoutes);
    dashboardApp.use('/api/tools', toolRoutes);
    dashboardApp.use('/api/agents', agentRoutes);
    dashboardApp.use('/api/limits', limitRoutes);
    dashboardApp.use('/api/heatmap', heatmapRoutes);

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

    return dashboardApp;
}
