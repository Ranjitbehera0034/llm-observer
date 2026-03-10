import { Router } from 'express';
import Team from '../models/Team';
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

        // 1. Verify Team
        const team = await Team.findOne({ team_api_key: data.team_api_key });
        if (!team) {
            return res.status(401).json({ error: 'Invalid Team API Key' });
        }

        // 2. Identify/Verify Member (Simplification for MVP: trust email if key is valid)
        // In a real app, you'd check if user is in team_members
        const member_id = team.owner_id; // For now, associate everything with the owner or find user by email

        // 3. Upsert Stats
        const operations = data.stats.map(stat => ({
            updateOne: {
                filter: {
                    team_id: team._id,
                    member_id: member_id, // Should be actual member_id
                    date: new Date(stat.date),
                    provider: stat.provider,
                    model: stat.model,
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
