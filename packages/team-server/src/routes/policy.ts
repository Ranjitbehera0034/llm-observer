import { Router } from 'express';
import { z } from 'zod';
import TeamPolicy from '../models/TeamPolicy';
import { requireAuth, requireTeamRole } from '../middleware/requireAuth';
import { requireTeamApiKey } from '../lib/teamKeyAuth';
import { PolicyBodySchema, policyDto } from '../lib/policy';

const router = Router();

// GET /api/team/policy — a member's app (team API key + member email). Declared before the
// /:teamSlug routes; they have a different number of path segments so they cannot shadow it.
router.get('/policy', requireTeamApiKey, async (req, res) => {
    try {
        const team = (req as any).team;
        const policy = await TeamPolicy.findOne({ team_id: team._id }).lean();
        res.json(policyDto(policy as any));
    } catch (err) {
        console.error('[policy] member fetch error:', err);
        res.status(500).json({ error: 'Internal server error.' });
    }
});

// GET /api/team/:teamSlug/policy — admin view (adds who saved it)
router.get('/:teamSlug/policy', requireAuth, requireTeamRole('admin'), async (req, res) => {
    try {
        const team = (req as any).team;
        const policy: any = await TeamPolicy.findOne({ team_id: team._id }).lean();
        res.json(policyDto(policy, { updatedBy: policy?.updated_by ?? null } as any));
    } catch (err) {
        console.error('[policy] admin fetch error:', err);
        res.status(500).json({ error: 'Internal server error.' });
    }
});

// PUT /api/team/:teamSlug/policy — replaces the whole budget list and bumps the version
router.put('/:teamSlug/policy', requireAuth, requireTeamRole('admin'), async (req, res) => {
    try {
        const data = PolicyBodySchema.parse(req.body);
        const team = (req as any).team;

        const saved: any = await TeamPolicy.findOneAndUpdate(
            { team_id: team._id },
            {
                $set: { budgets: data.budgets, updated_by: req.userEmail, updated_at: new Date() },
                $inc: { version: 1 }
            },
            { upsert: true, new: true, setDefaultsOnInsert: true }
        );
        res.json(policyDto(saved, { updatedBy: saved.updated_by ?? null } as any));
    } catch (err) {
        if (err instanceof z.ZodError) {
            const issue = err.errors[0];
            return res.status(400).json({ error: `${issue?.path.join('.') || 'body'}: ${issue?.message || 'Invalid input.'}` });
        }
        console.error('[policy] save error:', err);
        res.status(500).json({ error: 'Internal server error.' });
    }
});

export default router;
