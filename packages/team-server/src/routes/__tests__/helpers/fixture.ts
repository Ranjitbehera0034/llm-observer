import express from 'express';
import { signAccessToken } from '../../../lib/tokens';
import { resetDb, seedTeam, seedUser, seedMember } from './fakeDb';

process.env.JWT_SECRET = 'test-secret-for-team-policy-tests';

/** Two teams: "acme" (owner, admin, two members, one pending invite) and "globex" (admin, member). */
export function seedFixture() {
    resetDb();
    const acme = seedTeam({ _id: 'team_acme', slug: 'acme', name: 'Acme', team_api_key: 'key_acme_0001' });
    const globex = seedTeam({ _id: 'team_globex', slug: 'globex', name: 'Globex', team_api_key: 'key_globex_0001' });

    const users = {
        owner: seedUser({ _id: 'u_owner', email: 'owner@acme.test', name: 'Olive Owner' }),
        admin: seedUser({ _id: 'u_admin', email: 'admin@acme.test', name: 'Adam Admin' }),
        member: seedUser({ _id: 'u_member', email: 'dev1@acme.test', name: 'Dev One' }),
        member2: seedUser({ _id: 'u_member2', email: 'dev2@acme.test', name: 'Dev Two' }),
        adminB: seedUser({ _id: 'u_adminB', email: 'admin@globex.test', name: 'Gina Globex' }),
        memberB: seedUser({ _id: 'u_memberB', email: 'dev@globex.test', name: 'Gus Globex' }),
    };
    const link = (team: any, user: any, role: string) =>
        seedMember({ _id: `m_${user._id}`, team_id: team._id, user_id: user._id, role, invited_email: user.email });
    const members = {
        owner: link(acme, users.owner, 'owner'),
        admin: link(acme, users.admin, 'admin'),
        member: link(acme, users.member, 'member'),
        member2: link(acme, users.member2, 'member'),
        pending: seedMember({ _id: 'm_pending', team_id: acme._id, role: 'member', invited_email: 'pending@acme.test' }),
        adminB: link(globex, users.adminB, 'admin'),
        memberB: link(globex, users.memberB, 'member'),
    };
    return { acme, globex, users, members };
}

export const cookieFor = (user: Record<string, any>) =>
    `llmo_access_token=${signAccessToken({ sub: user._id, email: user.email })}`;

/** The real app (helmet, cookies, JSON, all routers) — models are mocked by each test file. */
export function buildApp() {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require('../../../app').createApp() as express.Express;
}

export const goodBudgets = [
    { scope: 'daily', limitUsd: 25, action: 'alert' },
    { scope: 'monthly', limitUsd: 400, provider: 'anthropic', action: 'block' },
];
