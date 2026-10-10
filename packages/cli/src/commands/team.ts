import { Command } from 'commander';
import chalk from 'chalk';
import { getDb, getSetting, updateSetting, getBudgetLimits, deleteTeamBudgets } from '@llm-observer/database';

/**
 * Team tier (beta) commands. They only read and write this machine's settings (and ask the team server
 * once, on `join`, whether the credentials work). The running app does the syncing and enforcing; see
 * docs/guide/team.md. The team API key is a secret: it is stored in the local database and is never
 * printed back, only its last four characters.
 */

const DASHBOARD_API_URL = () => process.env.DASHBOARD_API_URL || 'http://localhost:4001';
const SLUG_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);

/** Everything `join` writes or the sync manager records; `leave` clears these. */
const TEAM_KEYS_TO_CLEAR = [
    'team_server_url', 'team_id', 'team_api_key', 'team_member_email', 'team_sync_enabled',
    'team_policy_synced_at', 'team_policy_error', 'team_sync_error', 'team_license_plan', 'team_license_checked_at',
    'last_team_sync_at',
];

export function maskKey(key: string): string {
    return key.length >= 12 ? `••••${key.slice(-4)}` : '••••';
}

function fail(message: string): void {
    console.error(chalk.red(`Error: ${message}`));
    process.exitCode = 1;
}

/** http(s) only, no embedded credentials, plain http only to this machine unless allowed. Returns the base URL or an error string. */
function normaliseUrl(raw: string, allowHttp: boolean): { url: string } | { error: string } {
    let u: URL;
    try { u = new URL(raw); } catch { return { error: '--url must be a full URL such as https://team.example.com' }; }
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return { error: '--url must start with https:// (or http://).' };
    if (u.username || u.password) return { error: '--url must not contain credentials; pass the key with --api-key.' };
    if (u.protocol === 'http:' && !LOOPBACK.has(u.hostname) && !allowHttp) {
        return { error: 'The team API key would travel unencrypted. Use an https:// URL (or --allow-http on a network you trust).' };
    }
    return { url: `${u.origin}${u.pathname.replace(/\/+$/, '')}` };
}

type VerifyResult = { ok: true; version: number | null; budgets: number | null } | { ok: false; message: string };

async function verifyCredentials(baseUrl: string, apiKey: string, email: string): Promise<VerifyResult> {
    let res: Response;
    try {
        res = await fetch(`${baseUrl}/api/team/policy`, {
            method: 'GET',
            headers: { Authorization: `Bearer ${apiKey}`, 'X-Team-Member-Email': email, Accept: 'application/json' },
            redirect: 'error',
            signal: AbortSignal.timeout(10_000),
        });
    } catch (err: any) {
        const why = err?.cause?.code || (err?.name === 'TimeoutError' ? 'timed out' : 'network error');
        return { ok: false, message: `Could not reach ${baseUrl} (${why}). Check the URL, or pass --no-verify to save the settings without checking.` };
    }
    let body: any;
    try { body = await res.json(); } catch { body = undefined; }
    const serverSays = typeof body?.error === 'string' ? ` ${body.error.slice(0, 160)}` : '';
    if (res.status === 401) return { ok: false, message: 'The team server rejected the API key. Ask your team admin for the current key (it may have been rotated).' };
    if (res.status === 403) return { ok: false, message: `The team server refused this member.${serverSays}` };
    if (res.status === 400) return { ok: false, message: `The team server did not accept the request.${serverSays}` };
    if (!res.ok) return { ok: false, message: `The team server answered ${res.status}.${serverSays}` };
    return {
        ok: true,
        version: Number.isInteger(body?.version) ? body.version : null,
        budgets: Array.isArray(body?.budgets) ? body.budgets.length : null,
    };
}

function fmtTime(iso: string | null): string {
    if (!iso) return chalk.gray('never');
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? chalk.gray('unknown') : chalk.blue(d.toLocaleString());
}

