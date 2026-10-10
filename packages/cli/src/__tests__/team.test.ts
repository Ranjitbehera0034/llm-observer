/**
 * `llm-observer team join | status | leave | sync` against a real in-memory database and a fake team server
 * (global fetch is replaced; no network, no MongoDB).
 */
import { Command } from 'commander';
import { initDb, getDb, getSetting, updateSetting, createBudgetLimit, getBudgetLimits } from '@llm-observer/database';
import { setupTeamCommands } from '../commands/team';

const URL_ = 'https://team.example.test';
const KEY = 'tk_live_0123456789abcdef0123456789abcdef';
const EMAIL = 'dev@example.test';

let out: string[];
let spies: jest.SpyInstance[];
let policyAnswer: { status: number; body: any } | 'offline';
let fetchCalls: { url: string; init: any }[];

const text = () => out.join('\n');
const run = async (...args: string[]) => {
    const program = new Command();
    program.exitOverride();
    setupTeamCommands(program);
    await program.parseAsync(['node', 'llm-observer', 'team', ...args]);
};
const join = (over: string[] = []) => run('join', '--url', URL_, '--team-id', 'acme', '--api-key', KEY, '--email', EMAIL, ...over);

const mkBudget = (name: string, source: 'local' | 'team') => createBudgetLimit({
    name, scope: 'global', period: 'daily', limit_usd: 5, warning_pct_1: 0.8, warning_pct_2: 0.9, kill_switch: true,
    safety_buffer_usd: 0.05, estimate_multiplier: 3, is_active: true, source,
} as any);

beforeAll(() => { initDb(':memory:'); });
beforeEach(() => {
    out = [];
    spies = [
        jest.spyOn(console, 'log').mockImplementation((...a: any[]) => { out.push(a.map(String).join(' ')); }),
        jest.spyOn(console, 'error').mockImplementation((...a: any[]) => { out.push(a.map(String).join(' ')); }),
        jest.spyOn(console, 'warn').mockImplementation((...a: any[]) => { out.push(a.map(String).join(' ')); }),
    ];
    process.exitCode = undefined;
    const db = getDb();
    db.prepare('DELETE FROM alerts').run();
    db.prepare('DELETE FROM budgets').run();
    db.prepare("DELETE FROM settings WHERE key LIKE 'team_%' OR key = 'last_team_sync_at'").run();
    delete process.env.LLM_OBSERVER_TEAM_API_KEY;
    policyAnswer = { status: 200, body: { version: 3, budgets: [{ scope: 'daily', limitUsd: 5, action: 'block' }], beta: true } };
    fetchCalls = [];
    (global as any).fetch = jest.fn(async (url: any, init: any = {}) => {
        fetchCalls.push({ url: String(url), init });
        if (policyAnswer === 'offline') throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } });
        return new Response(JSON.stringify(policyAnswer.body), { status: policyAnswer.status, headers: { 'content-type': 'application/json' } });
    });
});
afterEach(() => { spies.forEach(s => s.mockRestore()); process.exitCode = undefined; });

