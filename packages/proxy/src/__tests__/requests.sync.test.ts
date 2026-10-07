import request from 'supertest';
import express from 'express';
import { initDb, getDb } from '@llm-observer/database';
import { requestsRouter } from '../routes/requests.routes';

const app = express();
app.use('/api/teams', requestsRouter);

const row = (extra: Record<string, unknown> = {}) => ({
    provider: 'openai', model: 'gpt-4o', cost_usd: 0.01, prompt_tokens: 1, completion_tokens: 1, total_tokens: 2, ...extra
});

describe('POST /api/teams/:id/sync ignores client-supplied request ids', () => {
    beforeAll(() => {
        const db = initDb(':memory:');
        db.prepare('INSERT INTO projects (id, name, daily_budget) VALUES (?, ?, ?)').run('team1', 'Team', 0);
    });

    it('stores a server-generated id and survives a retried batch', async () => {
        const body = { requests: [row({ id: 'client-chosen-id' }), row({ id: 'client-chosen-id' })] };
        await request(app).post('/api/teams/team1/sync').send(body).expect(200);
        await request(app).post('/api/teams/team1/sync').send(body).expect(200); // retry must not 500

        const ids = (getDb().prepare('SELECT id FROM requests').all() as { id: string }[]).map(r => r.id);
        expect(ids).toHaveLength(4);
        expect(ids).not.toContain('client-chosen-id');
        expect(new Set(ids).size).toBe(4);
    });

    it('cannot collide with an existing row id', async () => {
        getDb().prepare("INSERT INTO requests (id, project_id, provider, model, cost_usd) VALUES ('real-proxy-id', 'team1', 'openai', 'gpt-4o', 0)").run();
        await request(app).post('/api/teams/team1/sync').send({ requests: [row({ id: 'real-proxy-id' })] }).expect(200);
        const n = getDb().prepare("SELECT count(*) AS n FROM requests WHERE id = 'real-proxy-id'").get() as { n: number };
        expect(n.n).toBe(1);
    });
});
