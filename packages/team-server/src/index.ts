import express from 'express';
import mongoose from 'mongoose';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';
import syncRoutes from './routes/sync';
import authRoutes from './routes/auth';
import oidcRoutes from './routes/oidc';
import teamRoutes from './routes/team';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 4002;
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/llm-observer-team';

// Middleware
app.use(helmet());
// Human-facing auth routes need cookies to reach a specific origin, unlike
// the machine-to-machine /api/team/sync call which any local install may hit.
app.use(cors({ origin: process.env.TEAM_DASHBOARD_URL || true, credentials: true }));
app.use(cookieParser());
app.use(express.json());

// Routes
app.use('/api/team', syncRoutes);
app.use('/api/team', teamRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/auth/oidc', oidcRoutes);

app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Connect to MongoDB
mongoose.connect(MONGODB_URI)
    .then(() => {
        console.log('Connected to MongoDB');
        app.listen(PORT, () => {
            console.log(`Team Server running on port ${PORT}`);
        });
    })
    .catch((err) => {
        console.error('MongoDB connection error:', err);
        process.exit(1);
    });
