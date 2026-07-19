import { Router } from 'express';
import User from '../models/User';
import Team from '../models/Team';
import TeamMember from '../models/TeamMember';
import { signAccessToken, signRefreshToken } from '../lib/tokens';
import { ACCESS_TOKEN_COOKIE_NAME, REFRESH_TOKEN_COOKIE_NAME } from '../middleware/requireAuth';

const router = Router();

const isProd = process.env.NODE_ENV === 'production';
const cookieOptions = { httpOnly: true, secure: isProd, sameSite: 'lax' as const, path: '/' };

// openid-client v6 ships ESM-only (no CommonJS build). This package compiles
// to CommonJS like the rest of the monorepo, so we load it via a dynamic
// import() — Node's documented interop path for consuming an ESM-only
// package from CJS. Memoized so discovery only runs once per process.
type OidcClientModule = typeof import('openid-client');
let oidcClientModulePromise: Promise<OidcClientModule> | null = null;
function getOidcClientModule(): Promise<OidcClientModule> {
    if (!oidcClientModulePromise) {
        oidcClientModulePromise = import('openid-client');
    }
    return oidcClientModulePromise;
}

// In-memory PKCE/state store keyed by a short-lived nonce we hand back to the
// browser as a cookie. A single-process store is fine here — if team-server
// is ever scaled horizontally, swap this for a shared store (e.g. Redis).
interface PendingOidcFlow {
    codeVerifier: string;
    state: string;
    teamSlug: string;
    expiresAt: number;
}
const pendingFlows = new Map<string, PendingOidcFlow>();
const FLOW_COOKIE = 'llmo_oidc_flow';
const FLOW_TTL_MS = 10 * 60 * 1000;

function cleanupExpiredFlows() {
    const now = Date.now();
    for (const [key, flow] of pendingFlows) {
        if (flow.expiresAt < now) pendingFlows.delete(key);
    }
}

async function discoverForTeam(team: any) {
    if (!team.sso_config?.enabled) {
        throw Object.assign(new Error('SSO is not enabled for this team.'), { status: 400 });
    }
    const client = await getOidcClientModule();
    const fullTeam = await Team.findById(team._id).select('+sso_config.client_secret');
    const { issuer, client_id, client_secret } = fullTeam!.sso_config as any;
    return client.discovery(new URL(issuer), client_id, client_secret);
}

// GET /api/auth/oidc/:teamSlug/start
router.get('/:teamSlug/start', async (req, res) => {
    try {
        cleanupExpiredFlows();
        const team = await Team.findOne({ slug: req.params.teamSlug });
        if (!team) return res.status(404).json({ error: 'Team not found.' });

        const client = await getOidcClientModule();
        const config = await discoverForTeam(team);

        const codeVerifier = client.randomPKCECodeVerifier();
        const codeChallenge = await client.calculatePKCECodeChallenge(codeVerifier);
        const state = client.randomState();

        const redirectUri = `${process.env.TEAM_SERVER_PUBLIC_URL || 'http://localhost:4002'}/api/auth/oidc/${req.params.teamSlug}/callback`;

        const authorizationUrl = client.buildAuthorizationUrl(config, {
            redirect_uri: redirectUri,
            scope: 'openid email profile',
            code_challenge: codeChallenge,
            code_challenge_method: 'S256',
            state
        });

        const flowId = state; // reuse the OAuth state value as our lookup key
        pendingFlows.set(flowId, { codeVerifier, state, teamSlug: req.params.teamSlug, expiresAt: Date.now() + FLOW_TTL_MS });
        res.cookie(FLOW_COOKIE, flowId, { ...cookieOptions, maxAge: FLOW_TTL_MS });

        res.redirect(authorizationUrl.href);
    } catch (err: any) {
        console.error('[oidc] start error:', err);
        res.status(err.status || 500).json({ error: err.message || 'Could not start SSO login.' });
    }
});

// GET /api/auth/oidc/:teamSlug/callback
router.get('/:teamSlug/callback', async (req, res) => {
    try {
        const flowId = req.cookies?.[FLOW_COOKIE];
        const flow = flowId ? pendingFlows.get(flowId) : undefined;
        if (!flow || flow.teamSlug !== req.params.teamSlug) {
            return res.status(400).json({ error: 'SSO login session expired or invalid. Please try again.' });
        }
        pendingFlows.delete(flowId);
        res.clearCookie(FLOW_COOKIE, { path: '/' });

        const team = await Team.findOne({ slug: req.params.teamSlug });
        if (!team) return res.status(404).json({ error: 'Team not found.' });

        const client = await getOidcClientModule();
        const config = await discoverForTeam(team);

        const currentUrl = new URL(req.originalUrl, process.env.TEAM_SERVER_PUBLIC_URL || 'http://localhost:4002');
        const tokens = await client.authorizationCodeGrant(config, currentUrl, {
            pkceCodeVerifier: flow.codeVerifier,
            expectedState: flow.state
        });

        const claims = tokens.claims();
        if (!claims || typeof claims.sub !== 'string') {
            return res.status(502).json({ error: 'Identity provider did not return a valid subject claim.' });
        }
        const email = (claims.email as string) || '';
        if (!email) {
            return res.status(502).json({ error: 'Identity provider did not return an email claim.' });
        }

        // Only people the team owner/admin has actually invited may join via SSO.
        const membership = await TeamMember.findOne({ team_id: team._id, invited_email: email.toLowerCase() });
        if (!membership) {
            return res.status(403).json({ error: `${email} has not been invited to this team.` });
        }

        let user = await User.findOne({ email: email.toLowerCase() });
        if (!user) {
            user = await User.create({
                email: email.toLowerCase(),
                name: (claims.name as string) || email,
                auth_provider: 'oidc',
                external_id: claims.sub
            });
        } else if (!user.external_id) {
            user.external_id = claims.sub;
            user.auth_provider = 'oidc';
            await user.save();
        }

        if (!membership.user_id) {
            membership.user_id = user.id;
            membership.joined_at = new Date();
            await membership.save();
        }

        res.cookie(ACCESS_TOKEN_COOKIE_NAME, signAccessToken({ sub: user.id, email: user.email }), { ...cookieOptions, maxAge: 15 * 60 * 1000 });
        res.cookie(REFRESH_TOKEN_COOKIE_NAME, signRefreshToken({ sub: user.id }), { ...cookieOptions, maxAge: 30 * 24 * 60 * 60 * 1000 });

        const appUrl = process.env.TEAM_DASHBOARD_URL || '/';
        res.redirect(appUrl);
    } catch (err: any) {
        console.error('[oidc] callback error:', err);
        res.status(err.status || 500).json({ error: err.message || 'SSO login failed.' });
    }
});

export default router;
