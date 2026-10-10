/**
 * Team tier part 2: the local dashboard API for the Team page (status, manual sync, rollup proxy) and the
 * read-only handling of team budgets, through the real createDashboardApp() (so the Host/Origin guard is in
 * front of every route). Fake team server; no network, no MongoDB.
 */
import request from 'supertest';
import { initDb, getDb, createBudgetLimit, updateSetting } from '@llm-observer/database';
import { createDashboardApp } from '../app';
import { reconcileTeamBudgets } from '../services/teamPolicy';
import { installFakeFetch, setLicence, lapseLicence, joinTeam, teamRows, FakeTeamServer, TEAM_URL, TEAM_KEY, TEAM_EMAIL } from './helpers/teamFixture';

const ADMIN_TOKEN = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1MSJ9.c2lnbmF0dXJlLXNlY3JldA';
const HOST = 'localhost:4001';

let server: FakeTeamServer;
let console_: jest.SpyInstance[];

const app = createDashboardApp();
const get = (path: string, host = HOST) => request(app).get(path).set('Host', host);

beforeAll(() => { initDb(':memory:'); });
beforeEach(async () => {
    console_ = [jest.spyOn(console, 'log').mockImplementation(() => {}), jest.spyOn(console, 'warn').mockImplementation(() => {}), jest.spyOn(console, 'error').mockImplementation(() => {})];
    const db = getDb();
    for (const t of ['alerts', 'budgets', 'daily_stats']) db.prepare(`DELETE FROM ${t}`).run();
    db.prepare("DELETE FROM settings WHERE key LIKE 'team_%' OR key = 'last_team_sync_at'").run();
    db.prepare("INSERT OR IGNORE INTO projects (id, name) VALUES ('default', 'Default Project')").run();
    server = installFakeFetch();
    await setLicence('team');
});
afterEach(() => console_.forEach(s => s.mockRestore()));

describe('GET /api/team/status', () => {
    it('not joined', async () => {
        const res = await get('/api/team/status');
        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ beta: true, configured: false, licensePlan: 'team', teamLicensed: true });
        expect(res.body.policy).toBeUndefined();
    });

    it('joined with a Team licence: connection, last sync, active policy, this device\'s contribution', async () => {
        joinTeam();
        updateSetting('last_team_sync_at', '2026-10-09T10:00:00.000Z');
        updateSetting('team_policy_version', '7');
        updateSetting('team_policy_synced_at', '2026-10-09T10:01:00.000Z');
        reconcileTeamBudgets([{ scope: 'daily', limitUsd: 25, action: 'block' }, { scope: 'monthly', limitUsd: 400, provider: 'anthropic', action: 'alert' }]);
        createBudgetLimit({ name: 'mine', scope: 'global', period: 'daily', limit_usd: 5, warning_pct_1: 0.8, warning_pct_2: 0.9, kill_switch: false, safety_buffer_usd: 0.05, estimate_multiplier: 3, is_active: true });
        const ins = getDb().prepare("INSERT INTO daily_stats (project_id, date, provider, model, total_requests, total_tokens, total_cost_usd, synced_at) VALUES ('default', date('now'), ?, ?, ?, ?, ?, ?)");
        ins.run('openai', 'gpt-4o', 4, 400, 1.25, "2026-10-09 10:00:00");
        ins.run('anthropic', 'claude-3-5-sonnet', 2, 900, 0.75, null);

        const res = await get('/api/team/status');
        expect(res.status).toBe(200);
        const b = res.body;
        expect(b).toMatchObject({
            configured: true, teamLicensed: true, licensePlan: 'team',
            connection: { serverUrl: TEAM_URL, teamId: 'acme', memberEmail: TEAM_EMAIL },
            lastAggregateSyncAt: '2026-10-09T10:00:00.000Z', lastPolicySyncAt: '2026-10-09T10:01:00.000Z', policyVersion: 7,
        });
        expect(b.policy.budgets).toHaveLength(2);
        expect(b.policy.budgets[0]).toMatchObject({ scope: 'daily', limitUsd: 25, action: 'block', provider: null });
        expect(b.policy.budgets[1]).toMatchObject({ scope: 'monthly', limitUsd: 400, provider: 'anthropic', action: 'alert' });
        expect(JSON.stringify(b.policy)).not.toContain('mine');
        expect(b.contribution.totals).toMatchObject({ requests: 6, tokens: 1300, costUsd: 2 });
        expect(b.contribution.pendingRows).toBe(1);
        expect(b.contribution.sample[0]).toEqual(expect.objectContaining({ project: 'Default Project' }));
        // exactly the fields that are sent, nothing else
        expect(Object.keys(b.contribution.sample[0]).sort()).toEqual(['costUsd', 'date', 'errors', 'model', 'project', 'provider', 'requests', 'tokens']);
    });

    it('never returns the team API key (not even in part beyond a short hint)', async () => {
        joinTeam();
        const res = await get('/api/team/status');
        expect(JSON.stringify(res.body)).not.toContain(TEAM_KEY);
        expect(JSON.stringify(res.body)).not.toContain(TEAM_KEY.slice(0, 12));
        expect(res.body.connection.apiKeyHint).toBe(`••••${TEAM_KEY.slice(-4)}`);
    });

    it('without a Team licence: an upgrade answer and no team data at all', async () => {
        joinTeam();
        reconcileTeamBudgets([{ scope: 'daily', limitUsd: 25, action: 'block' }]);
        await setLicence('pro');
        const res = await get('/api/team/status');
        expect(res.status).toBe(200);
        expect(res.body).toEqual({ beta: true, configured: true, licensePlan: 'pro', teamLicensed: false });
    });

    it('a free install gets the same upgrade answer', async () => {
        await setLicence('free');
        expect((await get('/api/team/status')).body).toMatchObject({ licensePlan: 'free', teamLicensed: false, configured: false });
    });

    it('reports the last errors so a stale policy is visible', async () => {
        joinTeam();
        updateSetting('team_policy_error', 'could not reach the team server (ECONNREFUSED)');
        updateSetting('team_sync_error', 'the team server answered 500');
        const b = (await get('/api/team/status')).body;
        expect(b.policyError).toMatch(/ECONNREFUSED/);
        expect(b.syncError).toMatch(/500/);
    });
});

