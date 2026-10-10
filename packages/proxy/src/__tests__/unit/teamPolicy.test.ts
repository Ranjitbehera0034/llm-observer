/**
 * Team tier part 2: reconciling the team policy into the budgets table. Real in-memory database,
 * real licence manager (synthetic keys), fake team server.
 */
import { initDb, getDb, createBudgetLimit, getSetting, updateSetting } from '@llm-observer/database';
import {
    installFakeFetch, setLicence, lapseLicence, joinTeam, teamRows, localRows, FakeTeamServer, TEAM_URL, TEAM_KEY, TEAM_EMAIL,
} from '../helpers/teamFixture';
import { reconcileTeamBudgets, parsePolicy, refreshTeamPolicy, removeTeamBudgets } from '../../services/teamPolicy';
import { SyncManager } from '../../syncManager';

let server: FakeTeamServer;
let logs: jest.SpyInstance[];

const localBudget = (over: Record<string, any> = {}) => createBudgetLimit({
    name: 'my own', scope: 'global', period: 'daily', limit_usd: 7, warning_pct_1: 0.8, warning_pct_2: 0.9,
    kill_switch: true, safety_buffer_usd: 0.05, estimate_multiplier: 3, is_active: true, ...over,
} as any);

beforeAll(() => { initDb(':memory:'); });
beforeEach(async () => {
    logs = [jest.spyOn(console, 'log').mockImplementation(() => {}), jest.spyOn(console, 'error').mockImplementation(() => {}), jest.spyOn(console, 'warn').mockImplementation(() => {})];
    const db = getDb();
    db.prepare('DELETE FROM alerts').run();
    db.prepare('DELETE FROM budgets').run();
    db.prepare("DELETE FROM settings WHERE key LIKE 'team_%' OR key = 'last_team_sync_at'").run();
    db.prepare('DELETE FROM daily_stats').run();
    server = installFakeFetch();
    await setLicence('team');
    joinTeam();
});
afterEach(() => logs.forEach(l => l.mockRestore()));

