import { Request, Response, NextFunction } from 'express';
import { verifyAccessToken } from '../lib/tokens';
import TeamMember from '../models/TeamMember';
import Team from '../models/Team';

declare global {
    // eslint-disable-next-line @typescript-eslint/no-namespace
    namespace Express {
        interface Request {
            userId?: string;
            userEmail?: string;
        }
    }
}

const ACCESS_TOKEN_COOKIE = 'llmo_access_token';

/** Verifies the JWT access-token cookie and attaches the caller's identity to the request. */
export function requireAuth(req: Request, res: Response, next: NextFunction) {
    const token = req.cookies?.[ACCESS_TOKEN_COOKIE];
    if (!token) {
        return res.status(401).json({ error: 'Not authenticated.' });
    }
    try {
        const payload = verifyAccessToken(token);
        req.userId = payload.sub;
        req.userEmail = payload.email;
        next();
    } catch {
        return res.status(401).json({ error: 'Invalid or expired session.' });
    }
}

/**
 * Requires requireAuth to have already run. Loads the caller's TeamMember row
 * for the :teamSlug param and enforces a minimum role. Attaches req.teamMember.
 */
export function requireTeamRole(minRole: 'member' | 'admin' | 'owner') {
    const RANK: Record<string, number> = { member: 0, admin: 1, owner: 2 };

    return async (req: Request, res: Response, next: NextFunction) => {
        const slug = req.params.teamSlug;
        if (!slug) return res.status(400).json({ error: 'Missing team slug.' });

        const team = await Team.findOne({ slug });
        if (!team) return res.status(404).json({ error: 'Team not found.' });

        const member = await TeamMember.findOne({ team_id: team._id, user_id: req.userId });
        if (!member) return res.status(403).json({ error: 'Not a member of this team.' });

        if (RANK[member.role] < RANK[minRole]) {
            return res.status(403).json({ error: `Requires ${minRole} role or higher.` });
        }

        (req as any).team = team;
        (req as any).teamMember = member;
        next();
    };
}

export const ACCESS_TOKEN_COOKIE_NAME = ACCESS_TOKEN_COOKIE;
export const REFRESH_TOKEN_COOKIE_NAME = 'llmo_refresh_token';
