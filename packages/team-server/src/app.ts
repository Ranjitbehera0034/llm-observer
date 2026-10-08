import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import syncRoutes from './routes/sync';
import authRoutes from './routes/auth';
import oidcRoutes from './routes/oidc';
import teamRoutes from './routes/team';
import policyRoutes from './routes/policy';
import rollupRoutes from './routes/rollup';

/** The Express app without the database connection, so tests can mount the real middleware and routers. */
export function createApp() {
    const app = express();

    app.use(helmet());
    // Human-facing auth routes need cookies to reach a specific origin, unlike
    // the machine-to-machine /api/team/sync call which any local install may hit.
    app.use(cors({ origin: process.env.TEAM_DASHBOARD_URL || true, credentials: true }));
    app.use(cookieParser());
    app.use(express.json());

    app.use('/api/team', syncRoutes);
    app.use('/api/team', policyRoutes);
    app.use('/api/team', rollupRoutes);
    app.use('/api/team', teamRoutes);
    app.use('/api/auth', authRoutes);
    app.use('/api/auth/oidc', oidcRoutes);

    app.get('/health', (req, res) => {
        res.json({ status: 'ok', timestamp: new Date().toISOString() });
    });

    return app;
}
