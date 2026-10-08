import { Router } from 'express';
import crypto from 'crypto';
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

// DELETE /api/team/:teamSlug/members/:membershipId — membershipId is the `id` from the members list.
// Admins remove members and pending invites; only the owner removes an admin; nobody removes the owner.
// Their past daily stats stay in the rollup (shown as a former member); they can no longer sync or fetch policy.
router.delete('/:teamSlug/members/:membershipId', requireAuth, requireTeamRole('admin'), async (req, res) => {
    try {
        const team = (req as any).team;
        const caller = (req as any).teamMember;

        // Scoped to this team, so a membership id from another team is simply "not found".
        const target = await TeamMember.findOne({ _id: req.params.membershipId, team_id: team._id });
        if (!target) return res.status(404).json({ error: 'Member not found.' });

        if (target.role === 'owner') return res.status(403).json({ error: 'The team owner cannot be removed.' });
        if (target.role === 'admin' && caller.role !== 'owner') {
            return res.status(403).json({ error: 'Only the team owner can remove an admin.' });
        }

        await TeamMember.deleteOne({ _id: target._id });
        res.json({ success: true });
    } catch (err: any) {
        if (err?.name === 'CastError') return res.status(404).json({ error: 'Member not found.' });
        console.error('[team] remove member error:', err);
        res.status(500).json({ error: 'Internal server error.' });
    }
});

// POST /api/team/:teamSlug/api-key/rotate — owner only. The old key stops working immediately for
// both sync and policy fetch; every member's app needs the new one. The new key is shown once, here.
router.post('/:teamSlug/api-key/rotate', requireAuth, requireTeamRole('owner'), async (req, res) => {
    try {
        const team = (req as any).team;
        team.team_api_key = `llmo_team_${crypto.randomBytes(24).toString('hex')}`;
        await team.save();
        res.json({ apiKey: team.team_api_key });
    } catch (err) {
        console.error('[team] rotate key error:', err);
        res.status(500).json({ error: 'Internal server error.' });
    }
});

export default router;
