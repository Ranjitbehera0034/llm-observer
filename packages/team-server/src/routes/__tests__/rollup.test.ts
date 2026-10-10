jest.mock('../../models/Team', () => ({ __esModule: true, default: require('./helpers/fakeDb').Team }));
jest.mock('../../models/TeamMember', () => ({ __esModule: true, default: require('./helpers/fakeDb').TeamMember }));
jest.mock('../../models/User', () => ({ __esModule: true, default: require('./helpers/fakeDb').User }));
jest.mock('../../models/TeamPolicy', () => ({ __esModule: true, default: require('./helpers/fakeDb').TeamPolicy }));
jest.mock('../../models/TeamDailyStats', () => ({ __esModule: true, default: require('./helpers/fakeDb').TeamDailyStats }));

import request from 'supertest';
import { db } from './helpers/fakeDb';
import { seedFixture, cookieFor, buildApp } from './helpers/fixture';

let f: ReturnType<typeof seedFixture>;
const app = buildApp();

const stat = (team: string, member: string, date: string, provider: string, model: string, project: string,
    requests: number, tokens: number, cost: number, latency: number, errors = 0, blocked = 0) => ({
    team_id: team, member_id: member, date: new Date(`${date}T00:00:00Z`), provider, llm_model: model, project_name: project,
    total_requests: requests, total_tokens: tokens, total_cost_usd: cost, avg_latency_ms: latency, error_count: errors, blocked_count: blocked,
});

beforeEach(() => {
    f = seedFixture();
    db.stats.push(
        stat('team_acme', 'u_member', '2026-07-01', 'anthropic', 'claude-sonnet', 'p1', 10, 1000, 1.0, 100, 1, 0),
        stat('team_acme', 'u_member', '2026-07-01', 'anthropic', 'claude-sonnet', 'p2', 30, 3000, 3.0, 200, 0, 2),
        stat('team_acme', 'u_member', '2026-07-02', 'openai', 'gpt-4o', 'p1', 5, 500, 0.5, 400),
        stat('team_acme', 'u_member2', '2026-07-02', 'anthropic', 'claude-sonnet', 'p1', 20, 2000, 2.0, 50),
        stat('team_acme', 'u_gone', '2026-07-03', 'openai', 'gpt-4o', 'p1', 1, 10, 0.25, 10),
        stat('team_acme', 'u_member', '2026-06-30', 'openai', 'gpt-4o', 'p1', 1, 1, 99, 1),   // before the range
        stat('team_acme', 'u_member', '2026-07-04', 'openai', 'gpt-4o', 'p1', 1, 1, 77, 1),   // after the range
        stat('team_globex', 'u_memberB', '2026-07-01', 'openai', 'gpt-4o', 'p1', 9, 9, 50, 9), // another team
    );
});

const rollup = (slug: string, user: any | null, qs = '?from=2026-07-01&to=2026-07-03') => {
    const r = request(app).get(`/api/team/${slug}/rollup${qs}`);
    return user ? r.set('Cookie', cookieFor(user)) : r;
};

describe('GET /api/team/:teamSlug/rollup — authorisation', () => {
    it('401 anonymous', async () => {
        expect((await rollup('acme', null)).status).toBe(401);
    });

    it('403 for a plain member, and no stats are read', async () => {
        expect((await rollup('acme', f.users.member)).status).toBe(403);
        expect(db.statsQueries).toHaveLength(0);
    });

    it("403 for an admin of another team: they cannot read this team's data, and no stats are read", async () => {
        const res = await rollup('acme', f.users.adminB);
        expect(res.status).toBe(403);
        expect(db.statsQueries).toHaveLength(0);
        expect(JSON.stringify(res.body)).not.toMatch(/claude|gpt|cost/i);
    });

    it('404 for an unknown team; the team API key is not accepted instead of a session', async () => {
        expect((await rollup('nope', f.users.admin)).status).toBe(404);
        const res = await request(app).get('/api/team/acme/rollup?from=2026-07-01&to=2026-07-03').set('Authorization', 'Bearer key_acme_0001');
        expect(res.status).toBe(401);
    });

    it('admins and owners may read it, and every stats query is scoped to the URL team', async () => {
        for (const u of [f.users.admin, f.users.owner]) expect((await rollup('acme', u)).status).toBe(200);
        expect(db.statsQueries.length).toBeGreaterThan(0);
        for (const q of db.statsQueries) expect(q.team_id).toBe('team_acme');
    });
});