describe('reconcileTeamBudgets', () => {
    it('creates team rows with the right scope mapping and enforcement flag', () => {
        const r = reconcileTeamBudgets([
            { scope: 'daily', limitUsd: 25, action: 'block' },
            { scope: 'monthly', limitUsd: 400, provider: 'anthropic', action: 'alert' },
        ]);
        expect(r).toEqual({ created: 2, updated: 0, deleted: 0 });
        const rows = teamRows();
        expect(rows).toHaveLength(2);
        expect(rows[0]).toMatchObject({ scope: 'global', scope_value: null, period: 'daily', limit_usd: 25, kill_switch: 1, is_active: 1, source: 'team' });
        expect(rows[1]).toMatchObject({ scope: 'provider', scope_value: 'anthropic', period: 'monthly', limit_usd: 400, kill_switch: 0, is_active: 1, source: 'team' });
        expect(rows[1].name).toMatch(/^Team /);
    });

    it('updates a changed limit in place (same id), and deletes what the policy dropped', () => {
        reconcileTeamBudgets([{ scope: 'daily', limitUsd: 25, action: 'block' }, { scope: 'weekly', limitUsd: 100, action: 'alert' }]);
        const [daily, weekly] = teamRows();

        const r = reconcileTeamBudgets([{ scope: 'daily', limitUsd: 40, action: 'block' }]);
        expect(r).toEqual({ created: 0, updated: 1, deleted: 1 });
        const rows = teamRows();
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ id: daily.id, limit_usd: 40 });
        expect(rows.find(x => x.id === weekly.id)).toBeUndefined();
    });

    it('turning an alert into a block flips the same row (alert history stays attached); dropping a budget deletes its alerts', () => {
        reconcileTeamBudgets([{ scope: 'daily', limitUsd: 25, action: 'alert' }]);
        const [old] = teamRows();
        getDb().prepare("INSERT INTO alerts (id, type, message, budget_id, period_start) VALUES ('a1', 'budget_exceeded', 'm', ?, 'p')").run(old.id);

        expect(reconcileTeamBudgets([{ scope: 'daily', limitUsd: 25, action: 'block' }])).toEqual({ created: 0, updated: 1, deleted: 0 });
        expect(teamRows()).toHaveLength(1);
        expect(teamRows()[0]).toMatchObject({ id: old.id, kill_switch: 1 });
        expect((getDb().prepare('SELECT count(*) AS n FROM alerts WHERE budget_id = ?').get(old.id) as any).n).toBe(1);

        reconcileTeamBudgets([]);
        expect((getDb().prepare('SELECT count(*) AS n FROM alerts WHERE budget_id = ?').get(old.id) as any).n).toBe(0);
    });

    it('is idempotent: applying the same policy again changes nothing, not even updated_at', () => {
        const policy = [{ scope: 'daily' as const, limitUsd: 25, action: 'block' as const }, { scope: 'daily' as const, limitUsd: 10, provider: 'openai', action: 'alert' as const }];
        reconcileTeamBudgets(policy);
        const before = JSON.stringify(teamRows());
        expect(reconcileTeamBudgets(policy)).toEqual({ created: 0, updated: 0, deleted: 0 });
        expect(reconcileTeamBudgets([...policy].reverse())).toEqual({ created: 0, updated: 0, deleted: 0 });
        expect(JSON.stringify(teamRows())).toBe(before);
    });

    it('handles two budgets that differ only by limit (an early alert and a later block share a key)', () => {
        const policy = (a: number, b: number) => [{ scope: 'daily' as const, limitUsd: a, action: 'alert' as const }, { scope: 'daily' as const, limitUsd: b, action: 'alert' as const }];
        reconcileTeamBudgets(policy(10, 20));
        const ids = teamRows().map(r => r.id);
        expect(reconcileTeamBudgets(policy(10, 30))).toEqual({ created: 0, updated: 1, deleted: 0 });
        expect(teamRows().map(r => r.id)).toEqual(ids);
        expect(teamRows().map(r => r.limit_usd).sort((x, y) => x - y)).toEqual([10, 30]);
        expect(reconcileTeamBudgets(policy(10, 30).slice(0, 1))).toEqual({ created: 0, updated: 0, deleted: 1 });
    });

    it('never touches local budgets, including one that looks identical to a team budget', () => {
        const same = localBudget({ name: 'same shape', limit_usd: 25 });
        const other = localBudget({ name: 'other', scope: 'provider', scope_value: 'openai', limit_usd: 3, kill_switch: false });
        const snapshot = JSON.stringify(localRows());

        reconcileTeamBudgets([{ scope: 'daily', limitUsd: 25, action: 'block' }]);
        reconcileTeamBudgets([{ scope: 'daily', limitUsd: 99, action: 'block' }]);
        expect(JSON.stringify(localRows())).toBe(snapshot);
        expect(localRows().map(r => r.id)).toEqual([same, other]);

        reconcileTeamBudgets([]);
        expect(JSON.stringify(localRows())).toBe(snapshot);
        expect(teamRows()).toHaveLength(0);
    });

    it('restores a team row that was deactivated or edited behind our back', () => {
        reconcileTeamBudgets([{ scope: 'daily', limitUsd: 25, action: 'block' }]);
        getDb().prepare("UPDATE budgets SET is_active = 0, limit_usd = 9999, kill_switch = 0 WHERE source = 'team'").run();
        expect(reconcileTeamBudgets([{ scope: 'daily', limitUsd: 25, action: 'block' }]).updated).toBe(1);
        expect(teamRows()[0]).toMatchObject({ is_active: 1, limit_usd: 25, kill_switch: 1 });
    });

    it('rolls back as a whole if a row cannot be written', () => {
        reconcileTeamBudgets([{ scope: 'daily', limitUsd: 25, action: 'block' }]);
        const before = JSON.stringify(teamRows());
        expect(() => reconcileTeamBudgets([{ scope: 'daily', limitUsd: 30, action: 'block' }, { scope: 'bogus' as any, limitUsd: 1, action: 'block' }])).toThrow();
        expect(JSON.stringify(teamRows())).toBe(before);
    });
});