describe('POST /api/team/sync-now', () => {
    it('runs one cycle (push + policy pull) and returns the new state', async () => {
        joinTeam();
        server.policy = { version: 3, budgets: [{ scope: 'daily', limitUsd: 9, action: 'block' }] };
        const res = await request(app).post('/api/team/sync-now').set('Host', HOST);
        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ policyVersion: 3 });
        expect(teamRows()).toHaveLength(1);
    });
    it('409 when not joined; 403 without a Team licence', async () => {
        expect((await request(app).post('/api/team/sync-now').set('Host', HOST)).status).toBe(409);
        joinTeam();
        await lapseLicence();
        expect((await request(app).post('/api/team/sync-now').set('Host', HOST)).status).toBe(403);
        expect(server.calls).toHaveLength(0);
    });
});

describe('GET /api/team/rollup (admin token proxy)', () => {
    const rollup = (qs = '', token: string | null = ADMIN_TOKEN, host = HOST) => {
        const r = request(app).get(`/api/team/rollup${qs}`).set('Host', host);
        return token === null ? r : r.set('Authorization', `Bearer ${token}`);
    };
    beforeEach(() => joinTeam());

    it('forwards the token as the team server\'s session cookie, to the configured URL only, and returns the rollup', async () => {
        server.rollup = { status: 200, body: { beta: true, team: { slug: 'acme' }, members: [{ email: 'a@x.test', costUsd: 3 }], totals: { costUsd: 3 } } };
        const res = await rollup('?from=2026-09-01&to=2026-09-30');
        expect(res.status).toBe(200);
        expect(res.body.members).toEqual([{ email: 'a@x.test', costUsd: 3 }]);
        expect(res.headers['cache-control']).toMatch(/no-store/);

        expect(server.calls).toHaveLength(1);
        const call = server.calls[0];
        expect(call.url).toBe(`${TEAM_URL}/api/team/acme/rollup?from=2026-09-01&to=2026-09-30`);
        expect(call.headers['cookie']).toBe(`llmo_access_token=${ADMIN_TOKEN}`);
        // the team API key is a different credential and is not sent for an admin call
        expect(JSON.stringify(call)).not.toContain(TEAM_KEY);
    });

    it('401 without a token, 400 for a malformed one; nothing is forwarded', async () => {
        expect((await rollup('', null)).status).toBe(401);
        for (const bad of ['short', 'has space in it xxxxxxxxx', 'a;b=c-injected-cookie-xxxxxxxx', 'tok\r\nX-Evil: 1xxxxxxxx', 'x'.repeat(5000)]) {
            const res = await request(app).get('/api/team/rollup').set('Host', HOST).set('Authorization', `Bearer ${bad.replace(/[\r\n]/g, '')}`);
            expect(res.status).toBe(400);
        }
        expect(server.calls).toHaveLength(0);
    });

    it('rejects bad dates before calling the team server', async () => {
        for (const qs of ['?from=2026-13-01', '?to=yesterday', '?from=2026-09-01&to=2026-09-30%26x=1', '?from[]=2026-09-01']) {
            expect((await rollup(qs)).status).toBe(400);
        }
        expect(server.calls).toHaveLength(0);
    });

    it('never takes the server URL or team from the request', async () => {
        const res = await rollup(`?url=http://evil.test&team=other&teamSlug=other`);
        expect(res.status).toBe(200);
        expect(server.calls[0].url).toBe(`${TEAM_URL}/api/team/acme/rollup`);
    });

    it('needs a joined team and a Team licence', async () => {
        await lapseLicence();
        expect((await rollup()).status).toBe(403);
        await setLicence('team');
        getDb().prepare("DELETE FROM settings WHERE key = 'team_api_key'").run();
        expect((await rollup()).status).toBe(409);
        expect(server.calls).toHaveLength(0);
    });

    it('maps team-server answers to clear errors without echoing the token', async () => {
        server.rollup = { status: 401, body: { error: 'Invalid or expired session.' } };
        const r401 = await rollup();
        expect(r401.status).toBe(401);
        expect(r401.body.error).toMatch(/token/i);

        server.rollup = { status: 403, body: { error: 'Requires admin role or higher.' } };
        expect((await rollup()).status).toBe(403);

        server.rollup = { status: 500, body: { error: 'Internal server error.' } };
        expect((await rollup()).status).toBe(502);

        server.offline = true;
        const off = await rollup();
        expect(off.status).toBe(502);
        expect(off.body.error).toMatch(/reach/i);

        for (const r of [r401, off]) expect(JSON.stringify(r.body)).not.toContain(ADMIN_TOKEN);
    });

    it('does not log the token', async () => {
        server.rollup = { status: 401, body: { error: 'Invalid or expired session.' } };
        await rollup();
        server.offline = true;
        await rollup();
        const logged = console_.flatMap(s => s.mock.calls).map(c => c.map(String).join(' ')).join('\n');
        expect(logged).not.toContain(ADMIN_TOKEN);
        expect(logged).not.toContain(TEAM_KEY);
    });
});

