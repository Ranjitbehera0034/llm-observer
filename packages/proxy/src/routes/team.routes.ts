import { Router } from 'express';
import { getDb, getSetting, getBudgetLimits } from '@llm-observer/database';
import { getLicenseInfo } from '../licenseManager';
import { getTeamConfig } from '../services/teamPolicy';
import { BudgetService } from '../services/budget.service';
import { syncManager } from '../syncManager';

/**
 * Local API behind the dashboard's Team page (beta). Mounted at /api/team on the dashboard port, behind
 * the Host/Origin guard like every other route.
 *
 *  GET  /status    connection, last sync, active policy, this device's contribution (Team licence only)
 *  POST /sync-now  run one push + policy-pull cycle now
 *  GET  /rollup    proxies the team server's admin rollup. The admin pastes a team-server session token
 *                  into the page; it arrives here as `Authorization: Bearer`, is forwarded once as the
 *                  team server's session cookie to the CONFIGURED team-server URL (never a URL from the
 *                  request) and is neither stored nor logged.
 */
export const teamRouter = Router();

const TOKEN_RE = /^[A-Za-z0-9._~+/=-]{10,4096}$/;
const SLUG_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const ACCESS_TOKEN_COOKIE = 'llmo_access_token';
const UPSTREAM_TIMEOUT_MS = 15_000;

const fromSetting = (key: string): string | null => getSetting(key) || null;