describe('team join', () => {
    it('verifies the credentials against the team server, saves the settings and never prints the key', async () => {
        await join();
        expect(process.exitCode).toBeUndefined();

        expect(fetchCalls).toHaveLength(1);
        expect(fetchCalls[0].url).toBe(`${URL_}/api/team/policy`);
        expect(fetchCalls[0].init.headers.Authorization).toBe(`Bearer ${KEY}`);
        expect(fetchCalls[0].init.headers['X-Team-Member-Email']).toBe(EMAIL);

        expect(getSetting('team_server_url')).toBe(URL_);
        expect(getSetting('team_id')).toBe('acme');
        expect(getSetting('team_api_key')).toBe(KEY);
        expect(getSetting('team_member_email')).toBe(EMAIL);
        expect(getSetting('team_sync_enabled')).toBe('true');

        expect(text()).not.toContain(KEY);
        expect(text()).not.toContain(KEY.slice(0, 10));
        expect(text()).toContain(`••••${KEY.slice(-4)}`);
        expect(text()).toMatch(/Team licence/i);
        expect(text()).toMatch(/version 3/);
    });

    it('normalises the URL (trailing slash, path kept, query/hash dropped) and lower-cases the email', async () => {
        await run('join', '--url', `${URL_}/prefix/?x=1#h`, '--team-id', 'acme', '--api-key', KEY, '--email', 'Dev@Example.TEST');
        expect(getSetting('team_server_url')).toBe(`${URL_}/prefix`);
        expect(getSetting('team_member_email')).toBe(EMAIL);
        expect(fetchCalls[0].url).toBe(`${URL_}/prefix/api/team/policy`);
    });

    it('takes the key from LLM_OBSERVER_TEAM_API_KEY so it need not sit in shell history', async () => {
        process.env.LLM_OBSERVER_TEAM_API_KEY = KEY;
        await run('join', '--url', URL_, '--team-id', 'acme', '--email', EMAIL);
        expect(process.exitCode).toBeUndefined();
        expect(getSetting('team_api_key')).toBe(KEY);
    });

    it.each([
        ['no url', ['--team-id', 'acme', '--api-key', KEY, '--email', EMAIL], /--url/],
        ['no team id', ['--url', URL_, '--api-key', KEY, '--email', EMAIL], /--team-id/],
        ['no api key', ['--url', URL_, '--team-id', 'acme', '--email', EMAIL], /--api-key/],
        ['no email', ['--url', URL_, '--team-id', 'acme', '--api-key', KEY], /--email/],
        ['bad email', ['--url', URL_, '--team-id', 'acme', '--api-key', KEY, '--email', 'nope'], /email/i],
        ['bad team id', ['--url', URL_, '--team-id', '../x', '--api-key', KEY, '--email', EMAIL], /team-id/],
        ['not a url', ['--url', 'team.example.test', '--team-id', 'acme', '--api-key', KEY, '--email', EMAIL], /url/i],
        ['ftp url', ['--url', 'ftp://team.example.test', '--team-id', 'acme', '--api-key', KEY, '--email', EMAIL], /http/i],
        ['credentials in the url', ['--url', 'https://u:p@team.example.test', '--team-id', 'acme', '--api-key', KEY, '--email', EMAIL], /credentials/i],
        ['plain http to a remote host', ['--url', 'http://team.example.test', '--team-id', 'acme', '--api-key', KEY, '--email', EMAIL], /https/i],
    ])('rejects %s without touching settings or the network', async (_n, args, msg) => {
        await run('join', ...(args as string[]));
        expect(process.exitCode).toBe(1);
        expect(text()).toMatch(msg as RegExp);
        expect(getSetting('team_api_key')).toBeNull();
        expect(fetchCalls).toHaveLength(0);
        expect(text()).not.toContain(KEY);
    });

    it('allows plain http to localhost, and to a remote host only with --allow-http', async () => {
        await run('join', '--url', 'http://localhost:4002', '--team-id', 'acme', '--api-key', KEY, '--email', EMAIL);
        expect(process.exitCode).toBeUndefined();
        expect(getSetting('team_server_url')).toBe('http://localhost:4002');
        await run('leave');
        await run('join', '--url', 'http://team.lan:4002', '--team-id', 'acme', '--api-key', KEY, '--email', EMAIL, '--allow-http');
        expect(process.exitCode).toBeUndefined();
        expect(getSetting('team_server_url')).toBe('http://team.lan:4002');
    });

    it.each([
        [401, { error: 'Invalid Team API Key' }, /rejected the API key/i],
        [403, { error: 'dev@example.test is not a member of this team.' }, /not a member/i],
        [400, { error: 'X-Team-Member-Email must be a valid email.' }, /email/i],
        [500, { error: 'Internal server error.' }, /500/],
    ])('a %s answer saves nothing', async (status, body, msg) => {
        policyAnswer = { status, body };
        await join();
        expect(process.exitCode).toBe(1);
        expect(text()).toMatch(msg);
        expect(getSetting('team_api_key')).toBeNull();
        expect(text()).not.toContain(KEY);
    });

    it('an unreachable server saves nothing, and --no-verify saves anyway without calling it', async () => {
        policyAnswer = 'offline';
        await join();
        expect(process.exitCode).toBe(1);
        expect(text()).toMatch(/reach/i);
        expect(text()).toMatch(/--no-verify/);
        expect(getSetting('team_api_key')).toBeNull();

        process.exitCode = undefined;
        fetchCalls.length = 0;
        await join(['--no-verify']);
        expect(process.exitCode).toBeUndefined();
        expect(fetchCalls).toHaveLength(0);
        expect(getSetting('team_api_key')).toBe(KEY);
    });

    it('joining a different team clears the old team budgets and policy state; re-joining the same one keeps them', async () => {
        await join();
        updateSetting('team_policy_version', '9');
        updateSetting('team_policy_synced_at', '2026-10-01T00:00:00.000Z');
        mkBudget('from acme', 'team');
        const local = mkBudget('mine', 'local');

        await join();
        expect(getBudgetLimits().map(b => b.name).sort()).toEqual(['from acme', 'mine']);
        expect(getSetting('team_policy_version')).toBe('9');

        await run('join', '--url', URL_, '--team-id', 'globex', '--api-key', KEY, '--email', EMAIL);
        expect(getBudgetLimits().map(b => b.id)).toEqual([local]);
        expect(getSetting('team_policy_version')).toBe('0');
        expect(getSetting('team_policy_synced_at')).toBeFalsy();
        expect(getSetting('team_id')).toBe('globex');
    });
});