describe('parsePolicy', () => {
    const ok = { version: 3, budgets: [{ scope: 'daily', limitUsd: 5, action: 'block' }, { scope: 'weekly', limitUsd: 50, provider: 'OpenAI', action: 'alert' }] };

    it('accepts the team-server shape and lower-cases providers', () => {
        expect(parsePolicy({ ...ok, beta: true, updatedAt: null })).toEqual({
            version: 3,
            budgets: [{ scope: 'daily', limitUsd: 5, action: 'block' }, { scope: 'weekly', limitUsd: 50, provider: 'openai', action: 'alert' }],
        });
    });

    it.each([
        ['not an object', 'nope'],
        ['no version', { budgets: [] }],
        ['negative version', { version: -1, budgets: [] }],
        ['fractional version', { version: 1.5, budgets: [] }],
        ['budgets not an array', { version: 1, budgets: {} }],
        ['unknown scope', { version: 1, budgets: [{ scope: 'hourly', limitUsd: 1, action: 'block' }] }],
        ['zero limit', { version: 1, budgets: [{ scope: 'daily', limitUsd: 0, action: 'block' }] }],
        ['negative limit', { version: 1, budgets: [{ scope: 'daily', limitUsd: -3, action: 'block' }] }],
        ['string limit', { version: 1, budgets: [{ scope: 'daily', limitUsd: '3', action: 'block' }] }],
        ['infinite limit', { version: 1, budgets: [{ scope: 'daily', limitUsd: 1e999, action: 'block' }] }],
        ['unknown action', { version: 1, budgets: [{ scope: 'daily', limitUsd: 3, action: 'kill' }] }],
        ['empty provider', { version: 1, budgets: [{ scope: 'daily', limitUsd: 3, provider: '', action: 'block' }] }],
        ['too many budgets', { version: 1, budgets: Array.from({ length: 51 }, () => ({ scope: 'daily', limitUsd: 1, action: 'alert' })) }],
    ])('rejects %s', (_n, body) => {
        expect(() => parsePolicy(body)).toThrow();
    });
});

