const TEAM_ID = 'team_1';
const validTeam = { _id: TEAM_ID, team_api_key: 'valid_key' };

let members: any[] = [];

jest.mock('../../models/Team', () => ({
    __esModule: true,
    default: { findOne: jest.fn(async ({ team_api_key }: any) => (team_api_key === 'valid_key' ? validTeam : null)) }
}));

jest.mock('../../models/TeamMember', () => ({
    __esModule: true,
    default: {
        findOne: jest.fn(async ({ team_id, invited_email }: any) =>
            members.find((m) => m.team_id === team_id && m.invited_email === invited_email) || null
        )
    }
}));

jest.mock('../../models/TeamDailyStats', () => ({
    __esModule: true,
    default: { bulkWrite: jest.fn(async () => ({ ok: 1 })) }
}));

import request from 'supertest';
import express from 'express';
import syncRouter from '../sync';
import TeamDailyStats from '../../models/TeamDailyStats';

const app = express();
app.use(express.json());
app.use('/api/team', syncRouter);

const basePayload = {
    team_api_key: 'valid_key',
    stats: [{
        date: '2026-07-18', provider: 'openai', model: 'gpt-4o', project_name: 'default',
        total_requests: 5, total_tokens: 500, total_cost_usd: 0.05, avg_latency_ms: 100, error_count: 0, blocked_count: 0
    }]
};

describe('POST /api/team/sync — membership is verified, not trusted', () => {
    beforeEach(() => {
        members = [];
        jest.clearAllMocks();
    });

    it('rejects an invalid team API key', async () => {
        const res = await request(app).post('/api/team/sync').send({ ...basePayload, team_api_key: 'wrong', member_email: 'a@b.com' });
        expect(res.status).toBe(401);
    });

    it('rejects an email that was never invited to the team (closes the old "trust email" stub)', async () => {
        const res = await request(app).post('/api/team/sync').send({ ...basePayload, member_email: 'stranger@example.com' });
        expect(res.status).toBe(403);
        expect(res.body.error).toContain('not a member');
        expect(TeamDailyStats.bulkWrite).not.toHaveBeenCalled();
    });

    it('rejects a member who was invited but has never signed in (no user_id yet)', async () => {
        members.push({ team_id: TEAM_ID, invited_email: 'pending@example.com', user_id: undefined });
        const res = await request(app).post('/api/team/sync').send({ ...basePayload, member_email: 'pending@example.com' });
        expect(res.status).toBe(403);
        expect(res.body.error).toContain('has not yet signed in');
    });

    it('accepts and attributes stats to the real member — not the team owner (closes the old hardcode-to-owner stub)', async () => {
        members.push({ team_id: TEAM_ID, invited_email: 'real@example.com', user_id: 'user_real_member' });
        const res = await request(app).post('/api/team/sync').send({ ...basePayload, member_email: 'real@example.com' });

        expect(res.status).toBe(200);
        expect(res.body.synced_count).toBe(1);
        const writtenOps = (TeamDailyStats.bulkWrite as jest.Mock).mock.calls[0][0];
        expect(writtenOps[0].updateOne.filter.member_id).toBe('user_real_member');
    });

    it('email matching is case-insensitive against the invited record', async () => {
        members.push({ team_id: TEAM_ID, invited_email: 'mixed@example.com', user_id: 'user_x' });
        const res = await request(app).post('/api/team/sync').send({ ...basePayload, member_email: 'Mixed@Example.com' });
        expect(res.status).toBe(200);
    });
});
