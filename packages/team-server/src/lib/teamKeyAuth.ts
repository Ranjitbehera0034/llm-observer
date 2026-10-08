import { Request, Response, NextFunction } from 'express';
import Team from '../models/Team';
import TeamMember from '../models/TeamMember';

export type MemberLookup =
    | { ok: true; team: any; membership: any }
    | { ok: false; status: 401 | 403; error: string };

/**
 * The machine-to-machine check shared by sync and policy fetch: the team API key identifies the
 * team; the invited email must belong to a member of that team who has signed in. The email is
 * *claimed* by the caller (anyone holding the team key can claim any teammate's email), so this
 * proves "someone with the team's key, naming a current member", not which person it was.
 */
export async function resolveTeamMember(teamApiKey: unknown, memberEmail: string): Promise<MemberLookup> {
    if (typeof teamApiKey !== 'string' || !teamApiKey) return { ok: false, status: 401, error: 'Invalid Team API Key' };
    const team = await Team.findOne({ team_api_key: teamApiKey });
    if (!team) return { ok: false, status: 401, error: 'Invalid Team API Key' };

    const membership = await TeamMember.findOne({ team_id: team._id, invited_email: memberEmail.toLowerCase() });
    if (!membership) return { ok: false, status: 403, error: `${memberEmail} is not a member of this team.` };
    if (!membership.user_id) {
        // Invited but has never actually signed in (local or SSO): no identity yet.
        return { ok: false, status: 403, error: `${memberEmail} has been invited but has not yet signed in.` };
    }
    return { ok: true, team, membership };
}

/** Reads `Authorization: Bearer <team key>`. Never the query string (it would end up in access logs). */
export function bearerKey(req: Request): string | null {
    const m = /^Bearer\s+(\S+)$/i.exec(req.headers.authorization || '');
    return m ? m[1] : null;
}

/**
 * For GET /api/team/policy: same credentials as POST /api/team/sync, carried in headers because a
 * GET has no body — `Authorization: Bearer <team api key>` and `X-Team-Member-Email`.
 * Attaches req.team.
 */
export async function requireTeamApiKey(req: Request, res: Response, next: NextFunction) {
    try {
        const key = bearerKey(req);
        if (!key) return res.status(401).json({ error: 'Missing or invalid Team API Key (send Authorization: Bearer <key>).' });

        const email = req.headers['x-team-member-email'];
        if (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            // Check the key first so an unknown key is always a 401, whatever else is wrong.
            const known = await Team.findOne({ team_api_key: key });
            if (!known) return res.status(401).json({ error: 'Invalid Team API Key' });
            return res.status(400).json({ error: 'X-Team-Member-Email must be a valid email.' });
        }

        const found = await resolveTeamMember(key, email);
        if (!found.ok) return res.status(found.status).json({ error: found.error });
        (req as any).team = found.team;
        next();
    } catch (err) {
        console.error('[team] api-key auth error:', err);
        res.status(500).json({ error: 'Internal server error.' });
    }
}
