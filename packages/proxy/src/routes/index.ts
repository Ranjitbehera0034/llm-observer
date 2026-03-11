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

/**
 * Composes all dashboard API sub-routers into a single router.
 * Mount this on /api in the dashboard Express app.
 */
export function createDashboardRouter(): Router {
    const router = Router();

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

    // Payment webhooks
    router.use('/webhooks', webhooksRouter);

    // Teams sync
    router.use('/teams', requestsRouter);

    // Settings, alerts, alert rules (mounted at root but after specific paths)
    router.use('/', settingsRouter);

    // SSE events (mounted at /events)
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
