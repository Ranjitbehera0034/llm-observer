import { useState } from 'react';
import { Lock, ShieldCheck, ShieldOff, Users, Upload, KeyRound, TriangleAlert } from 'lucide-react';
import { SENT_TO_TEAM_SERVER, NEVER_SENT, PRIVACY_SUMMARY } from '../data/teamPrivacy';

export interface TeamPolicyBudget {
    id: number;
    name: string;
    scope: 'daily' | 'weekly' | 'monthly';
    provider: string | null;
    limitUsd: number;
    action: 'alert' | 'block';
    currentSpendUsd: number;
}

export interface TeamStatus {
    configured: boolean;
    licensePlan: 'free' | 'pro' | 'team';
    teamLicensed: boolean;
    connection?: { serverUrl: string; teamId: string | null; memberEmail: string; apiKeyHint: string };
    seats?: number | null;
    lastAggregateSyncAt?: string | null;
    lastPolicySyncAt?: string | null;
    policyVersion?: number;
    policyError?: string | null;
    syncError?: string | null;
    policy?: { version: number; budgets: TeamPolicyBudget[] };
    contribution?: {
        windowDays: number;
        totals: { requests: number; tokens: number; costUsd: number };
        rows: number;
        pendingRows: number;
        sample: { date: string; provider: string; model: string; project: string; requests: number; tokens: number; costUsd: number; errors: number }[];
    };
}

export interface RollupMember {
    memberId: string;
    email: string | null;
    name: string | null;
    role: string | null;
    removed: boolean;
    requests: number;
    tokens: number;
    costUsd: number;
    errors: number;
    blocked: number;
    avgLatencyMs: number;
}

export interface Rollup {
    from: string;
    to: string;
    team?: { slug: string; name: string };
    totals: { requests: number; tokens: number; costUsd: number; errors: number; blocked: number; avgLatencyMs: number };
    members: RollupMember[];
}

const PERIOD_NOUN = { daily: 'day', weekly: 'week', monthly: 'month' } as const;
const money = (n: number) => `$${n.toFixed(n >= 100 ? 0 : 2)}`;
const num = (n: number) => n.toLocaleString('en-US');
const when = (iso: string | null | undefined) => {
    if (!iso) return 'never';
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? 'unknown' : d.toLocaleString();
};

const card = 'bg-slate-900 border border-slate-800 rounded-2xl p-6';
const h3 = 'text-xs font-black text-slate-400 uppercase tracking-widest mb-4';

export function BetaBadge() {
    return <span className="text-[10px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20">Beta</span>;
}

/** Always shown, in every state, so nobody has to join to find out what would be sent. */
export function PrivacyCard() {
    return (
        <section className={card} aria-labelledby="team-privacy">
            <h3 id="team-privacy" className={h3}>What leaves this machine</h3>
            <p className="text-sm text-slate-300 mb-5">{PRIVACY_SUMMARY}</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                    <p className="flex items-center gap-2 text-xs font-bold text-amber-400 mb-2"><Upload className="w-4 h-4" /> Sent to your team server (daily aggregates)</p>
                    <ul className="text-sm text-slate-300 space-y-1 list-disc pl-5">
                        {SENT_TO_TEAM_SERVER.map(item => <li key={item}>{item}</li>)}
                    </ul>
                </div>
                <div>
                    <p className="flex items-center gap-2 text-xs font-bold text-emerald-400 mb-2"><ShieldCheck className="w-4 h-4" /> Never leaves this machine</p>
                    <ul className="text-sm text-slate-300 space-y-1 list-disc pl-5">
                        {NEVER_SENT.map(item => <li key={item}>{item}</li>)}
                    </ul>
                </div>
            </div>
            <p className="text-xs text-slate-500 mt-5">
                The team server also receives the team API key as a credential. Team budgets are advice your app follows locally; the server does not enforce anything.
            </p>
        </section>
    );
}