describe('refreshTeamPolicy', () => {
    const policyV = (version: number, budgets: any[]) => { server.policy = { version, budgets, beta: true }; };

    it('pulls with the team key and member email in headers, never in the URL, and applies the policy', async () => {
        policyV(4, [{ scope: 'daily', limitUsd: 12, action: 'block' }]);
        const res = await refreshTeamPolicy();
        expect(res).toMatchObject({ outcome: 'applied', version: 4, created: 1 });

        const call = server.calls.find(c => c.url.endsWith('/api/team/policy'))!;
        expect(call.url).toBe(`${TEAM_URL}/api/team/policy`);
        expect(call.method).toBe('GET');
        expect(call.headers['authorization']).toBe(`Bearer ${TEAM_KEY}`);
        expect(call.headers['x-team-member-email']).toBe(TEAM_EMAIL);
        expect(call.url).not.toContain(TEAM_KEY);

        expect(teamRows()).toHaveLength(1);
        expect(getSetting('team_policy_version')).toBe('4');
        expect(getSetting('team_policy_synced_at')).toMatch(/^\d{4}-/);
        expect(getSetting('team_policy_error')).toBeFalsy();
    });

    it('is idempotent across pulls', async () => {
        policyV(2, [{ scope: 'daily', limitUsd: 12, action: 'block' }, { scope: 'weekly', limitUsd: 90, action: 'alert' }]);
        await refreshTeamPolicy();
        const before = JSON.stringify(teamRows());
        const again = await refreshTeamPolicy();
        expect(again).toMatchObject({ outcome: 'applied', created: 0, updated: 0, deleted: 0 });
        expect(JSON.stringify(teamRows())).toBe(before);
    });

    it('picks up an admin edit (new version) and an emptied policy', async () => {
        policyV(1, [{ scope: 'daily', limitUsd: 12, action: 'block' }]);
        await refreshTeamPolicy();
        policyV(2, [{ scope: 'daily', limitUsd: 20, action: 'block' }]);
        await refreshTeamPolicy();
        expect(teamRows().map(r => r.limit_usd)).toEqual([20]);
        policyV(3, []);
        await refreshTeamPolicy();
        expect(teamRows()).toHaveLength(0);
        expect(getSetting('team_policy_version')).toBe('3');
    });

    describe('failure keeps the last policy', () => {
        beforeEach(async () => {
            policyV(5, [{ scope: 'daily', limitUsd: 12, action: 'block' }]);
            await refreshTeamPolicy();
            expect(teamRows()).toHaveLength(1);
        });
        const expectKept = (error: RegExp) => {
            expect(teamRows()).toHaveLength(1);
            expect(teamRows()[0]).toMatchObject({ limit_usd: 12, kill_switch: 1, is_active: 1 });
            expect(getSetting('team_policy_version')).toBe('5');
            expect(getSetting('team_policy_error')).toMatch(error);
        };

        it('offline', async () => {
            server.offline = true;
            expect(await refreshTeamPolicy()).toMatchObject({ outcome: 'failed' });
            expectKept(/reach|fetch failed|offline/i);
        });
        it('5xx', async () => {
            server.policyStatus = 503; server.policy = { error: 'Internal server error.' };
            expect(await refreshTeamPolicy()).toMatchObject({ outcome: 'failed' });
            expectKept(/503/);
        });
        it('credentials rejected (revoked key or removed member): policy is kept and the reason is visible', async () => {
            server.policyStatus = 403; server.policy = { error: 'dev@example.test is not a member of this team.' };
            expect(await refreshTeamPolicy()).toMatchObject({ outcome: 'failed' });
            expectKept(/403/);
        });
        it('a malformed body', async () => {
            server.policy = { version: 6, budgets: [{ scope: 'daily', limitUsd: -1, action: 'block' }] };
            expect(await refreshTeamPolicy()).toMatchObject({ outcome: 'failed' });
            expectKept(/policy/i);
        });
        it('a successful pull afterwards clears the error', async () => {
            server.offline = true;
            await refreshTeamPolicy();
            server.offline = false;
            await refreshTeamPolicy();
            expect(getSetting('team_policy_error')).toBeFalsy();
        });
    });

    it('does nothing when no team is joined', async () => {
        getDb().prepare("DELETE FROM settings WHERE key = 'team_api_key'").run();
        expect(await refreshTeamPolicy()).toMatchObject({ outcome: 'not_configured' });
        expect(server.calls).toHaveLength(0);
    });
});

