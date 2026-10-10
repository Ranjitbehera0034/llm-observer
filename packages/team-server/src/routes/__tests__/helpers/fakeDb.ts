/**
 * In-memory stand-ins for the Mongoose models, for route tests that must not need a
 * real MongoDB. They implement only what the routes call (equality, $in, $gte/$lte,
 * thenable query chains) and are NOT a MongoDB emulator: they cannot catch a schema or
 * index mistake, so keep the queries the routes issue simple.
 */
type Doc = Record<string, any>;

export const db = {
    teams: [] as Doc[],
    members: [] as Doc[],
    users: [] as Doc[],
    policies: [] as Doc[],
    stats: [] as Doc[],
    /** Every filter passed to TeamDailyStats.find, so tests can assert team scoping. */
    statsQueries: [] as Doc[],
};

export function resetDb() {
    db.teams = []; db.members = []; db.users = []; db.policies = []; db.stats = []; db.statsQueries = [];
}

const same = (a: any, b: any) => String(a) === String(b);

function matches(doc: Doc, query: Doc): boolean {
    return Object.entries(query).every(([k, cond]) => {
        const v = k === 'id' ? doc._id : doc[k];
        if (cond && typeof cond === 'object' && !(cond instanceof Date) && !Array.isArray(cond)) {
            if ('$in' in cond) return cond.$in.some((x: any) => same(x, v));
            if ('$gte' in cond || '$lte' in cond) {
                const t = new Date(v).getTime();
                return (!('$gte' in cond) || t >= new Date(cond.$gte).getTime()) && (!('$lte' in cond) || t <= new Date(cond.$lte).getTime());
            }
        }
        if (cond instanceof Date) return v instanceof Date && v.getTime() === cond.getTime();
        return same(v, cond);
    });
}

/** A thenable that also tolerates the chain methods the routes use (select/lean/sort/populate). */
function query<T>(resolve: () => T) {
    const q: any = {
        select: () => q, lean: () => q, sort: () => q, populate: () => q,
        then: (ok: any, fail: any) => Promise.resolve().then(resolve).then(ok, fail),
    };
    return q;
}

let counter = 0;
const withDoc = (d: Doc) => Object.assign(d, { id: String(d._id), save: async () => d });

function model(coll: keyof Omit<typeof db, 'statsQueries'>, prefix: string, onFind?: (q: Doc) => void) {
    return {
        findOne: (q: Doc) => query(() => (db[coll] as Doc[]).find((d) => matches(d, q)) ?? null),
        findById: (id: any) => query(() => (db[coll] as Doc[]).find((d) => same(d._id, id)) ?? null),
        find: (q: Doc = {}) => query(() => { onFind?.(q); return (db[coll] as Doc[]).filter((d) => matches(d, q)); }),
        countDocuments: async (q: Doc = {}) => (db[coll] as Doc[]).filter((d) => matches(d, q)).length,
        create: async (d: Doc) => { const doc = withDoc({ _id: `${prefix}_${++counter}`, ...d }); (db[coll] as Doc[]).push(doc); return doc; },
        deleteOne: async (q: Doc) => {
            const list = db[coll] as Doc[];
            const i = list.findIndex((d) => matches(d, q));
            if (i >= 0) list.splice(i, 1);
            return { deletedCount: i >= 0 ? 1 : 0 };
        },
    };
}

export const Team = model('teams', 'team');
export const TeamMember = model('members', 'member');
export const User = model('users', 'user');
export const TeamDailyStats = {
    ...model('stats', 'stat', (q) => db.statsQueries.push(q)),
    bulkWrite: async () => ({ ok: 1 }),
};
export const TeamPolicy = {
    ...model('policies', 'policy'),
    /** Supports $set, $inc and upsert, which is all the policy route uses. */
    findOneAndUpdate: async (filter: Doc, update: Doc) => {
        let doc = db.policies.find((d) => matches(d, filter));
        if (!doc) { doc = withDoc({ _id: `policy_${++counter}`, ...filter, version: 0 }); db.policies.push(doc); }
        Object.assign(doc, update.$set ?? {});
        for (const [k, n] of Object.entries(update.$inc ?? {})) doc[k] = (doc[k] ?? 0) + (n as number);
        return doc;
    },
};

export const seedTeam = (d: Doc) => { const t = withDoc({ plan: 'team', max_seats: 10, ...d }); db.teams.push(t); return t; };
export const seedUser = (d: Doc) => { const u = withDoc({ ...d }); db.users.push(u); return u; };
export const seedMember = (d: Doc) => { const m = withDoc({ joined_at: new Date('2026-01-01'), ...d }); db.members.push(m); return m; };