export function UpgradeCard({ plan, configured }: { plan: TeamStatus['licensePlan']; configured: boolean }) {
    return (
        <section className={`${card} border-indigo-500/30`} aria-labelledby="team-upgrade">
            <h3 id="team-upgrade" className={h3}>Team plan required</h3>
            <p className="text-sm text-slate-300 mb-3">
                Team features need a Team licence. Your current plan is <strong className="text-white">{plan}</strong>.
            </p>
            <ul className="text-sm text-slate-400 space-y-1 list-disc pl-5 mb-4">
                <li>Share daily usage aggregates with your team server so admins see a per-member rollup.</li>
                <li>Receive a budget policy from your admins that this app enforces locally (block or alert).</li>
            </ul>
            <p className="text-sm text-slate-400">
                Until a Team licence is active, <strong className="text-slate-200">nothing is sent to any team server and no team policy is applied</strong>.
                {configured && ' Any team budgets previously applied here have been removed; your own budgets are untouched. Your join settings are kept, so everything resumes if a Team licence is activated.'}
            </p>
            <p className="text-sm text-slate-400 mt-3">
                Activate a Team key under Settings, or see <a className="text-indigo-400 underline" href="https://www.llm-observer.com/#pricing" target="_blank" rel="noreferrer">pricing</a>.
            </p>
        </section>
    );
}

export function JoinCard() {
    return (
        <section className={card} aria-labelledby="team-join">
            <h3 id="team-join" className={h3}>Not connected to a team</h3>
            <p className="text-sm text-slate-300 mb-3">Join from a terminal with the details your team admin gave you:</p>
            <pre className="bg-black border border-slate-800 rounded-xl p-4 text-xs text-slate-200 overflow-x-auto">{`llm-observer team join \\
  --url https://team.example.com \\
  --team-id <team-id> \\
  --api-key <team api key> \\
  --email <you@example.com>`}</pre>
            <p className="text-xs text-slate-500 mt-3">The API key is checked against the server, stored on this machine and never shown again in full.</p>
        </section>
    );
}

export function ConnectionCard({ status, onSync, syncing }: { status: TeamStatus; onSync: () => void; syncing: boolean }) {
    const c = status.connection;
    if (!c) return null;
    const rows: [string, string][] = [
        ['Server', c.serverUrl],
        ['Team id', c.teamId ?? 'n/a'],
        ['Member', c.memberEmail],
        ['API key', c.apiKeyHint],
        ['Licence plan', status.licensePlan + (status.seats ? ` (${status.seats} seats bought)` : '')],
        ['Last aggregate sync', when(status.lastAggregateSyncAt)],
        ['Last policy pull', when(status.lastPolicySyncAt)],
        ['Policy version', String(status.policyVersion ?? 0)],
    ];
    return (
        <section className={card} aria-labelledby="team-connection">
            <div className="flex items-center justify-between mb-4">
                <h3 id="team-connection" className="text-xs font-black text-slate-400 uppercase tracking-widest">Connection</h3>
                <button onClick={onSync} disabled={syncing} className="text-xs font-bold px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 disabled:opacity-50">
                    {syncing ? 'Syncing…' : 'Sync now'}
                </button>
            </div>
            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-2 text-sm">
                {rows.map(([k, v]) => (
                    <div key={k} className="flex justify-between gap-4 border-b border-slate-800/60 py-1.5">
                        <dt className="text-slate-500">{k}</dt>
                        <dd className="text-slate-200 font-mono text-xs text-right break-all">{v}</dd>
                    </div>
                ))}
            </dl>
            {(status.policyError || status.syncError) && (
                <div className="mt-4 flex gap-3 text-xs text-amber-400 bg-amber-500/5 border border-amber-500/20 rounded-xl p-3">
                    <TriangleAlert className="w-4 h-4 shrink-0" />
                    <div className="space-y-1">
                        {status.policyError && <p>Policy: {status.policyError}. The last policy stays in force.</p>}
                        {status.syncError && <p>Sync: {status.syncError}.</p>}
                    </div>
                </div>
            )}
        </section>
    );
}