describe('Host/Origin guard in front of the team routes', () => {
    beforeEach(() => joinTeam());

    it.each(['/api/team/status', '/api/team/rollup'])('refuses a rebinding Host on GET %s', async (path) => {
        const res = await request(app).get(path).set('Host', 'rebind.evil.example:4001').set('Authorization', `Bearer ${ADMIN_TOKEN}`);
        expect([403, 421]).toContain(res.status);
        expect(server.calls).toHaveLength(0);
    });

    it('refuses a cross-site Origin on POST /sync-now and accepts the dashboard\'s own origin and a CLI (no Origin)', async () => {
        expect((await request(app).post('/api/team/sync-now').set('Host', HOST).set('Origin', 'https://evil.example')).status).toBe(403);
        expect(server.calls).toHaveLength(0);
        expect((await request(app).post('/api/team/sync-now').set('Host', HOST).set('Origin', 'http://localhost:4001')).status).toBe(200);
        expect((await request(app).post('/api/team/sync-now').set('Host', HOST)).status).toBe(200);
    });

    it('serves from 127.0.0.1 and [::1] hosts like the rest of the dashboard API', async () => {
        for (const host of ['127.0.0.1:4001', '[::1]:4001']) expect((await get('/api/team/status', host)).status).toBe(200);
    });

    it('answers the CORS preflight the dashboard dev server needs for the Authorization header', async () => {
        const res = await request(app).options('/api/team/rollup').set('Host', HOST)
            .set('Origin', 'http://localhost:5173').set('Access-Control-Request-Method', 'GET').set('Access-Control-Request-Headers', 'authorization');
        expect(res.status).toBeLessThan(300);
        expect(res.headers['access-control-allow-headers']).toMatch(/authorization/i);
    });
});