describe('SyncManager.sync(): licence gating', () => {
    const stat = () => getDb().prepare(`INSERT INTO daily_stats (project_id, date, provider, model, total_requests, total_tokens, total_cost_usd)
        VALUES ('default', date('now'), 'openai', 'gpt-4o', 3, 300, 0.5)`).run();
    beforeEach(() => { getDb().prepare("INSERT OR IGNORE INTO projects (id, name) VALUES ('default', 'Default Project')").run(); stat(); });

    it('with a team licence: pushes aggregates first, then pulls and applies the policy', async () => {
        server.policy = { version: 2, budgets: [{ scope: 'daily', limitUsd: 12, action: 'block' }] };
        await new SyncManager().sync();
        expect(server.calls.map(c => `${c.method} ${c.url.replace(TEAM_URL, '')}`)).toEqual(['POST /api/team/sync', 'GET /api/team/policy']);
        expect(teamRows()).toHaveLength(1);
        expect(getSetting('last_team_sync_at')).toBeTruthy();
        expect(getSetting('team_license_plan')).toBe('team');
    });

    it('a failed push does not stop the policy pull, and a failed pull does not undo the push', async () => {
        server.syncStatus = 500;
        server.policy = { version: 2, budgets: [{ scope: 'daily', limitUsd: 12, action: 'block' }] };
        await new SyncManager().sync();
        expect(teamRows()).toHaveLength(1);
        expect(getSetting('last_team_sync_at')).toBeFalsy();
    });

    it('still pulls the policy when there are no new aggregates to push', async () => {
        getDb().prepare('DELETE FROM daily_stats').run();
        server.policy = { version: 2, budgets: [{ scope: 'daily', limitUsd: 12, action: 'block' }] };
        await new SyncManager().sync();
        expect(server.calls.map(c => c.method + ' ' + c.url.replace(TEAM_URL, ''))).toEqual(['GET /api/team/policy']);
        expect(teamRows()).toHaveLength(1);
    });

    it('licence lapse: stops syncing and removes exactly the team rows, keeping the configuration and local budgets', async () => {
        server.policy = { version: 2, budgets: [{ scope: 'daily', limitUsd: 12, action: 'block' }] };
        const mine = localBudget();
        const m = new SyncManager();
        await m.sync();
        expect(teamRows()).toHaveLength(1);
        server.calls.length = 0;

        await lapseLicence();
        await m.sync();

        expect(server.calls).toHaveLength(0);
        expect(teamRows()).toHaveLength(0);
        expect(localRows().map(r => r.id)).toEqual([mine]);
        expect(getSetting('team_api_key')).toBe(TEAM_KEY);
        expect(getSetting('team_license_plan')).toBe('free');
    });

    it('a Pro (non-team) licence behaves the same: nothing is pushed or pulled and stale team rows are removed', async () => {
        reconcileTeamBudgets([{ scope: 'daily', limitUsd: 12, action: 'block' }]);
        await setLicence('pro');
        await new SyncManager().sync();
        expect(server.calls).toHaveLength(0);
        expect(teamRows()).toHaveLength(0);
        expect(getSetting('team_license_plan')).toBe('pro');
    });

    it('re-activating a team licence brings the policy back on the next cycle', async () => {
        server.policy = { version: 2, budgets: [{ scope: 'daily', limitUsd: 12, action: 'block' }] };
        const m = new SyncManager();
        await lapseLicence();
        await m.sync();
        expect(teamRows()).toHaveLength(0);
        await setLicence('team');
        await m.sync();
        expect(teamRows()).toHaveLength(1);
    });

    it('not joined: no network, and any leftover team rows are removed', async () => {
        reconcileTeamBudgets([{ scope: 'daily', limitUsd: 12, action: 'block' }]);
        getDb().prepare("DELETE FROM settings WHERE key IN ('team_api_key','team_member_email')").run();
        await new SyncManager().sync();
        expect(server.calls).toHaveLength(0);
        expect(teamRows()).toHaveLength(0);
    });

    it("an 'alert' team budget raises an alert through the existing evaluation, a 'block' one does not need to", async () => {
        getDb().prepare("INSERT INTO requests (id, project_id, provider, model, endpoint, cost_usd, status_code, status) VALUES ('r1', 'default', 'openai', 'gpt-4o', '/v1/x', 30, 200, 'success')").run();
        server.policy = { version: 2, budgets: [{ scope: 'daily', limitUsd: 20, provider: 'openai', action: 'alert' }] };
        await new SyncManager().sync();
        const alerts = getDb().prepare("SELECT type, budget_id FROM alerts WHERE budget_id IS NOT NULL").all() as any[];
        expect(alerts.some(a => a.type === 'budget_exceeded' && a.budget_id === teamRows()[0].id)).toBe(true);
    });

    it('the stored team key is never logged', async () => {
        server.policy = { version: 2, budgets: [] };
        server.offline = true;
        await new SyncManager().sync();
        const logged = logs.flatMap(l => l.mock.calls).map(c => c.map(String).join(' ')).join('\n');
        expect(logged).not.toContain(TEAM_KEY);
    });
});

describe('removeTeamBudgets', () => {
    it('removes team rows only', () => {
        const mine = localBudget();
        reconcileTeamBudgets([{ scope: 'daily', limitUsd: 12, action: 'block' }]);
        expect(removeTeamBudgets()).toBe(1);
        expect(localRows().map(r => r.id)).toEqual([mine]);
        updateSetting('x', 'y');
    });
});