export function setupTeamCommands(program: Command) {
    const team = program.command('team').description('Team tier (beta): join a team server, see its budget policy, leave');

    team
        .command('join')
        .description('Join a team: save the server URL, team id, API key and your email')
        .option('--url <url>', 'Team server URL, e.g. https://team.example.com')
        .option('--team-id <slug>', 'Team id (the slug your admin gave you)')
        .option('--api-key <key>', 'Team API key (or set LLM_OBSERVER_TEAM_API_KEY to keep it out of shell history)')
        .option('--email <email>', 'Your email as invited to the team')
        .option('--no-verify', 'Save without checking the credentials against the team server')
        .option('--allow-http', 'Allow plain http:// to a non-local server')
        .action(async (options) => {
            const apiKey: string | undefined = options.apiKey || process.env.LLM_OBSERVER_TEAM_API_KEY;
            if (!options.url) return fail('--url <url> is required.');
            if (!options.teamId) return fail('--team-id <slug> is required.');
            if (!apiKey) return fail('--api-key <key> is required (or set LLM_OBSERVER_TEAM_API_KEY).');
            if (!options.email) return fail('--email <email> is required.');

            if (!SLUG_RE.test(options.teamId)) return fail('--team-id may only contain letters, digits, dots, dashes and underscores.');
            if (/\s/.test(apiKey)) return fail('--api-key must not contain whitespace.');
            const email = String(options.email).trim().toLowerCase();
            if (!EMAIL_RE.test(email)) return fail('--email must be a valid email address.');
            const checked = normaliseUrl(String(options.url).trim(), !!options.allowHttp);
            if ('error' in checked) return fail(checked.error);
            const baseUrl = checked.url;

            let info: { version: number | null; budgets: number | null } | null = null;
            if (options.verify !== false) {
                console.log(chalk.blue(`Checking ${baseUrl} ...`));
                const result = await verifyCredentials(baseUrl, apiKey, email);
                if (!result.ok) return fail(result.message);
                info = result;
            }

            // A different team (or server) must not keep the old team's budgets.
            const changedTeam = (getSetting('team_server_url') || '') !== baseUrl || (getSetting('team_id') || '') !== options.teamId;
            const wasJoined = !!getSetting('team_api_key');
            if (wasJoined && changedTeam) {
                deleteTeamBudgets();
                for (const k of ['team_policy_synced_at', 'team_policy_error', 'team_sync_error', 'last_team_sync_at']) updateSetting(k, '');
                updateSetting('team_policy_version', '0');
            }

            const db = getDb();
            db.transaction(() => {
                updateSetting('team_server_url', baseUrl);
                updateSetting('team_id', options.teamId);
                updateSetting('team_api_key', apiKey);
                updateSetting('team_member_email', email);
                updateSetting('team_sync_enabled', 'true');
            })();

            console.log(chalk.green(`Joined team "${options.teamId}" as ${email}.`));
            console.log(`  Server:  ${baseUrl}`);
            console.log(`  API key: ${maskKey(apiKey)}`);
            if (info?.version !== null && info?.version !== undefined) {
                console.log(`  Policy:  version ${info.version}${info.budgets !== null ? `, ${info.budgets} budget(s)` : ''} (applied by the running app)`);
            }
            console.log(chalk.gray('A Team licence is required: with any other plan nothing is sent and no team policy is applied.'));
            console.log(chalk.gray('The running app pushes daily aggregates and pulls the policy every 15 minutes. Check: llm-observer team status'));
            console.log(chalk.gray('Sent to the team server: per day, provider, model, project name, request/token/cost totals, error counts and your email. Never prompts, responses, file paths or sessions.'));
        });

    team
        .command('status')
        .description('Show the team connection, last sync, policy version and licence plan')
        .action(() => {
            const key = getSetting('team_api_key');
            if (!key) {
                console.log(chalk.yellow('Not joined to a team. Run `llm-observer team join --url <url> --team-id <slug> --api-key <key> --email <you>`.'));
                return;
            }
            const enabled = getSetting('team_sync_enabled') === 'true';
            const plan = getSetting('team_license_plan');
            const checkedAt = getSetting('team_license_checked_at');
            const teamBudgets = getBudgetLimits().filter(b => b.source === 'team').length;
            const policyError = getSetting('team_policy_error');
            const syncError = getSetting('team_sync_error');

            console.log(chalk.bold('Team (beta)'));
            console.log(`- Connection:    ${enabled ? chalk.green('joined') : chalk.red('sync switched off')}`);
            console.log(`- Server:        ${getSetting('team_server_url') || chalk.gray('(default)')}`);
            console.log(`- Team id:       ${getSetting('team_id') || chalk.gray('n/a')}`);
            console.log(`- Member:        ${getSetting('team_member_email') || chalk.gray('n/a')}`);
            console.log(`- API key:       ${maskKey(key)}`);
            if (!plan) {
                console.log(`- Licence plan:  ${chalk.yellow('not yet checked')} (the running app records it; start it with \`llm-observer start\`)`);
            } else {
                const label = plan === 'team' ? chalk.green('team') : chalk.yellow(plan);
                console.log(`- Licence plan:  ${label}${checkedAt ? chalk.gray(` (as last seen by the app, ${new Date(checkedAt).toLocaleString()})`) : ''}`);
                if (plan !== 'team') console.log(chalk.yellow('  Team features are inactive: nothing is synced and team budgets are removed until the licence is a Team plan.'));
            }
            console.log(`- Last sync:     ${fmtTime(getSetting('last_team_sync_at'))} ${chalk.gray('(daily aggregates pushed)')}`);
            console.log(`- Last policy:   ${fmtTime(getSetting('team_policy_synced_at'))}`);
            console.log(`- Policy version: ${Number(getSetting('team_policy_version') || 0)}`);
            console.log(`- Applied here:  ${teamBudgets} team budget${teamBudgets === 1 ? '' : 's'}`);
            if (policyError) console.log(chalk.yellow(`- Last policy error: ${policyError} (the last policy stays in force)`));
            if (syncError) console.log(chalk.yellow(`- Last sync error:   ${syncError}`));
        });

    team
        .command('leave')
        .description('Leave the team: remove the saved settings and every team-set budget (local budgets and data are kept)')
        .action(() => {
            const wasJoined = !!getSetting('team_api_key');
            const db = getDb();
            const removed = db.transaction(() => {
                for (const k of TEAM_KEYS_TO_CLEAR) db.prepare('DELETE FROM settings WHERE key = ?').run(k);
                updateSetting('team_policy_version', '0');
                return deleteTeamBudgets();
            })();

            if (!wasJoined) {
                console.log(chalk.yellow('Not joined to a team.') + (removed ? ` Removed ${removed} leftover team budget(s).` : ''));
                return;
            }
            console.log(chalk.green('You have left the team.'));
            console.log(`  Removed the team settings and ${removed} team budget${removed === 1 ? '' : 's'}. Your own budgets and usage data are untouched.`);
            console.log(chalk.gray('  Data already sent to the team server stays there; ask your team admin to remove it.'));
        });

    team
        .command('sync')
        .description('Ask the running app to push aggregates and pull the policy now')
        .action(async () => {
            try {
                const res = await fetch(`${DASHBOARD_API_URL()}/api/team/sync-now`, { method: 'POST', signal: AbortSignal.timeout(60_000) });
                const body: any = await res.json().catch(() => ({}));
                if (!res.ok) return fail(body?.error || `The app answered ${res.status}.`);
                console.log(chalk.green('Sync finished.'));
                console.log(`  Policy version ${body.policyVersion ?? 0}.${body.policyError ? chalk.yellow(` Last policy error: ${body.policyError}`) : ''}`);
            } catch {
                fail('Could not reach the app on the dashboard port. Is `llm-observer start` running?');
            }
        });
}
