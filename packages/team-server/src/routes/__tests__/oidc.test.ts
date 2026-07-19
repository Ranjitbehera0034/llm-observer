process.env.JWT_SECRET = 'test-secret-for-oidc-test';
process.env.TEAM_SERVER_PUBLIC_URL = 'http://localhost:4002';

// --- Fake IdP wiring -------------------------------------------------------
// openid-client v6 is ESM-only; oidc.ts loads it via a dynamic import(),
// which Jest resolves through the same module registry as require() — so
// mocking the module specifier here intercepts it regardless of call style.
const FAKE_STATE = 'fixed-state-for-test';
const FAKE_VERIFIER = 'fixed-verifier-for-test';
let idpClaims: any = { sub: 'idp-subject-1', email: 'invited@example.com', name: 'Invited Person' };

jest.mock('openid-client', () => ({
    discovery: jest.fn(async () => ({ __fakeConfig: true })),
    randomPKCECodeVerifier: jest.fn(() => FAKE_VERIFIER),
    calculatePKCECodeChallenge: jest.fn(async () => 'fixed-challenge'),
    randomState: jest.fn(() => FAKE_STATE),
    buildAuthorizationUrl: jest.fn((_config: any, params: any) => {
        const url = new URL('https://fake-idp.example.com/authorize');
        Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, String(v)));
        return url;
    }),
    authorizationCodeGrant: jest.fn(async () => ({
        claims: () => idpClaims
    }))
}));

// --- Mongoose model mocks ----------------------------------------------------
const TEAM_ID = 'team_1';
let teamRow: any;
let userStore: any[] = [];
let memberStore: any[] = [];
let userIdCounter = 0;

jest.mock('../../models/Team', () => ({
    __esModule: true,
    default: {
        findOne: jest.fn(async ({ slug }: any) => (teamRow && teamRow.slug === slug ? teamRow : null)),
        findById: jest.fn((id: any) => ({
            select: jest.fn(async () => (teamRow && teamRow._id === id ? teamRow : null))
        }))
    }
}));

jest.mock('../../models/User', () => ({
    __esModule: true,
    default: {
        findOne: jest.fn(async ({ email }: any) => userStore.find((u) => u.email === email) || null),
        create: jest.fn(async (doc: any) => {
            const user = { ...doc, id: `user_${++userIdCounter}`, save: jest.fn(async function (this: any) { return this; }) };
            userStore.push(user);
            return user;
        })
    }
}));

jest.mock('../../models/TeamMember', () => ({
    __esModule: true,
    default: {
        findOne: jest.fn(async ({ team_id, invited_email }: any) =>
            memberStore.find((m) => m.team_id === team_id && m.invited_email === invited_email) || null
        )
    }
}));

import request from 'supertest';
import express from 'express';
import cookieParser from 'cookie-parser';
import oidcRouter from '../oidc';

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use('/api/auth/oidc', oidcRouter);

describe('GET /api/auth/oidc/:teamSlug/start', () => {
    beforeEach(() => {
        teamRow = { _id: TEAM_ID, slug: 'acme', sso_config: { enabled: true, issuer: 'https://fake-idp.example.com', client_id: 'cid', client_secret: 'secret' } };
    });

    it('404s for an unknown team', async () => {
        const res = await request(app).get('/api/auth/oidc/nonexistent/start');
        expect(res.status).toBe(404);
    });

    it('400s when SSO is not enabled for the team', async () => {
        teamRow.sso_config.enabled = false;
        const res = await request(app).get('/api/auth/oidc/acme/start');
        expect(res.status).toBe(400);
    });

    it('redirects to the IdP authorization URL with PKCE params and sets the flow cookie', async () => {
        const res = await request(app).get('/api/auth/oidc/acme/start');
        expect(res.status).toBe(302);
        const location = new URL(res.headers.location);
        expect(location.searchParams.get('state')).toBe(FAKE_STATE);
        expect(location.searchParams.get('code_challenge')).toBe('fixed-challenge');
        expect(location.searchParams.get('code_challenge_method')).toBe('S256');
        const cookies = res.headers['set-cookie'] as unknown as string[];
        expect(cookies.some((c) => c.startsWith('llmo_oidc_flow='))).toBe(true);
    });
});

describe('GET /api/auth/oidc/:teamSlug/callback', () => {
    beforeEach(() => {
        teamRow = { _id: TEAM_ID, slug: 'acme', sso_config: { enabled: true, issuer: 'https://fake-idp.example.com', client_id: 'cid', client_secret: 'secret' } };
        userStore = [];
        memberStore = [];
        userIdCounter = 0;
        idpClaims = { sub: 'idp-subject-1', email: 'invited@example.com', name: 'Invited Person' };
    });

    const startFlow = async () => {
        const agent = request.agent(app);
        await agent.get('/api/auth/oidc/acme/start');
        return agent;
    };

    it('rejects a callback with no valid flow cookie (replay/CSRF protection)', async () => {
        const res = await request(app).get('/api/auth/oidc/acme/callback?code=abc&state=' + FAKE_STATE);
        expect(res.status).toBe(400);
    });

    it('rejects sign-in for an email that was never invited to the team', async () => {
        const agent = await startFlow();
        const res = await agent.get('/api/auth/oidc/acme/callback?code=abc&state=' + FAKE_STATE);
        expect(res.status).toBe(403);
        expect(res.body.error).toContain('not been invited');
    });

    it('completes SSO login for an invited member: creates the User, marks membership joined, sets the session cookie', async () => {
        memberStore.push({ team_id: TEAM_ID, invited_email: 'invited@example.com', user_id: undefined, save: jest.fn(async function (this: any) { return this; }) });
        const agent = await startFlow();
        const res = await agent.get('/api/auth/oidc/acme/callback?code=abc&state=' + FAKE_STATE);

        expect(res.status).toBe(302); // redirected into the app post-login
        expect(userStore).toHaveLength(1);
        expect(userStore[0].email).toBe('invited@example.com');
        expect(userStore[0].auth_provider).toBe('oidc');
        expect(memberStore[0].user_id).toBe(userStore[0].id);
        expect(memberStore[0].joined_at).toBeInstanceOf(Date);

        const cookies = res.headers['set-cookie'] as unknown as string[];
        expect(cookies.some((c) => c.startsWith('llmo_access_token='))).toBe(true);
    });

    it('reuses the existing User record on a second SSO login instead of creating a duplicate', async () => {
        memberStore.push({ team_id: TEAM_ID, invited_email: 'invited@example.com', user_id: undefined, save: jest.fn(async function (this: any) { return this; }) });

        const firstAgent = await startFlow();
        await firstAgent.get('/api/auth/oidc/acme/callback?code=abc&state=' + FAKE_STATE);
        expect(userStore).toHaveLength(1);

        const secondAgent = await startFlow();
        await secondAgent.get('/api/auth/oidc/acme/callback?code=abc&state=' + FAKE_STATE);
        expect(userStore).toHaveLength(1); // still just one user, not duplicated
    });

    it('rejects a callback whose flow cookie is scoped to a different team', async () => {
        // Start a flow for "acme", then hit the callback for a different team slug
        const agent = await startFlow();
        teamRow = { ...teamRow, slug: 'other-team' };
        const res = await agent.get('/api/auth/oidc/other-team/callback?code=abc&state=' + FAKE_STATE);
        expect(res.status).toBe(400);
    });
});
