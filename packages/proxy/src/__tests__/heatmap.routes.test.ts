import request from 'supertest';
import express from 'express';
import { initDb, getDb } from '@llm-observer/database';
import heatmapRoutes from '../routes/heatmap.routes';

const app = express();
app.use('/api/heatmap', heatmapRoutes);

const iso = (msAgo: number) => new Date(Date.now() - msAgo).toISOString();
const total = (body: any) => body.grid.reduce((n: number, d: any) => n + d.hours.reduce((m: number, h: any) => m + h.sessions, 0), 0);

describe('GET /api/heatmap window', () => {
    beforeAll(() => { initDb(':memory:'); });
    beforeEach(() => { getDb().prepare('DELETE FROM sessions').run(); });

    const addSession = (id: string, startedAt: string) =>
        getDb().prepare("INSERT INTO sessions (provider, session_id, started_at, estimated_cost_usd) VALUES ('claude-code', ?, ?, 1)").run(id, startedAt);

    it('counts ISO-timestamped sessions inside the window and excludes ones just past the cutoff', async () => {
        const DAY = 86400_000;
        addSession('inside', iso(DAY - 3600_000));
        addSession('just-outside', iso(DAY + 60_000));   // same calendar date as the cutoff: 'T' sorts after ' '
        addSession('way-outside', iso(5 * DAY));
        const res = await request(app).get('/api/heatmap?days=1').expect(200);
        expect(total(res.body)).toBe(1);
    });
});