describe('team budgets are read-only through /api/budgets', () => {
    const local = () => createBudgetLimit({ name: 'mine', scope: 'global', period: 'daily', limit_usd: 5, warning_pct_1: 0.8, warning_pct_2: 0.9, kill_switch: false, safety_buffer_usd: 0.05, estimate_multiplier: 3, is_active: true });

    it('lists the source so the UI can lock team rows', async () => {
        reconcileTeamBudgets([{ scope: 'daily', limitUsd: 25, action: 'block' }]);
        const mine = local();
        const res = await get('/api/budgets');
        expect(res.body.map((b: any) => [b.id === mine ? 'local' : 'team', b.source])).toEqual(expect.arrayContaining([['team', 'team'], ['local', 'local']]));
    });

    it('refuses to edit, toggle or delete a team budget (403) and leaves it unchanged', async () => {
        reconcileTeamBudgets([{ scope: 'daily', limitUsd: 25, action: 'block' }]);
        const [t] = teamRows();
        const before = JSON.stringify(teamRows());
        for (const body of [{ limit_usd: 9999 }, { kill_switch: false }, { is_active: false }, { source: 'local' }]) {
            const res = await request(app).put(`/api/budgets/${t.id}`).set('Host', HOST).send(body);
            expect(res.status).toBe(403);
            expect(res.body.error).toMatch(/team/i);
        }
        expect((await request(app).delete(`/api/budgets/${t.id}`).set('Host', HOST)).status).toBe(403);
        expect(JSON.stringify(teamRows())).toBe(before);
    });

    it('a created budget is always local, and a local budget cannot be turned into a team one (or injected columns)', async () => {
        const created = await request(app).post('/api/budgets').set('Host', HOST)
            .send({ name: 'x', scope: 'global', period: 'daily', limit_usd: 4, source: 'team' });
        expect(created.status).toBe(201);
        expect(created.body.source).toBe('local');

        const id = created.body.id;
        const res = await request(app).put(`/api/budgets/${id}`).set('Host', HOST).send({ limit_usd: 6, source: 'team' });
        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ limit_usd: 6, source: 'local' });

        const inj = await request(app).put(`/api/budgets/${id}`).set('Host', HOST).send({ "limit_usd = 1, source": 'team' });
        expect(inj.status).toBeLessThan(500);
        expect(getDb().prepare('SELECT source FROM budgets WHERE id = ?').get(id)).toEqual({ source: 'local' });
    });

    it('local budgets still edit and delete normally', async () => {
        const id = local();
        expect((await request(app).put(`/api/budgets/${id}`).set('Host', HOST).send({ limit_usd: 8 })).body.limit_usd).toBe(8);
        expect((await request(app).delete(`/api/budgets/${id}`).set('Host', HOST)).status).toBe(204);
    });
});

describe('team settings cannot be rewritten through PUT /api/settings', () => {
    it('ignores team_* keys (so a page cannot repoint the team server or swap the key)', async () => {
        joinTeam();
        const res = await request(app).put('/api/settings').set('Host', HOST)
            .send({ team_server_url: 'https://evil.example', team_api_key: 'other', team_member_email: 'x@y.z', team_policy_version: '99', theme: 'dark' });
        expect(res.status).toBe(200);
        const row = (k: string) => (getDb().prepare('SELECT value FROM settings WHERE key = ?').get(k) as any)?.value;
        expect(row('team_server_url')).toBe(TEAM_URL);
        expect(row('team_api_key')).toBe(TEAM_KEY);
        expect(row('team_member_email')).toBe(TEAM_EMAIL);
        expect(row('theme')).toBe('dark');
    });
});