describe('GET /api/team/:teamSlug/rollup — numbers', () => {
    it('totals only this team, only the inclusive date range', async () => {
        const res = await rollup('acme', f.users.admin);
        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ beta: true, team: { slug: 'acme', name: 'Acme' }, from: '2026-07-01', to: '2026-07-03' });
        expect(res.body.totals).toEqual({ requests: 66, tokens: 6510, costUsd: 6.75, errors: 1, blocked: 2, avgLatencyMs: 151.67 });
    });

    it('per member: summed across projects, request-weighted latency, zero-usage members listed, former members flagged', async () => {
        const { members } = (await rollup('acme', f.users.admin)).body;
        const by = (id: string) => members.find((m: any) => m.memberId === id);
        expect(by('u_member')).toMatchObject({
            email: 'dev1@acme.test', name: 'Dev One', role: 'member', removed: false, membershipId: 'm_u_member',
            requests: 45, tokens: 4500, costUsd: 4.5, errors: 1, blocked: 2, avgLatencyMs: 200,
        });
        expect(by('u_member2')).toMatchObject({ requests: 20, costUsd: 2 });
        expect(by('u_admin')).toMatchObject({ requests: 0, costUsd: 0, avgLatencyMs: 0 });
        expect(by('u_gone')).toMatchObject({ email: null, name: null, role: null, removed: true, membershipId: null, costUsd: 0.25 });
        expect(by('u_memberB')).toBeUndefined();
        expect(members.map((m: any) => m.memberId)).toEqual(['u_member', 'u_member2', 'u_gone', 'u_admin', 'u_owner']);
        expect(members.some((m: any) => m.email === 'pending@acme.test')).toBe(false);
    });

    it('per day and per member per day', async () => {
        const { days, memberDays } = (await rollup('acme', f.users.admin)).body;
        expect(days.map((d: any) => [d.date, d.requests, d.costUsd])).toEqual([['2026-07-01', 40, 4], ['2026-07-02', 25, 2.5], ['2026-07-03', 1, 0.25]]);
        expect(memberDays.map((d: any) => [d.date, d.memberId, d.costUsd])).toEqual([
            ['2026-07-01', 'u_member', 4], ['2026-07-02', 'u_member', 0.5], ['2026-07-02', 'u_member2', 2], ['2026-07-03', 'u_gone', 0.25],
        ]);
    });

    it('by provider and by model, most expensive first', async () => {
        const { providers, models } = (await rollup('acme', f.users.admin)).body;
        expect(providers.map((p: any) => [p.provider, p.requests, p.costUsd])).toEqual([['anthropic', 60, 6], ['openai', 6, 0.75]]);
        expect(models.map((m: any) => [m.provider, m.model, m.costUsd])).toEqual([['anthropic', 'claude-sonnet', 6], ['openai', 'gpt-4o', 0.75]]);
    });

    it('does not leak float noise', async () => {
        db.stats.length = 0;
        for (const c of [0.1, 0.2]) db.stats.push(stat('team_acme', 'u_member', '2026-07-01', 'openai', 'gpt-4o', `p${c}`, 1, 1, c, 1));
        expect((await rollup('acme', f.users.admin)).body.totals.costUsd).toBe(0.3);
    });

    it('an empty range is a valid, empty rollup', async () => {
        const res = await rollup('acme', f.users.admin, '?from=2025-01-01&to=2025-01-31');
        expect(res.status).toBe(200);
        expect(res.body.totals).toEqual({ requests: 0, tokens: 0, costUsd: 0, errors: 0, blocked: 0, avgLatencyMs: 0 });
        expect(res.body.days).toEqual([]);
    });

    it('defaults to the last 30 days (UTC, inclusive)', async () => {
        const today = new Date();
        const iso = (d: Date) => d.toISOString().slice(0, 10);
        const res = await rollup('acme', f.users.admin, '');
        expect(res.status).toBe(200);
        expect(res.body.to).toBe(iso(today));
        expect(res.body.from).toBe(iso(new Date(today.getTime() - 29 * 86_400_000)));
    });
});

describe('GET /api/team/:teamSlug/rollup — validation', () => {
    it.each([
        ['bad format', '?from=2026-7-1&to=2026-07-03'],
        ['not a date', '?from=yesterday'],
        ['impossible day', '?from=2026-02-30&to=2026-03-02'],
        ['from after to', '?from=2026-07-03&to=2026-07-01'],
        ['range over a year', '?from=2025-01-01&to=2026-07-01'],
        ['array param', '?from=2026-07-01&from=2026-07-02'],
    ])('400: %s', async (_n, qs) => {
        const res = await rollup('acme', f.users.admin, qs);
        expect(res.status).toBe(400);
        expect(db.statsQueries).toHaveLength(0);
    });

    it('accepts a full 366-day span', async () => {
        expect((await rollup('acme', f.users.admin, '?from=2025-07-01&to=2026-06-30')).status).toBe(200);
    });
});