describe('team status', () => {
    it('not joined', async () => {
        await run('status');
        expect(text()).toMatch(/not (joined|connected)/i);
        expect(text()).toMatch(/team join/);
    });

    it('shows connection, last sync, policy version and licence plan, with the key masked', async () => {
        await join();
        out.length = 0;
        fetchCalls.length = 0;
        updateSetting('last_team_sync_at', '2026-10-09T10:00:00.000Z');
        updateSetting('team_policy_version', '3');
        updateSetting('team_policy_synced_at', '2026-10-09T10:01:00.000Z');
        updateSetting('team_license_plan', 'team');
        updateSetting('team_license_checked_at', '2026-10-09T10:01:00.000Z');
        mkBudget('Team daily budget (block)', 'team');
        mkBudget('mine', 'local');

        await run('status');
        const t = text();
        expect(t).toContain(URL_);
        expect(t).toContain('acme');
        expect(t).toContain(EMAIL);
        expect(t).toContain(`••••${KEY.slice(-4)}`);
        expect(t).not.toContain(KEY);
        expect(t).toMatch(/Licence plan:.*team/i);
        expect(t).toMatch(/Policy version:\s*3/);
        expect(t).toMatch(/1 team budget/);
        expect(t).toMatch(/Last (aggregate )?sync/i);
        expect(t).toMatch(/Last policy/i);
        expect(t).not.toMatch(/mine/);
        expect(fetchCalls).toHaveLength(0); // status reads local state only
    });

    it('warns plainly when the recorded plan is not team, and when the app has not checked yet', async () => {
        await join();
        out.length = 0;
        await run('status');
        expect(text()).toMatch(/not (yet )?checked/i);

        out.length = 0;
        updateSetting('team_license_plan', 'pro');
        await run('status');
        expect(text()).toMatch(/pro/i);
        expect(text()).toMatch(/Team (features|sync|policy).*(inactive|off|not)/i);
    });

    it('surfaces the last errors', async () => {
        await join();
        out.length = 0;
        updateSetting('team_policy_error', 'could not reach the team server (ECONNREFUSED)');
        updateSetting('team_sync_error', 'the team server answered 500');
        await run('status');
        expect(text()).toMatch(/ECONNREFUSED/);
        expect(text()).toMatch(/answered 500/);
    });
});

describe('team leave', () => {
    it('removes the settings and the team budgets, and keeps local budgets, the licence and usage data', async () => {
        await join();
        updateSetting('team_policy_version', '3');
        updateSetting('license_key', 'LLMO1.keep.me');
        mkBudget('from acme', 'team');
        const local = mkBudget('mine', 'local');
        getDb().prepare("INSERT OR IGNORE INTO projects (id, name) VALUES ('default', 'Default Project')").run();
        getDb().prepare("INSERT INTO daily_stats (project_id, date, provider, model, total_requests) VALUES ('default', date('now'), 'openai', 'gpt-4o', 1)").run();
        out.length = 0;
        fetchCalls.length = 0;

        await run('leave');

        for (const k of ['team_server_url', 'team_id', 'team_api_key', 'team_member_email', 'team_sync_enabled', 'team_policy_synced_at']) {
            expect(getSetting(k)).toBeNull();
        }
        expect(getSetting('team_policy_version')).toBe('0');
        expect(getBudgetLimits().map(b => b.id)).toEqual([local]);
        expect(getSetting('license_key')).toBe('LLMO1.keep.me');
        expect((getDb().prepare('SELECT count(*) AS n FROM daily_stats').get() as any).n).toBe(1);
        expect(text()).toMatch(/left/i);
        expect(text()).not.toContain(KEY);
        expect(fetchCalls).toHaveLength(0);
    });

    it('is safe to run when not joined (and still removes stray team budgets)', async () => {
        mkBudget('stray', 'team');
        await run('leave');
        expect(process.exitCode).toBeUndefined();
        expect(text()).toMatch(/not (joined|connected)/i);
        expect(getBudgetLimits()).toHaveLength(0);
    });
});

describe('team sync', () => {
    it('asks the running app to sync now (POST /api/team/sync-now on the dashboard port)', async () => {
        policyAnswer = { status: 200, body: { policyVersion: 4 } };
        await run('sync');
        expect(fetchCalls).toHaveLength(1);
        expect(fetchCalls[0].url).toBe('http://localhost:4001/api/team/sync-now');
        expect(fetchCalls[0].init.method).toBe('POST');
        expect(text()).toMatch(/policy version 4/i);
    });

    it('explains when the app is not running', async () => {
        policyAnswer = 'offline';
        await run('sync');
        expect(text()).toMatch(/running/i);
        expect(process.exitCode).toBe(1);
    });
});
