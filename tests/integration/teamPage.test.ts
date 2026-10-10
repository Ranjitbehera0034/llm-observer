/**
 * Team page (beta): server-rendered snapshots of the presentational panels. No browser is involved, so this
 * checks what each state SAYS (upgrade explanation, privacy statement, read-only policy, admin token handling),
 * not layout or interaction. The real page was not opened in a browser for this item.
 */
import fs from 'fs';
import path from 'path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
    PrivacyCard, UpgradeCard, JoinCard, ConnectionCard, PolicyCard, ContributionCard, RollupCard,
    type TeamStatus,
} from '../../packages/dashboard/src/components/TeamPanels';
import { SENT_TO_TEAM_SERVER, NEVER_SENT } from '../../packages/dashboard/src/data/teamPrivacy';

const html = (el: any) => renderToStaticMarkup(el);
const text = (el: any) => html(el).replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/\s+/g, ' ');

const status: TeamStatus = {
    configured: true, licensePlan: 'team', teamLicensed: true, seats: 5,
    connection: { serverUrl: 'https://team.example.com', teamId: 'acme', memberEmail: 'dev@example.com', apiKeyHint: '••••cdef' },
    lastAggregateSyncAt: '2026-10-09T10:00:00.000Z', lastPolicySyncAt: '2026-10-09T10:01:00.000Z', policyVersion: 3,
    policy: { version: 3, budgets: [
        { id: 1, name: 'Team daily budget (block)', scope: 'daily', provider: null, limitUsd: 25, action: 'block', currentSpendUsd: 10 },
        { id: 2, name: 'Team monthly anthropic budget (alert)', scope: 'monthly', provider: 'anthropic', limitUsd: 400, action: 'alert', currentSpendUsd: 50 },
    ] },
    contribution: { windowDays: 30, totals: { requests: 12, tokens: 3400, costUsd: 1.5 }, rows: 3, pendingRows: 1,
        sample: [{ date: '2026-10-09', provider: 'openai', model: 'gpt-4o', project: 'Default Project', requests: 4, tokens: 400, costUsd: 1.25, errors: 0 }] },
};

describe('privacy statement', () => {
    const t = text(createElement(PrivacyCard));
    it('lists plainly what is sent and what is not', () => {
        for (const item of [...SENT_TO_TEAM_SERVER, ...NEVER_SENT]) expect(t).toContain(item);
        expect(t).toMatch(/date, provider, model, project name/);
        expect(t).toMatch(/request, token and cost totals/);
        expect(t).toMatch(/error/i);
        expect(t).toMatch(/email address/);
        expect(t).toMatch(/never sends prompts, responses, file paths or sessions/i);
    });
});

describe('the guide says the same thing as the page', () => {
    it('docs/guide/team.md states what is and is not sent', () => {
        const guide = fs.readFileSync(path.join(__dirname, '..', '..', 'docs', 'guide', 'team.md'), 'utf8');
        for (const word of ['date', 'provider and model', 'project name', 'request, token and cost totals', 'error count', 'email address',
            'prompts', 'responses', 'file paths', 'sessions']) {
            expect(guide.toLowerCase()).toContain(word);
        }
        expect(guide).toMatch(/SSO UI/);
        expect(guide).toMatch(/Seat billing/);
        expect(guide).toMatch(/Invitations/);
        expect(guide).toMatch(/Audit log/);
    });
});

describe('licence gating', () => {
    it('without a Team licence the upgrade explanation is shown and no team data is in it', () => {
        const t = text(createElement(UpgradeCard, { plan: 'pro', configured: true }));
        expect(t).toMatch(/Team features need a Team licence/);
        expect(t).toMatch(/current plan is pro/);
        expect(t).toMatch(/nothing is sent to any team server/);
        expect(t).not.toMatch(/dev@example.com|team\.example\.com/);
    });
    it('the join card shows the CLI command and no secrets', () => {
        const t = text(createElement(JoinCard));
        expect(t).toMatch(/llm-observer team join/);
        expect(t).toMatch(/--api-key/);
    });
});

describe('connected view', () => {
    it('connection shows the masked key only, the policy version and last syncs', () => {
        const h = html(createElement(ConnectionCard, { status, onSync: () => {}, syncing: false }));
        expect(h).toContain('••••cdef');
        expect(h).toContain('https://team.example.com');
        expect(h).toContain('dev@example.com');
        expect(text(createElement(ConnectionCard, { status, onSync: () => {}, syncing: false }))).toMatch(/Policy version 3/);
    });
    it('shows a stale-policy warning when the last pull failed', () => {
        const t = text(createElement(ConnectionCard, { status: { ...status, policyError: 'could not reach the team server (ECONNREFUSED)' }, onSync: () => {}, syncing: false }));
        expect(t).toMatch(/ECONNREFUSED/);
        expect(t).toMatch(/last policy stays in force/);
    });
    it('policy budgets are read-only (no inputs or buttons) and marked as team-set', () => {
        const h = html(createElement(PolicyCard, { policy: status.policy! }));
        expect(h).not.toMatch(/<input|<button|<select/);
        expect(h).toMatch(/set by your team/);
        const t = text(createElement(PolicyCard, { policy: status.policy! }));
        expect(t).toMatch(/Daily · all providers/);
        expect(t).toMatch(/Monthly · anthropic/);
        expect(t).toMatch(/Block \(best effort\)/);
        expect(t).toMatch(/Alert only/);
    });
    it('contribution shows the fields that are sent', () => {
        const t = text(createElement(ContributionCard, { contribution: status.contribution! }));
        expect(t).toMatch(/Date Provider Model Project Requests Tokens Cost Errors/);
        expect(t).toMatch(/Default Project/);
        expect(t).toMatch(/1 not yet sent/);
    });
});

describe('admin rollup', () => {
    const base = { loading: false, error: null, rollup: null, onSubmitToken: () => {}, onForget: () => {}, onRefresh: () => {} };
    it('without a token: a password field, kept-in-tab explanation, and no table', () => {
        const h = html(createElement(RollupCard, { ...base, hasToken: false }));
        expect(h).toMatch(/type="password"/);
        expect(h).toMatch(/autoComplete="off"|autocomplete="off"/);
        expect(text(createElement(RollupCard, { ...base, hasToken: false }))).toMatch(/kept in this browser tab only \(sessionStorage\)/);
        expect(h).not.toMatch(/<table/);
    });
    it('with a rollup: the member table, former members flagged', () => {
        const rollup = { from: '2026-09-10', to: '2026-10-09', totals: { requests: 10, tokens: 1000, costUsd: 4.5, errors: 1, blocked: 0, avgLatencyMs: 300 },
            members: [
                { memberId: 'a', email: 'a@example.com', name: null, role: 'admin', removed: false, requests: 8, tokens: 800, costUsd: 4, errors: 1, blocked: 0, avgLatencyMs: 310.4 },
                { memberId: 'b', email: null, name: null, role: null, removed: true, requests: 2, tokens: 200, costUsd: 0.5, errors: 0, blocked: 0, avgLatencyMs: 250 },
            ] };
        const t = text(createElement(RollupCard, { ...base, hasToken: true, rollup }));
        expect(t).toMatch(/Member Role Requests Tokens Cost Errors Blocked Avg latency/);
        expect(t).toMatch(/a@example.com/);
        expect(t).toMatch(/Former member \(removed\)/);
        expect(t).toMatch(/Forget token/);
    });
    it('shows an error from the proxy route', () => {
        expect(text(createElement(RollupCard, { ...base, hasToken: false, error: 'The team server did not accept that token' }))).toMatch(/did not accept that token/);
    });
});
