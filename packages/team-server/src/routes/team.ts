import { Router } from 'express';
import { z } from 'zod';
import Team from '../models/Team';
import TeamMember from '../models/TeamMember';
import { requireAuth, requireTeamRole } from '../middleware/requireAuth';

const router = Router();

// GET /api/team/:teamSlug/members
router.get('/:teamSlug/members', requireAuth, requireTeamRole('member'), async (req, res) => {
    const team = (req as any).team;
    const members = await TeamMember.find({ team_id: team._id }).populate('user_id', 'email name');
    res.json({
        members: members.map((m) => ({
            id: m.id,
            role: m.role,
            invited_email: m.invited_email,
            joined_at: m.joined_at || null,
            user: m.user_id ? { id: (m.user_id as any).id, email: (m.user_id as any).email, name: (m.user_id as any).name } : null
        }))
    });
});

const InviteSchema = z.object({
    email: z.string().email(),
    role: z.enum(['admin', 'member']).default('member')
});

// POST /api/team/:teamSlug/invite
router.post('/:teamSlug/invite', requireAuth, requireTeamRole('admin'), async (req, res) => {
    try {
        const data = InviteSchema.parse(req.body);
        const team = (req as any).team;

        const memberCount = await TeamMember.countDocuments({ team_id: team._id });
        if (memberCount >= team.max_seats) {
            return res.status(409).json({ error: `Team is at its seat limit (${team.max_seats}).` });
        }

        const existing = await TeamMember.findOne({ team_id: team._id, invited_email: data.email.toLowerCase() });
        if (existing) {
            return res.status(409).json({ error: 'This email has already been invited.' });
        }

        const member = await TeamMember.create({
            team_id: team._id,
            invited_email: data.email.toLowerCase(),
            role: data.role
        });

        res.status(201).json({ member: { id: member.id, invited_email: member.invited_email, role: member.role } });
    } catch (err) {
        if (err instanceof z.ZodError) {
            return res.status(400).json({ error: err.errors[0]?.message || 'Invalid input.' });
        }
        console.error('[team] invite error:', err);
        res.status(500).json({ error: 'Internal server error.' });
    }
});

const SsoConfigSchema = z.object({
    enabled: z.boolean(),
    issuer: z.string().url(),
    client_id: z.string().min(1),
    client_secret: z.string().min(1),
    enforced: z.boolean().default(false)
});

// PUT /api/team/:teamSlug/sso-config — owner only, this changes how the whole team authenticates
router.put('/:teamSlug/sso-config', requireAuth, requireTeamRole('owner'), async (req, res) => {
    try {
        const data = SsoConfigSchema.parse(req.body);
        const team = (req as any).team;

        team.sso_config = { ...data, provider: 'oidc' };
        await team.save();

        res.json({ sso_config: { enabled: data.enabled, issuer: data.issuer, client_id: data.client_id, enforced: data.enforced } });
    } catch (err) {
        if (err instanceof z.ZodError) {
            return res.status(400).json({ error: err.errors[0]?.message || 'Invalid input.' });
        }
        console.error('[team] sso-config error:', err);
        res.status(500).json({ error: 'Internal server error.' });
    }
});

export default router;
