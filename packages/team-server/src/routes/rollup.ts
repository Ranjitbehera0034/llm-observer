import { Router } from 'express';
import TeamMember from '../models/TeamMember';
import TeamDailyStats from '../models/TeamDailyStats';
import User from '../models/User';
import { requireAuth, requireTeamRole } from '../middleware/requireAuth';
import { buildRollup, type MemberInfo, type StatRow } from '../lib/rollup';

const router = Router();

const DAY_MS = 86_400_000;
const MAX_DAYS = 366;
const DEFAULT_DAYS = 30;

/** Strict YYYY-MM-DD that is a real calendar day; returns UTC midnight, or null. */
function parseDay(v: unknown): Date | null {
    if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
    const d = new Date(`${v}T00:00:00.000Z`);
    return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v ? null : d;
}
const iso = (d: Date) => d.toISOString().slice(0, 10);

// GET /api/team/:teamSlug/rollup?from=YYYY-MM-DD&to=YYYY-MM-DD  (inclusive, UTC days; default last 30 days)
router.get('/:teamSlug/rollup', requireAuth, requireTeamRole('admin'), async (req, res) => {
    try {
        const { from: rawFrom, to: rawTo } = req.query;
        const today = parseDay(new Date(Date.now()).toISOString().slice(0, 10))!;

        const to = rawTo === undefined ? today : parseDay(rawTo);
        const from = rawFrom === undefined ? (to ? new Date(to.getTime() - (DEFAULT_DAYS - 1) * DAY_MS) : null) : parseDay(rawFrom);
        if (!from || !to) return res.status(400).json({ error: 'from and to must be real dates in YYYY-MM-DD form.' });
        if (from > to) return res.status(400).json({ error: 'from must not be after to.' });
        if ((to.getTime() - from.getTime()) / DAY_MS + 1 > MAX_DAYS) {
            return res.status(400).json({ error: `The range may span at most ${MAX_DAYS} days.` });
        }

        const team = (req as any).team;

        // Team scoping comes only from the authorised :teamSlug (via req.team), never from the query.
        const rows = await TeamDailyStats.find({ team_id: team._id, date: { $gte: from, $lte: to } })
            .select('member_id date provider llm_model total_requests total_tokens total_cost_usd avg_latency_ms error_count blocked_count')
            .lean();

        const memberships = (await TeamMember.find({ team_id: team._id })) as any[];
        const signedIn = memberships.filter((m) => m.user_id);
        const users = signedIn.length
            ? ((await User.find({ _id: { $in: signedIn.map((m) => m.user_id) } }).select('email name').lean()) as any[])
            : [];
        const userById = new Map(users.map((u) => [String(u._id), u]));

        const members: MemberInfo[] = signedIn.map((m) => {
            const u = userById.get(String(m.user_id));
            return { memberId: String(m.user_id), membershipId: String(m._id), email: u?.email ?? m.invited_email, name: u?.name ?? null, role: m.role };
        });

        res.json({
            beta: true,
            team: { slug: team.slug, name: team.name },
            from: iso(from),
            to: iso(to),
            ...buildRollup(rows as unknown as StatRow[], members)
        });
    } catch (err) {
        console.error('[rollup] error:', err);
        res.status(500).json({ error: 'Internal server error.' });
    }
});

export default router;
