import request from 'supertest';
import express from 'express';

// Mock DB before importing guards
jest.mock('@llm-observer/database', () => {
    const BetterSQLite3 = require('better-sqlite3');
    const database = new BetterSQLite3(':memory:');
    const path = require('path');
    const fs = require('fs');

    const migrationDir = path.join(__dirname, '../../../../packages/database/src');
    ['001_initial.sql', '002_auth.sql', '003_alerts.sql'].forEach(file => {
        const fullPath = path.join(migrationDir, file);
        if (fs.existsSync(fullPath)) {
            database.exec(fs.readFileSync(fullPath, 'utf8'));
        }
    });

    const safeExec = (sql: string) => { try { database.exec(sql); } catch (e) { /* ok */ } };
    safeExec('ALTER TABLE requests ADD COLUMN pricing_unknown BOOLEAN DEFAULT 0;');
    safeExec('ALTER TABLE model_pricing ADD COLUMN is_custom BOOLEAN DEFAULT 0;');
    safeExec('ALTER TABLE projects ADD COLUMN organization_id TEXT;');
    safeExec('ALTER TABLE requests ADD COLUMN prompt_hash TEXT;');
    safeExec('ALTER TABLE projects ADD COLUMN saved_filters TEXT DEFAULT "[]";');

    // Seed default project
    database.prepare('INSERT OR IGNORE INTO projects (id, name, daily_budget) VALUES (?, ?, ?)').run('default', 'Default', 1.0);

    return {
        getDb: () => database,
        initDb: () => database,
        bulkInsertRequests: jest.fn(),
        validateApiKey: () => ({ project_id: 'default' }),
        getSetting: () => null,
        updateSetting: () => { },
    };
});

import { budgetGuard } from '../budgetGuard';
import { rateLimitGuard } from '../rateLimitGuard';

describe('Proxy Budget & Rate Limiting Guards', () => {
    let app: express.Express;

    beforeEach(() => {
        app = express();

        // Mock proxy handler
        const mockProxy = (req: express.Request, res: express.Response) => {
            res.status(200).json({ success: true });
        };

        app.use(budgetGuard);
        app.use(rateLimitGuard);
        app.post('/v1/chat/completions', (req, res, next) => {
            mockProxy(req, res);
        });
    });

    it('should allow requests when within budget and rate limits', async () => {
        const response = await request(app)
            .post('/v1/chat/completions')
            .set('Authorization', 'Bearer sk-test-key');

        expect(response.status).toBe(200);
    });

    it('should rate limit after burst capacity', async () => {
        let got429 = false;

        // Hammer the endpoint until we get a 429
        for (let i = 0; i < 150; i++) {
            const res = await request(app).post('/v1/chat/completions').set('Authorization', 'Bearer sk-test-key');
            if (res.status === 429) {
                got429 = true;
                expect(res.body.error.type).toBe('rate_limited');
                break;
            }
        }

        expect(got429).toBe(true);
    });
});
