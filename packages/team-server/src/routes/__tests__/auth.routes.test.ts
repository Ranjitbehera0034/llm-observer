process.env.JWT_SECRET = 'test-secret-for-auth-routes-test';

const mockUserStore: any[] = [];
let idCounter = 0;

jest.mock('../../models/User', () => {
    const create = jest.fn(async (doc: any) => {
        const user = { ...doc, id: `user_${++idCounter}`, save: jest.fn(async function (this: any) { return this; }) };
        mockUserStore.push(user);
        return user;
    });
    const findOneImpl = (query: any) => mockUserStore.find((u) => u.email === query.email) || null;
    const findOne = jest.fn((query: any) => ({
        // .select('+password_hash') is a no-op here since our mock objects
        // always carry every field — this only needs to be chainable.
        select: jest.fn(async () => findOneImpl(query)),
        then: (resolve: any) => resolve(findOneImpl(query))
    }));
    const findById = jest.fn(async (id: string) => mockUserStore.find((u) => u.id === id) || null);
    return { __esModule: true, default: { create, findOne, findById } };
});

import request from 'supertest';
import express from 'express';
import cookieParser from 'cookie-parser';
import authRouter from '../auth';

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use('/api/auth', authRouter);

describe('POST /api/auth/signup', () => {
    beforeEach(() => { mockUserStore.length = 0; idCounter = 0; });

    it('creates an account and sets auth cookies', async () => {
        const res = await request(app)
            .post('/api/auth/signup')
            .send({ email: 'new@example.com', password: 'a-long-enough-password', name: 'New User' });

        expect(res.status).toBe(201);
        expect(res.body.user.email).toBe('new@example.com');
        expect(res.headers['set-cookie']).toBeDefined();
        const cookies = res.headers['set-cookie'] as unknown as string[];
        expect(cookies.some((c) => c.startsWith('llmo_access_token='))).toBe(true);
        expect(cookies.some((c) => c.includes('HttpOnly'))).toBe(true);
    });

    it('rejects a password shorter than 10 characters', async () => {
        const res = await request(app).post('/api/auth/signup').send({ email: 'a@b.com', password: 'short', name: 'A' });
        expect(res.status).toBe(400);
    });

    it('rejects a duplicate email', async () => {
        await request(app).post('/api/auth/signup').send({ email: 'dup@example.com', password: 'a-long-enough-password', name: 'A' });
        const res = await request(app).post('/api/auth/signup').send({ email: 'dup@example.com', password: 'another-long-password', name: 'B' });
        expect(res.status).toBe(409);
    });

    it('never returns the password hash in the response body', async () => {
        const res = await request(app).post('/api/auth/signup').send({ email: 'safe@example.com', password: 'a-long-enough-password', name: 'A' });
        expect(JSON.stringify(res.body)).not.toContain('password');
    });
});

describe('POST /api/auth/login', () => {
    beforeEach(() => { mockUserStore.length = 0; idCounter = 0; });

    it('logs in with the correct password', async () => {
        await request(app).post('/api/auth/signup').send({ email: 'login@example.com', password: 'a-long-enough-password', name: 'A' });
        const res = await request(app).post('/api/auth/login').send({ email: 'login@example.com', password: 'a-long-enough-password' });
        expect(res.status).toBe(200);
        expect(res.headers['set-cookie']).toBeDefined();
    });

    it('rejects a wrong password with a generic error (no user-enumeration signal)', async () => {
        await request(app).post('/api/auth/signup').send({ email: 'login2@example.com', password: 'a-long-enough-password', name: 'A' });
        const wrongPw = await request(app).post('/api/auth/login').send({ email: 'login2@example.com', password: 'totally-wrong' });
        const noSuchUser = await request(app).post('/api/auth/login').send({ email: 'nobody@example.com', password: 'whatever12345' });
        expect(wrongPw.status).toBe(401);
        expect(noSuchUser.status).toBe(401);
        expect(wrongPw.body.error).toBe(noSuchUser.body.error); // identical message either way
    });

    it('rejects login for an OIDC-only account (no password set)', async () => {
        mockUserStore.push({ id: 'user_oidc', email: 'sso@example.com', name: 'SSO User', auth_provider: 'oidc' });
        const res = await request(app).post('/api/auth/login').send({ email: 'sso@example.com', password: 'anything12345' });
        expect(res.status).toBe(401);
    });
});

describe('GET /api/auth/me', () => {
    beforeEach(() => { mockUserStore.length = 0; idCounter = 0; });

    it('requires a valid session cookie', async () => {
        const res = await request(app).get('/api/auth/me');
        expect(res.status).toBe(401);
    });

    it('returns the current user for a valid session', async () => {
        const agent = request.agent(app);
        await agent.post('/api/auth/signup').send({ email: 'me@example.com', password: 'a-long-enough-password', name: 'Me' });
        const res = await agent.get('/api/auth/me');
        expect(res.status).toBe(200);
        expect(res.body.user.email).toBe('me@example.com');
    });
});

describe('POST /api/auth/logout', () => {
    it('clears the auth cookies', async () => {
        const res = await request(app).post('/api/auth/logout');
        expect(res.status).toBe(200);
        const cookies = (res.headers['set-cookie'] as unknown as string[]) || [];
        expect(cookies.some((c) => c.startsWith('llmo_access_token=;'))).toBe(true);
    });
});
