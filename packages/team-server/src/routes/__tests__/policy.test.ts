jest.mock('../../models/Team', () => ({ __esModule: true, default: require('./helpers/fakeDb').Team }));
jest.mock('../../models/TeamMember', () => ({ __esModule: true, default: require('./helpers/fakeDb').TeamMember }));
jest.mock('../../models/User', () => ({ __esModule: true, default: require('./helpers/fakeDb').User }));
jest.mock('../../models/TeamPolicy', () => ({ __esModule: true, default: require('./helpers/fakeDb').TeamPolicy }));
jest.mock('../../models/TeamDailyStats', () => ({ __esModule: true, default: require('./helpers/fakeDb').TeamDailyStats }));

import request from 'supertest';
import { db } from './helpers/fakeDb';
import { seedFixture, cookieFor, buildApp, goodBudgets } from './helpers/fixture';

let f: ReturnType<typeof seedFixture>;
const app = buildApp();
beforeEach(() => { f = seedFixture(); });

const put = (slug: string, user: any | null, body: unknown) => {
    const r = request(app).put(`/api/team/${slug}/policy`);
    return (user ? r.set('Cookie', cookieFor(user)) : r).send(body as any);
};
const policiesFor = (teamId: string) => db.policies.filter((p) => p.team_id === teamId);

describe('PUT /api/team/:teamSlug/policy — who may write', () => {
    it('401 without a session', async () => {
        expect((await put('acme', null, { budgets: goodBudgets })).status).toBe(401);
        expect(db.policies).toHaveLength(0);
    });

    it('403 for a plain member of the team', async () => {
        const res = await put('acme', f.users.member, { budgets: goodBudgets });
        expect(res.status).toBe(403);
        expect(db.policies).toHaveLength(0);
    });

    it('403 for an admin of a different team, and nothing is written to either team', async () => {
        const res = await put('acme', f.users.adminB, { budgets: goodBudgets });
        expect(res.status).toBe(403);
        expect(db.policies).toHaveLength(0);
    });

    it('404 for an unknown team', async () => {
        expect((await put('nope', f.users.admin, { budgets: goodBudgets })).status).toBe(404);
    });

    it('an admin saves a policy; each save bumps the version; the other team is untouched', async () => {
        const first = await put('acme', f.users.admin, { budgets: goodBudgets });
        expect(first.status).toBe(200);
        expect(first.body).toMatchObject({ version: 1, beta: true, updatedBy: 'admin@acme.test' });
        expect(first.body.budgets).toEqual([
            { scope: 'daily', limitUsd: 25, action: 'alert' },
            { scope: 'monthly', limitUsd: 400, provider: 'anthropic', action: 'block' },
        ]);
        const second = await put('acme', f.users.owner, { budgets: [{ scope: 'weekly', limitUsd: 100, action: 'alert' }] });
        expect(second.body.version).toBe(2);
        expect(second.body.budgets).toHaveLength(1);
        expect(policiesFor('team_globex')).toHaveLength(0);
        expect(policiesFor('team_acme')).toHaveLength(1);
    });

    it('an empty list clears the budgets (and still bumps the version)', async () => {
        await put('acme', f.users.admin, { budgets: goodBudgets });
        const res = await put('acme', f.users.admin, { budgets: [] });
        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ version: 2, budgets: [] });
    });
});

describe('PUT policy — validation', () => {
    const bad: [string, unknown][] = [
        ['missing budgets', {}],
        ['budgets not an array', { budgets: 'x' }],
        ['bad scope', { budgets: [{ scope: 'hourly', limitUsd: 5, action: 'alert' }] }],
        ['bad action', { budgets: [{ scope: 'daily', limitUsd: 5, action: 'kill' }] }],
        ['zero limit', { budgets: [{ scope: 'daily', limitUsd: 0, action: 'alert' }] }],
        ['negative limit', { budgets: [{ scope: 'daily', limitUsd: -3, action: 'alert' }] }],
        ['string limit', { budgets: [{ scope: 'daily', limitUsd: '5', action: 'alert' }] }],
        ['absurd limit', { budgets: [{ scope: 'daily', limitUsd: 1e12, action: 'alert' }] }],
        ['missing action', { budgets: [{ scope: 'daily', limitUsd: 5 }] }],
        ['empty provider', { budgets: [{ scope: 'daily', limitUsd: 5, action: 'alert', provider: '  ' }] }],
        ['unknown key', { budgets: [{ scope: 'daily', limitUsd: 5, action: 'alert', note: 'hi' }] }],
        ['unknown top-level key', { budgets: [], version: 99 }],
        ['too many budgets', { budgets: Array.from({ length: 51 }, () => ({ scope: 'daily', limitUsd: 1, action: 'alert' })) }],
    ];
    it.each(bad)('400 and nothing saved: %s', async (_name, body) => {
        const res = await put('acme', f.users.admin, body);
        expect(res.status).toBe(400);
        expect(db.policies).toHaveLength(0);
    });

    it('trims and lower-cases provider names', async () => {
        const res = await put('acme', f.users.admin, { budgets: [{ scope: 'daily', limitUsd: 5, action: 'block', provider: '  OpenAI ' }] });
        expect(res.body.budgets[0].provider).toBe('openai');
    });
});

