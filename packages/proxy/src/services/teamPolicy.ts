import { getDb, getSetting, updateSetting, deleteTeamBudgets } from '@llm-observer/database';
import { getLicenseInfo } from '../licenseManager';

/**
 * Team tier, app side: pull the team's budget policy and reconcile it into the local `budgets` table
 * as `source = 'team'` rows. The existing BudgetService / budgetGuard then enforce ('block' policy
 * budgets become kill-switch budgets) or alert on them exactly like a budget the user made.
 *
 * Rules (docs/guide/team.md has the design):
 *  - only when the licence plan is 'team'; otherwise the team rows are removed
 *  - reconciliation touches team-sourced rows only, never a local budget
 *  - idempotent: applying the same policy twice changes nothing
 *  - failure-tolerant: offline, a server error or a malformed answer keeps the last policy
 */

export const MAX_POLICY_BUDGETS = 50;
const MAX_LIMIT_USD = 10_000_000;
const REQUEST_TIMEOUT_MS = 10_000;
const DEFAULT_TEAM_SERVER_URL = 'http://localhost:4002';

export type PolicyScope = 'daily' | 'weekly' | 'monthly';
export type PolicyAction = 'alert' | 'block';
export interface PolicyBudget { scope: PolicyScope; limitUsd: number; provider?: string; action: PolicyAction }
export interface TeamPolicy { version: number; budgets: PolicyBudget[] }

export interface TeamConfig { serverUrl: string; teamId: string | null; apiKey: string; memberEmail: string }

/** Where the team server lives: the joined URL, else TEAM_SERVER_URL, else the local default. */
export function teamServerUrl(): string {
    const raw = getSetting('team_server_url') || process.env.TEAM_SERVER_URL || DEFAULT_TEAM_SERVER_URL;
    return raw.replace(/\/+$/, '');
}

/** The saved join settings, or null when this install has not joined a team (or sync is switched off). */
export function getTeamConfig(): TeamConfig | null {
    const apiKey = getSetting('team_api_key');
    const memberEmail = getSetting('team_member_email');
    if (!apiKey || !memberEmail || getSetting('team_sync_enabled') !== 'true') return null;
    return { serverUrl: teamServerUrl(), teamId: getSetting('team_id'), apiKey, memberEmail };
}

class TeamPolicyError extends Error {}

/** Validates the team server's answer. Throws on anything unexpected: a bad policy must never half-apply. */
export function parsePolicy(body: unknown): TeamPolicy {
    const bad = (why: string): never => { throw new TeamPolicyError(`invalid policy: ${why}`); };
    if (!body || typeof body !== 'object' || Array.isArray(body)) return bad('not an object');
    const { version, budgets } = body as Record<string, unknown>;
    if (typeof version !== 'number' || !Number.isInteger(version) || version < 0) return bad('version must be a whole number');
    if (!Array.isArray(budgets)) return bad('budgets must be a list');
    if (budgets.length > MAX_POLICY_BUDGETS) return bad(`more than ${MAX_POLICY_BUDGETS} budgets`);

    const out: PolicyBudget[] = budgets.map((raw, i) => {
        if (!raw || typeof raw !== 'object') return bad(`budget ${i} is not an object`);
        const b = raw as Record<string, unknown>;
        if (b.scope !== 'daily' && b.scope !== 'weekly' && b.scope !== 'monthly') return bad(`budget ${i}: unknown scope`);
        if (b.action !== 'alert' && b.action !== 'block') return bad(`budget ${i}: unknown action`);
        if (typeof b.limitUsd !== 'number' || !Number.isFinite(b.limitUsd) || b.limitUsd <= 0 || b.limitUsd > MAX_LIMIT_USD) {
            return bad(`budget ${i}: limitUsd must be a positive number`);
        }
        const budget: PolicyBudget = { scope: b.scope, limitUsd: b.limitUsd, action: b.action };
        if (b.provider !== undefined) {
            if (typeof b.provider !== 'string' || !b.provider.trim() || b.provider.length > 64) return bad(`budget ${i}: provider must be a non-empty name`);
            budget.provider = b.provider.trim().toLowerCase();
        }
        return { scope: budget.scope, limitUsd: budget.limitUsd, ...(budget.provider ? { provider: budget.provider } : {}), action: budget.action };
    });
    return { version, budgets: out };
}