function isRealDay(v: unknown): v is string {
    if (typeof v !== 'string' || !DAY_RE.test(v)) return false;
    const d = new Date(`${v}T00:00:00.000Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

async function buildStatus() {
    const info = await getLicenseInfo();
    const cfg = getTeamConfig();
    const base = { beta: true, configured: !!cfg, licensePlan: info.plan, teamLicensed: info.plan === 'team' };
    // No Team licence: nothing about a team is shown (the page explains the upgrade instead).
    if (!base.teamLicensed || !cfg) return base;

    const db = getDb();
    const teamBudgets = getBudgetLimits().filter(b => b.source === 'team');
    const budgets = await Promise.all(teamBudgets.map(async (b) => ({
        id: b.id,
        name: b.name,
        scope: b.period,
        provider: b.scope === 'provider' ? (b.scope_value ?? null) : null,
        limitUsd: b.limit_usd,
        action: b.kill_switch ? 'block' : 'alert',
        currentSpendUsd: await BudgetService.calculateCurrentSpend(b.scope, b.scope_value, b.period),
    })));

    const totals = db.prepare(`
        SELECT COALESCE(SUM(total_requests), 0) AS requests, COALESCE(SUM(total_tokens), 0) AS tokens, COALESCE(SUM(total_cost_usd), 0) AS costUsd
        FROM daily_stats WHERE date >= date('now', '-29 days')`).get() as any;
    const counts = db.prepare(`
        SELECT COUNT(*) AS total, COALESCE(SUM(CASE WHEN synced_at IS NULL THEN 1 ELSE 0 END), 0) AS pending
        FROM daily_stats`).get() as any;
    // Exactly the fields a sync sends for each row (plus nothing else), so the page can show them.
    const sample = db.prepare(`
        SELECT s.date AS date, s.provider AS provider, s.model AS model, p.name AS project,
               s.total_requests AS requests, s.total_tokens AS tokens, s.total_cost_usd AS costUsd, COALESCE(s.error_count, 0) AS errors
        FROM daily_stats s JOIN projects p ON s.project_id = p.id
        ORDER BY s.date DESC, s.total_cost_usd DESC LIMIT 10`).all();

    return {
        ...base,
        connection: {
            serverUrl: cfg.serverUrl,
            teamId: cfg.teamId,
            memberEmail: cfg.memberEmail,
            apiKeyHint: cfg.apiKey.length >= 12 ? `••••${cfg.apiKey.slice(-4)}` : '••••',
        },
        seats: info.seats ?? null,
        lastAggregateSyncAt: fromSetting('last_team_sync_at'),
        lastPolicySyncAt: fromSetting('team_policy_synced_at'),
        policyVersion: Number(getSetting('team_policy_version') || 0),
        policyError: fromSetting('team_policy_error'),
        syncError: fromSetting('team_sync_error'),
        policy: { version: Number(getSetting('team_policy_version') || 0), budgets },
        contribution: {
            windowDays: 30,
            totals: { requests: totals.requests, tokens: totals.tokens, costUsd: totals.costUsd },
            rows: counts.total,
            pendingRows: counts.pending,
            sample,
        },
    };
}

teamRouter.get('/status', async (_req, res) => {
    try {
        res.json(await buildStatus());
    } catch (err) {
        console.error('[team] status error:', (err as Error).message);
        res.status(500).json({ error: 'Failed to read the team status' });
    }
});

teamRouter.post('/sync-now', async (_req, res) => {
    try {
        if (!getTeamConfig()) return res.status(409).json({ error: 'This install has not joined a team. Run: llm-observer team join' });
        if ((await getLicenseInfo()).plan !== 'team') return res.status(403).json({ error: 'Team sync needs a Team licence.' });
        await syncManager.sync();
        res.json(await buildStatus());
    } catch (err) {
        console.error('[team] sync-now error:', (err as Error).message);
        res.status(500).json({ error: 'Sync failed' });
    }
});

teamRouter.get('/rollup', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    try {
        const bearer = /^Bearer\s+(.+)$/i.exec((req.headers.authorization || '').trim());
        if (!bearer) return res.status(401).json({ error: 'Paste a team-admin token first.' });
        const token = bearer[1];
        if (!TOKEN_RE.test(token)) return res.status(400).json({ error: 'That does not look like a team-server session token.' });

        const { from, to } = req.query;
        for (const [name, v] of [['from', from], ['to', to]] as const) {
            if (v !== undefined && !isRealDay(v)) return res.status(400).json({ error: `${name} must be a real date in YYYY-MM-DD form.` });
        }

        const cfg = getTeamConfig();
        if (!cfg) return res.status(409).json({ error: 'This install has not joined a team. Run: llm-observer team join' });
        if ((await getLicenseInfo()).plan !== 'team') return res.status(403).json({ error: 'The team rollup needs a Team licence.' });
        if (!cfg.teamId || !SLUG_RE.test(cfg.teamId)) return res.status(409).json({ error: 'The joined team id is not valid. Run: llm-observer team join again.' });

        const query = new URLSearchParams();
        if (typeof from === 'string') query.set('from', from);
        if (typeof to === 'string') query.set('to', to);
        const url = `${cfg.serverUrl}/api/team/${encodeURIComponent(cfg.teamId)}/rollup${query.toString() ? `?${query}` : ''}`;

        let upstream: Response;
        try {
            upstream = await fetch(url, {
                method: 'GET',
                headers: { Cookie: `${ACCESS_TOKEN_COOKIE}=${token}`, Accept: 'application/json' },
                redirect: 'error',
                signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
            });
        } catch (err: any) {
            console.warn(`[team] rollup: could not reach the team server (${err?.cause?.code || err?.name || 'error'})`);
            return res.status(502).json({ error: 'Could not reach the team server.' });
        }

        if (upstream.status === 401) return res.status(401).json({ error: 'The team server did not accept that token (expired or wrong server). Tokens last 15 minutes; paste a fresh one.' });
        if (upstream.status === 403) return res.status(403).json({ error: 'That token\'s user is not an admin of this team.' });
        if (upstream.status === 404) return res.status(404).json({ error: 'The team server does not know this team id.' });
        if (!upstream.ok) return res.status(502).json({ error: `The team server answered ${upstream.status}.` });

        let body: unknown;
        try { body = await upstream.json(); } catch { return res.status(502).json({ error: 'The team server sent an unreadable answer.' }); }
        res.json(body);
    } catch (err) {
        console.error('[team] rollup error:', (err as Error).message);
        res.status(500).json({ error: 'Failed to fetch the rollup' });
    }
});
