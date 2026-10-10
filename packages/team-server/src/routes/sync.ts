import { Router } from 'express';
import { resolveTeamMember } from '../lib/teamKeyAuth';
import TeamDailyStats from '../models/TeamDailyStats';
import { z } from 'zod';

const router = Router();

// Validation schema for aggregated stats
const SyncSchema = z.object({
    team_api_key: z.string(),
    member_email: z.string().email(),
    stats: z.array(z.object({
        date: z.string(),
        provider: z.string(),
        model: z.string(),
        project_name: z.string(),
        total_requests: z.number(),
        total_tokens: z.number(),
        total_cost_usd: z.number(),
        avg_latency_ms: z.number(),
        error_count: z.number(),
        blocked_count: z.number(),
    }))
});

router.post('/sync', async (req, res) => {
    try {
        const data = SyncSchema.parse(req.body);

        // 1+2. The API key authenticates the *team* (any machine on the team can hold it); the
        // invited-email lookup authenticates which *member's* stats these are, so one member's
        // install can't attribute usage to a non-member. (The email is still only claimed: see
        // resolveTeamMember.) Shared with GET /api/team/policy.
        const found = await resolveTeamMember(data.team_api_key, data.member_email);
        if (!found.ok) {
            return res.status(found.status).json({ error: found.error });
        }
        const { team } = found;
        const member_id = found.membership.user_id;

        // 3. Upsert Stats
        const operations = data.stats.map(stat => ({
            updateOne: {
                filter: {
                    team_id: team._id,
                    member_id: member_id,
                    date: new Date(stat.date),
                    provider: stat.provider,
                    // TeamDailyStats' schema field is `llm_model`, not `model` —
                    // writing `model` here threw a Mongoose StrictModeError on
                    // every upsert against a real database (only surfaced when
                    // this route was exercised against real MongoDB; the
                    // mocked bulkWrite in tests couldn't catch a schema-field
                    // mismatch since it never validates against a real schema).
                    llm_model: stat.model,
                    project_name: stat.project_name
                },
                update: {
                    $set: {
                        total_requests: stat.total_requests,
                        total_tokens: stat.total_tokens,
                        total_cost_usd: stat.total_cost_usd,
                        avg_latency_ms: stat.avg_latency_ms,
                        error_count: stat.error_count,
                        blocked_count: stat.blocked_count
                    }
                },
                upsert: true
            }
        }));

        if (operations.length > 0) {
            await TeamDailyStats.bulkWrite(operations);
        }

        res.json({ success: true, synced_count: operations.length });
    } catch (error) {
        if (error instanceof z.ZodError) {
            return res.status(400).json({ error: error.errors });
        }
        console.error('Sync error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

export default router;