interface TeamRow { name: string; scope: 'global' | 'provider'; scope_value: string | null; period: string; limit_usd: number; kill_switch: 0 | 1 }

function toRow(b: PolicyBudget): TeamRow {
    return {
        name: `Team ${b.scope}${b.provider ? ` ${b.provider}` : ''} budget (${b.action})`,
        scope: b.provider ? 'provider' : 'global',
        scope_value: b.provider ?? null,
        period: b.scope,
        limit_usd: b.limitUsd,
        kill_switch: b.action === 'block' ? 1 : 0,
    };
}

export interface ReconcileResult { created: number; updated: number; deleted: number }

/**
 * Makes the team-sourced rows equal to `budgets`: creates what is missing, updates what differs (the
 * row id is kept, so alert history stays attached), deletes what the policy dropped. Rows are matched
 * by (period, provider); inside that group identical rows pair first, the rest pair in order. One
 * transaction: either the whole policy applies or none of it.
 */
export function reconcileTeamBudgets(budgets: PolicyBudget[]): ReconcileResult {
    const db = getDb();
    return db.transaction((): ReconcileResult => {
        const existing = db.prepare("SELECT * FROM budgets WHERE source = 'team' ORDER BY id").all() as (TeamRow & { id: number; is_active: number })[];
        const desired = budgets.map(toRow);
        const groupKey = (r: { period: string; scope_value: string | null }) => `${r.period}|${r.scope_value ?? ''}`;
        const identical = (e: TeamRow & { is_active: number }, d: TeamRow) =>
            e.name === d.name && e.scope === d.scope && e.scope_value === d.scope_value && e.period === d.period
            && e.limit_usd === d.limit_usd && e.kill_switch === d.kill_switch && e.is_active === 1;

        const groups = new Map<string, { have: typeof existing; want: TeamRow[] }>();
        const group = (k: string) => groups.get(k) ?? groups.set(k, { have: [], want: [] }).get(k)!;
        for (const e of existing) group(groupKey(e)).have.push(e);
        for (const d of desired) group(groupKey(d)).want.push(d);

        const result: ReconcileResult = { created: 0, updated: 0, deleted: 0 };
        const insert = db.prepare(`INSERT INTO budgets (name, scope, scope_value, period, limit_usd, warning_pct_1, warning_pct_2, kill_switch, safety_buffer_usd, estimate_multiplier, is_active, source)
            VALUES (?, ?, ?, ?, ?, 0.8, 0.9, ?, 0.05, 3.0, 1, 'team')`);
        const update = db.prepare(`UPDATE budgets SET name = ?, scope = ?, scope_value = ?, period = ?, limit_usd = ?, kill_switch = ?, is_active = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND source = 'team'`);
        const dropAlerts = db.prepare('DELETE FROM alerts WHERE budget_id = ?');
        const drop = db.prepare("DELETE FROM budgets WHERE id = ? AND source = 'team'");

        for (const { have, want } of groups.values()) {
            const haveLeft = [...have];
            const wantLeft: TeamRow[] = [];
            for (const d of want) {
                const i = haveLeft.findIndex(e => identical(e, d));
                if (i >= 0) haveLeft.splice(i, 1); else wantLeft.push(d);
            }
            for (const d of wantLeft) {
                const e = haveLeft.shift();
                if (e) {
                    update.run(d.name, d.scope, d.scope_value, d.period, d.limit_usd, d.kill_switch, e.id);
                    result.updated++;
                } else {
                    insert.run(d.name, d.scope, d.scope_value, d.period, d.limit_usd, d.kill_switch);
                    result.created++;
                }
            }
            for (const e of haveLeft) {
                dropAlerts.run(e.id);
                drop.run(e.id);
                result.deleted++;
            }
        }
        return result;
    })();
}