export function PolicyCard({ policy }: { policy: NonNullable<TeamStatus['policy']> }) {
    return (
        <section className={card} aria-labelledby="team-policy">
            <h3 id="team-policy" className={h3}>Active team policy (version {policy.version})</h3>
            {policy.budgets.length === 0 ? (
                <p className="text-sm text-slate-400">Your team has not set any budgets (or none has been pulled yet).</p>
            ) : (
                <ul className="space-y-3">
                    {policy.budgets.map(b => {
                        const pct = Math.min(100, (b.currentSpendUsd / b.limitUsd) * 100);
                        return (
                            <li key={b.id} className="bg-black/40 border border-slate-800 rounded-xl p-4">
                                <div className="flex items-center justify-between gap-3">
                                    <p className="text-sm text-white font-medium flex items-center gap-2">
                                        <Lock className="w-3.5 h-3.5 text-slate-500" aria-label="set by your team" />
                                        {b.scope[0].toUpperCase() + b.scope.slice(1)} · {b.provider ?? 'all providers'}
                                    </p>
                                    <span className={`text-[10px] font-black uppercase px-2 py-0.5 rounded-full border ${b.action === 'block' ? 'bg-red-500/10 text-red-400 border-red-500/20' : 'bg-slate-800 text-slate-400 border-slate-700'}`}>
                                        {b.action === 'block' ? 'Block (best effort)' : 'Alert only'}
                                    </span>
                                </div>
                                <div className="mt-3 h-1.5 bg-slate-800 rounded-full overflow-hidden"><div className="h-full bg-indigo-500" style={{ width: `${pct}%` }} /></div>
                                <p className="text-xs text-slate-500 mt-2">{money(b.currentSpendUsd)} of {money(b.limitUsd)} this {PERIOD_NOUN[b.scope]}</p>
                            </li>
                        );
                    })}
                </ul>
            )}
            <p className="text-xs text-slate-500 mt-4">These budgets are set by your team and are read-only here. Blocking is enforced by this app on this machine and is best effort: spend is recorded in short batches, so a burst can pass a limit before it is blocked.</p>
        </section>
    );
}

export function ContributionCard({ contribution }: { contribution: NonNullable<TeamStatus['contribution']> }) {
    const t = contribution.totals;
    return (
        <section className={card} aria-labelledby="team-contribution">
            <h3 id="team-contribution" className={h3}>This device's contribution (last {contribution.windowDays} days)</h3>
            <div className="grid grid-cols-3 gap-4 mb-5">
                {([['Requests', num(t.requests)], ['Tokens', num(t.tokens)], ['Cost', money(t.costUsd)]] as const).map(([k, v]) => (
                    <div key={k} className="bg-black/40 border border-slate-800 rounded-xl p-4">
                        <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest">{k}</p>
                        <p className="text-xl font-black text-white mt-1">{v}</p>
                    </div>
                ))}
            </div>
            <p className="text-xs text-slate-500 mb-3">{num(contribution.rows)} daily row(s) on this device; {num(contribution.pendingRows)} not yet sent. These are the most recent rows, exactly the fields that are sent (plus your email):</p>
            <div className="overflow-x-auto">
                <table className="w-full text-xs text-left">
                    <thead className="text-slate-500 uppercase tracking-widest text-[10px]">
                        <tr>{['Date', 'Provider', 'Model', 'Project', 'Requests', 'Tokens', 'Cost', 'Errors'].map(h => <th key={h} className="py-2 pr-4 font-black">{h}</th>)}</tr>
                    </thead>
                    <tbody className="text-slate-300 font-mono">
                        {contribution.sample.map((r, i) => (
                            <tr key={i} className="border-t border-slate-800/60">
                                <td className="py-1.5 pr-4">{r.date}</td><td className="pr-4">{r.provider}</td><td className="pr-4">{r.model}</td><td className="pr-4">{r.project}</td>
                                <td className="pr-4">{num(r.requests)}</td><td className="pr-4">{num(r.tokens)}</td><td className="pr-4">{money(r.costUsd)}</td><td>{r.errors}</td>
                            </tr>
                        ))}
                        {contribution.sample.length === 0 && <tr><td colSpan={8} className="py-3 text-slate-500">No aggregated usage on this device yet.</td></tr>}
                    </tbody>
                </table>
            </div>
        </section>
    );
}

