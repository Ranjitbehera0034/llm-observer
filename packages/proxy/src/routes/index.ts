import { Router } from 'express';
import express from 'express';
import { getDb } from '@llm-observer/database';
import { statsRouter } from './stats.routes';
import { projectsRouter } from './projects.routes';
import { requestsRouter, requestEventEmitter } from './requests.routes';
import { authRouter } from './auth.routes';
import { settingsRouter } from './settings.routes';
import { licenseRouter } from './license.routes';
import { webhooksRouter } from './webhooks.routes';
import budgetsRouter from './budgets.routes';
import alertsRouter from './alerts.routes';
import appsRouter from './apps.routes';
import networkRouter from './network.routes';
import wrappedRouter from './wrapped.routes';

/**
 * Composes all dashboard API sub-routers into a single router.
 * Mount this on /api in the dashboard Express app.
 */
export function createDashboardRouter(): Router {
    const router = Router();

    // Payment webhooks (MUST be mounted before express.json() so it can read raw body)
    router.use('/webhooks', webhooksRouter);

    // Re-add global JSON parsing for dashboard routes
    router.use(express.json());

    // Stats
    router.use('/stats', statsRouter);

    // Projects
    router.use('/projects', projectsRouter);

    // Requests (list, detail)
    router.use('/requests', requestsRouter);

    // Auth / API keys
    router.use('/auth', authRouter);

    // License
    router.use('/license', licenseRouter);

    // Teams sync
    router.use('/teams', requestsRouter);

    // Budgets
    router.use('/budgets', budgetsRouter);

    // Alerts (v1.4.0 Unified)
    router.use('/alerts', alertsRouter);

    // Settings, alert rules (mounted at root)
    router.use('/', settingsRouter);

    // Apps & Network
    router.use('/apps', appsRouter);
    router.use('/network', networkRouter);

    // AI Wrapped (v1.9.0)
    router.use('/wrapped', wrappedRouter);

    // SSE events (mounted at /events)ß
    router.get('/events', (req, res, next) => {
        // Delegate to the events handler in requestsRouter
        req.url = '/events';
        requestsRouter(req, res, next);
    });

    // Pricing
    router.get('/pricing', (req, res) => {
        try {
            const db = getDb();
            const data = db.prepare('SELECT * FROM model_pricing').all();
            res.json({ data });
        } catch (err) {
            res.status(500).json({ error: 'Internal Server Error' });
        }
    });

    return router;
}

// Re-export the event emitter for backward compatibility
export { requestEventEmitter } from './requests.routes';