/** Removes every team-sourced budget (left a team, licence no longer Team). Returns how many. */
export function removeTeamBudgets(): number {
    return deleteTeamBudgets();
}

/** Short, secret-free description of why a call failed. */
function describeNetworkError(err: any): string {
    const code = err?.cause?.code || err?.code;
    if (err?.name === 'TimeoutError' || err?.name === 'AbortError') return 'timed out';
    return code ? String(code) : (err?.message ? String(err.message).slice(0, 120) : 'network error');
}

/** GET /api/team/policy with the team key (Authorization header) and member email (header). Throws a readable error. */
export async function fetchTeamPolicy(cfg: TeamConfig): Promise<TeamPolicy> {
    let res: Response;
    try {
        res = await fetch(`${cfg.serverUrl}/api/team/policy`, {
            method: 'GET',
            headers: { Authorization: `Bearer ${cfg.apiKey}`, 'X-Team-Member-Email': cfg.memberEmail, Accept: 'application/json' },
            // A redirect could carry the key somewhere else; the joined URL must answer itself.
            redirect: 'error',
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
    } catch (err) {
        throw new TeamPolicyError(`could not reach the team server (${describeNetworkError(err)})`);
    }
    let body: unknown;
    try { body = await res.json(); } catch { body = undefined; }
    if (!res.ok) {
        const msg = body && typeof (body as any).error === 'string' ? `: ${(body as any).error.slice(0, 160)}` : '';
        throw new TeamPolicyError(`the team server answered ${res.status}${msg}`);
    }
    if (body === undefined) throw new TeamPolicyError('invalid policy: the team server did not send JSON');
    return parsePolicy(body);
}

/** Records which plan this install saw, so `llm-observer team status` can show it without the app running. */
export async function currentLicencePlan(): Promise<'free' | 'pro' | 'team'> {
    const info = await getLicenseInfo();
    try {
        updateSetting('team_license_plan', info.plan);
        updateSetting('team_license_checked_at', new Date().toISOString());
    } catch { /* status bookkeeping must never break a sync */ }
    return info.plan;
}

export type RefreshOutcome =
    | ({ outcome: 'applied'; version: number } & ReconcileResult)
    | { outcome: 'not_configured'; removed?: number }
    | { outcome: 'licence'; plan: string; removed: number }
    | { outcome: 'failed'; error: string };

/**
 * One policy cycle. Safe to call at any time: gates on being joined and on a Team licence, keeps the
 * last policy on every kind of failure, and records the result in settings for the CLI and dashboard.
 */
export async function refreshTeamPolicy(): Promise<RefreshOutcome> {
    const cfg = getTeamConfig();
    if (!cfg) {
        // Not joined (or sync switched off): nothing may stay behind from an earlier join.
        return { outcome: 'not_configured', removed: removeTeamBudgets() };
    }

    const plan = await currentLicencePlan();
    if (plan !== 'team') {
        return { outcome: 'licence', plan, removed: removeTeamBudgets() };
    }

    let policy: TeamPolicy;
    try {
        policy = await fetchTeamPolicy(cfg);
    } catch (err: any) {
        const error = String(err?.message || err);
        updateSetting('team_policy_error', error);
        console.warn(`[TeamPolicy] Keeping the last policy: ${error}`);
        return { outcome: 'failed', error };
    }

    try {
        const result = reconcileTeamBudgets(policy.budgets);
        updateSetting('team_policy_version', String(policy.version));
        updateSetting('team_policy_synced_at', new Date().toISOString());
        updateSetting('team_policy_error', '');
        if (result.created || result.updated || result.deleted) {
            console.log(`[TeamPolicy] Applied policy v${policy.version}: ${result.created} added, ${result.updated} changed, ${result.deleted} removed`);
        }
        return { outcome: 'applied', version: policy.version, ...result };
    } catch (err: any) {
        const error = `could not apply the policy: ${String(err?.message || err)}`;
        updateSetting('team_policy_error', error);
        console.error(`[TeamPolicy] ${error}`);
        return { outcome: 'failed', error };
    }
}