describe('GET /api/team/:teamSlug/policy (admin)', () => {
    const get = (slug: string, user: any | null) => {
        const r = request(app).get(`/api/team/${slug}/policy`);
        return user ? r.set('Cookie', cookieFor(user)) : r;
    };

    it('returns version 0 and no budgets before anything is set', async () => {
        const res = await get('acme', f.users.admin);
        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ version: 0, budgets: [], beta: true });
    });

    it('returns the saved policy to admins and owners', async () => {
        await put('acme', f.users.admin, { budgets: goodBudgets });
        for (const u of [f.users.admin, f.users.owner]) {
            const res = await get('acme', u);
            expect(res.status).toBe(200);
            expect(res.body.version).toBe(1);
            expect(res.body.budgets).toHaveLength(2);
        }
    });

    it('401 anonymous, 403 for a member, 403 for another team admin', async () => {
        await put('acme', f.users.admin, { budgets: goodBudgets });
        expect((await get('acme', null)).status).toBe(401);
        expect((await get('acme', f.users.member)).status).toBe(403);
        const cross = await get('acme', f.users.adminB);
        expect(cross.status).toBe(403);
        expect(JSON.stringify(cross.body)).not.toContain('anthropic');
    });
});

describe('GET /api/team/policy (member app, team API key)', () => {
    const asApp = (key: string | null, email: string | null = 'dev1@acme.test') => {
        let r = request(app).get('/api/team/policy');
        if (key) r = r.set('Authorization', `Bearer ${key}`);
        if (email) r = r.set('X-Team-Member-Email', email);
        return r;
    };

    it('returns the policy and its version to a signed-in member holding the team key', async () => {
        await put('acme', f.users.admin, { budgets: goodBudgets });
        const res = await asApp('key_acme_0001');
        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ version: 1, beta: true });
        expect(res.body.budgets).toHaveLength(2);
        expect(res.body).not.toHaveProperty('updatedBy');
    });

    it('returns version 0 and an empty list when no policy exists, so the app can tell "none" from "failed"', async () => {
        expect((await asApp('key_acme_0001')).body).toMatchObject({ version: 0, budgets: [] });
    });

    it('401 for a missing, malformed or unknown key', async () => {
        expect((await asApp(null)).status).toBe(401);
        expect((await asApp('wrong')).status).toBe(401);
        const res = await request(app).get('/api/team/policy').set('Authorization', 'Basic key_acme_0001').set('X-Team-Member-Email', 'dev1@acme.test');
        expect(res.status).toBe(401);
    });

    it('does not take the key from the query string (it would land in access logs)', async () => {
        const res = await request(app).get('/api/team/policy?team_api_key=key_acme_0001').set('X-Team-Member-Email', 'dev1@acme.test');
        expect(res.status).toBe(401);
    });

    it('a cookie session is not a substitute for the key', async () => {
        const res = await request(app).get('/api/team/policy').set('Cookie', cookieFor(f.users.admin));
        expect(res.status).toBe(401);
    });

    it("each key sees only its own team's policy", async () => {
        await put('acme', f.users.admin, { budgets: goodBudgets });
        await put('globex', f.users.adminB, { budgets: [{ scope: 'weekly', limitUsd: 7, action: 'alert' }] });
        const g = await asApp('key_globex_0001', 'dev@globex.test');
        expect(g.body.budgets).toEqual([{ scope: 'weekly', limitUsd: 7, action: 'alert' }]);
    });

    it('400 when the member email is missing or malformed', async () => {
        expect((await asApp('key_acme_0001', null)).status).toBe(400);
        expect((await asApp('key_acme_0001', 'not-an-email')).status).toBe(400);
    });

    it('403 for an email that is not on the team, or invited but never signed in; email case does not matter', async () => {
        expect((await asApp('key_acme_0001', 'stranger@x.test')).status).toBe(403);
        expect((await asApp('key_acme_0001', 'dev@globex.test')).status).toBe(403); // a member of the OTHER team
        const pending = await asApp('key_acme_0001', 'pending@acme.test');
        expect(pending.status).toBe(403);
        expect(pending.body.error).toContain('not yet signed in');
        expect((await asApp('key_acme_0001', 'DEV1@Acme.Test')).status).toBe(200);
    });
});
