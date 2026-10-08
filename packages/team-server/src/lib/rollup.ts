/** Folds TeamDailyStats rows into the views the admin rollup returns. Pure, so it is unit-testable. */

export interface StatRow {
    member_id: unknown;
    date: Date;
    provider: string;
    llm_model: string;
    total_requests?: number;
    total_tokens?: number;
    total_cost_usd?: number;
    avg_latency_ms?: number;
    error_count?: number;
    blocked_count?: number;
}

export interface MemberInfo {
    memberId: string;
    membershipId: string;
    email: string | null;
    name: string | null;
    role: string;
}

interface Acc { requests: number; tokens: number; cost: number; errors: number; blocked: number; latencyWeighted: number }
const zero = (): Acc => ({ requests: 0, tokens: 0, cost: 0, errors: 0, blocked: 0, latencyWeighted: 0 });

const round = (n: number, dp: number) => Math.round(n * 10 ** dp) / 10 ** dp;

function add(a: Acc, r: StatRow) {
    const requests = r.total_requests ?? 0;
    a.requests += requests;
    a.tokens += r.total_tokens ?? 0;
    a.cost += r.total_cost_usd ?? 0;
    a.errors += r.error_count ?? 0;
    a.blocked += r.blocked_count ?? 0;
    // avg_latency_ms is a per-row average, so weight it by that row's request count
    a.latencyWeighted += (r.avg_latency_ms ?? 0) * requests;
}

export function metrics(a: Acc) {
    return {
        requests: a.requests,
        tokens: a.tokens,
        costUsd: round(a.cost, 6),
        errors: a.errors,
        blocked: a.blocked,
        avgLatencyMs: a.requests > 0 ? round(a.latencyWeighted / a.requests, 2) : 0
    };
}

const dayKey = (d: Date) => new Date(d).toISOString().slice(0, 10);

function group<K extends string>(rows: StatRow[], key: (r: StatRow) => K) {
    const map = new Map<K, Acc>();
    for (const r of rows) {
        const k = key(r);
        let acc = map.get(k);
        if (!acc) { acc = zero(); map.set(k, acc); }
        add(acc, r);
    }
    return map;
}

const byCostDesc = <T extends { costUsd: number }>(a: T, b: T) => b.costUsd - a.costUsd;

export function buildRollup(rows: StatRow[], members: MemberInfo[]) {
    const total = zero();
    for (const r of rows) add(total, r);

    const perMember = group(rows, (r) => String(r.member_id));
    const known = new Set(members.map((m) => m.memberId));

    const memberRows = [
        ...members.map((m) => ({ ...m, removed: false })),
        // Stats from someone no longer on the team stay in the totals, shown as a former member.
        ...[...perMember.keys()].filter((id) => !known.has(id))
            .map((id) => ({ memberId: id, membershipId: null, email: null, name: null, role: null, removed: true })),
    ].map((m) => ({ ...m, ...metrics(perMember.get(m.memberId) ?? zero()) }))
        .sort((a, b) => byCostDesc(a, b) || String(a.email ?? '~').localeCompare(String(b.email ?? '~')));

    const days = [...group(rows, (r) => dayKey(r.date) as string)]
        .map(([date, a]) => ({ date, ...metrics(a) }))
        .sort((a, b) => a.date.localeCompare(b.date));

    const memberDays = [...group(rows, (r) => `${dayKey(r.date)}|${String(r.member_id)}`)]
        .map(([k, a]) => { const [date, memberId] = k.split('|'); return { date, memberId, ...metrics(a) }; })
        .sort((a, b) => a.date.localeCompare(b.date) || a.memberId.localeCompare(b.memberId));

    const providers = [...group(rows, (r) => r.provider)]
        .map(([provider, a]) => ({ provider, ...metrics(a) })).sort(byCostDesc);

    const models = [...group(rows, (r) => `${r.provider}|${r.llm_model}`)]
        .map(([k, a]) => { const i = k.indexOf('|'); return { provider: k.slice(0, i), model: k.slice(i + 1), ...metrics(a) }; })
        .sort(byCostDesc);

    return { totals: metrics(total), members: memberRows, days, memberDays, providers, models };
}