export function RollupCard(props: {
    hasToken: boolean;
    loading: boolean;
    error: string | null;
    rollup: Rollup | null;
    onSubmitToken: (token: string) => void;
    onForget: () => void;
    onRefresh: () => void;
}) {
    const [draft, setDraft] = useState('');
    return (
        <section className={card} aria-labelledby="team-rollup">
            <div className="flex items-center justify-between mb-4">
                <h3 id="team-rollup" className="text-xs font-black text-slate-400 uppercase tracking-widest flex items-center gap-2"><Users className="w-4 h-4" /> Team rollup (admins)</h3>
                {props.hasToken && (
                    <div className="flex gap-2">
                        <button onClick={props.onRefresh} className="text-xs font-bold px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200">Refresh</button>
                        <button onClick={props.onForget} className="text-xs font-bold px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-red-500/20 text-slate-300">Forget token</button>
                    </div>
                )}
            </div>

            {!props.hasToken && (
                <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); if (draft.trim()) { props.onSubmitToken(draft.trim()); setDraft(''); } }}>
                    <p className="text-sm text-slate-400">
                        Team admins can paste a team-server session token (the <code className="text-slate-300">llmo_access_token</code> cookie from signing in to the team server) to see usage per member.
                        The token is kept in this browser tab only (sessionStorage) and is sent only to this app, which forwards it to your configured team server. It is not stored on disk. Tokens expire after 15 minutes.
                    </p>
                    <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest" htmlFor="team-admin-token">Team-admin token</label>
                    <div className="flex gap-2">
                        <input id="team-admin-token" type="password" autoComplete="off" spellCheck={false} value={draft} onChange={e => setDraft(e.target.value)}
                            className="flex-1 bg-black border border-slate-800 rounded-xl px-4 py-2.5 text-white font-mono text-xs focus:outline-none focus:border-indigo-500" placeholder="eyJ…" />
                        <button type="submit" className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white font-bold px-4 rounded-xl text-sm"><KeyRound className="w-4 h-4" /> Load rollup</button>
                    </div>
                </form>
            )}

            {props.error && <p role="alert" className="text-sm text-amber-400 mt-3">{props.error}</p>}
            {props.loading && <p className="text-sm text-slate-500 mt-3">Loading…</p>}

            {props.rollup && (
                <div className="mt-4">
                    <p className="text-xs text-slate-500 mb-3">{props.rollup.from} to {props.rollup.to} (UTC days) · total {money(props.rollup.totals.costUsd)} · {num(props.rollup.totals.requests)} requests</p>
                    <div className="overflow-x-auto">
                        <table className="w-full text-xs text-left">
                            <thead className="text-slate-500 uppercase tracking-widest text-[10px]">
                                <tr>{['Member', 'Role', 'Requests', 'Tokens', 'Cost', 'Errors', 'Blocked', 'Avg latency'].map(h => <th key={h} className="py-2 pr-4 font-black">{h}</th>)}</tr>
                            </thead>
                            <tbody className="text-slate-300">
                                {props.rollup.members.map(m => (
                                    <tr key={m.memberId} className="border-t border-slate-800/60">
                                        <td className="py-1.5 pr-4">{m.email ?? 'Former member'}{m.removed && <span className="ml-2 text-[10px] text-slate-500">(removed)</span>}</td>
                                        <td className="pr-4">{m.role ?? '-'}</td>
                                        <td className="pr-4 font-mono">{num(m.requests)}</td><td className="pr-4 font-mono">{num(m.tokens)}</td>
                                        <td className="pr-4 font-mono">{money(m.costUsd)}</td><td className="pr-4 font-mono">{m.errors}</td><td className="pr-4 font-mono">{m.blocked}</td>
                                        <td className="font-mono">{Math.round(m.avgLatencyMs)} ms</td>
                                    </tr>
                                ))}
                                {props.rollup.members.length === 0 && <tr><td colSpan={8} className="py-3 text-slate-500">No member usage in this range.</td></tr>}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}
            <p className="text-xs text-slate-500 mt-4 flex items-center gap-2"><ShieldOff className="w-3.5 h-3.5" /> Member attribution is only as trustworthy as your team: the email on each sync is claimed by whoever holds the team key.</p>
        </section>
    );
}
