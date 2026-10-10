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
beforeEach(() => { f = seedFixture(); });

const del = (slug: string, membershipId: string, user: any | null) => {
    const r = request(app).delete(`/api/team/${slug}/members/${membershipId}`);
    return user ? r.set('Cookie', cookieFor(user)) : r;
};
const stillThere = (id: string) => db.members.some((m) => m._id === id);

describe('DELETE /api/team/:teamSlug/members/:membershipId', () => {
    it('401 anonymous; 403 for a plain member', async () => {
        expect((await del('acme', 'm_u_member2', null)).status).toBe(401);
        expect((await del('acme', 'm_u_member2', f.users.member)).status).toBe(403);
        expect(stillThere('m_u_member2')).toBe(true);
    });

    it('403 for an admin of another team, and the member survives', async () => {
        expect((await del('acme', 'm_u_member2', f.users.adminB)).status).toBe(403);
        expect(stillThere('m_u_member2')).toBe(true);
    });

    it('an admin removes a member or a pending invite', async () => {
        expect((await del('acme', 'm_u_member2', f.users.admin)).status).toBe(200);
        expect((await del('acme', 'm_pending', f.users.admin)).status).toBe(200);
        expect(stillThere('m_u_member2')).toBe(false);
        expect(stillThere('m_pending')).toBe(false);
    });

    it('cannot reach a membership of another team through this team URL (404, nothing deleted)', async () => {
        const res = await del('acme', 'm_u_memberB', f.users.admin);
        expect(res.status).toBe(404);
        expect(stillThere('m_u_memberB')).toBe(true);
        expect((await del('acme', 'does-not-exist', f.users.admin)).status).toBe(404);
    });

    it('nobody removes the owner; an admin cannot remove another admin or the owner; the owner can remove an admin', async () => {
        expect((await del('acme', 'm_u_owner', f.users.owner)).status).toBe(403);
        expect((await del('acme', 'm_u_owner', f.users.admin)).status).toBe(403);
        expect((await del('acme', 'm_u_admin', f.users.admin)).status).toBe(403);
        expect(stillThere('m_u_owner')).toBe(true);
        expect(stillThere('m_u_admin')).toBe(true);
        expect((await del('acme', 'm_u_admin', f.users.owner)).status).toBe(200);
        expect(stillThere('m_u_admin')).toBe(false);
    });

    it('a removed member can no longer fetch policy or sync', async () => {
        const ask = () => request(app).get('/api/team/policy').set('Authorization', 'Bearer key_acme_0001').set('X-Team-Member-Email', 'dev2@acme.test');
        expect((await ask()).status).toBe(200);
        await del('acme', 'm_u_member2', f.users.admin);
        expect((await ask()).status).toBe(403);
        const sync = await request(app).post('/api/team/sync').send({ team_api_key: 'key_acme_0001', member_email: 'dev2@acme.test', stats: [] });
        expect(sync.status).toBe(403);
    });
});

describe('POST /api/team/:teamSlug/api-key/rotate', () => {
    const rotate = (slug: string, user: any | null) => {
        const r = request(app).post(`/api/team/${slug}/api-key/rotate`);
        return user ? r.set('Cookie', cookieFor(user)) : r;
    };
    const policyWith = (key: string) =>
        request(app).get('/api/team/policy').set('Authorization', `Bearer ${key}`).set('X-Team-Member-Email', 'dev1@acme.test');

    it('401 anonymous; 403 for members, admins and other teams (owner only)', async () => {
        expect((await rotate('acme', null)).status).toBe(401);
        for (const u of [f.users.member, f.users.admin, f.users.adminB]) expect((await rotate('acme', u)).status).toBe(403);
        expect(f.acme.team_api_key).toBe('key_acme_0001');
    });

    it('the owner gets a new key once; the old key is revoked (401) and the new one works', async () => {
        expect((await policyWith('key_acme_0001')).status).toBe(200);
        const res = await rotate('acme', f.users.owner);
        expect(res.status).toBe(200);
        const fresh = res.body.apiKey as string;
        expect(fresh).toMatch(/^llmo_team_[0-9a-f]{48}$/);
        expect(fresh).not.toBe('key_acme_0001');
        expect((await policyWith('key_acme_0001')).status).toBe(401);
        expect((await policyWith(fresh)).status).toBe(200);
        const sync = await request(app).post('/api/team/sync').send({ team_api_key: 'key_acme_0001', member_email: 'dev1@acme.test', stats: [] });
        expect(sync.status).toBe(401);
    });

    it("does not touch the other team's key", async () => {
        await rotate('acme', f.users.owner);
        expect(f.globex.team_api_key).toBe('key_globex_0001');
    });
});
