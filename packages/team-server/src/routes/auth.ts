import { Router } from 'express';
import { z } from 'zod';
import User from '../models/User';
import { hashPassword, verifyPassword } from '../lib/passwords';
import { signAccessToken, signRefreshToken } from '../lib/tokens';
import { requireAuth, ACCESS_TOKEN_COOKIE_NAME, REFRESH_TOKEN_COOKIE_NAME } from '../middleware/requireAuth';

const router = Router();

const isProd = process.env.NODE_ENV === 'production';
const cookieOptions = {
    httpOnly: true,
    secure: isProd,
    sameSite: 'lax' as const,
    path: '/'
};

function setAuthCookies(res: any, userId: string, email: string) {
    res.cookie(ACCESS_TOKEN_COOKIE_NAME, signAccessToken({ sub: userId, email }), {
        ...cookieOptions, maxAge: 15 * 60 * 1000
    });
    res.cookie(REFRESH_TOKEN_COOKIE_NAME, signRefreshToken({ sub: userId }), {
        ...cookieOptions, maxAge: 30 * 24 * 60 * 60 * 1000
    });
}

const SignupSchema = z.object({
    email: z.string().email(),
    password: z.string().min(10, 'Password must be at least 10 characters.'),
    name: z.string().min(1)
});

// POST /api/auth/signup
router.post('/signup', async (req, res) => {
    try {
        const data = SignupSchema.parse(req.body);
        const existing = await User.findOne({ email: data.email });
        if (existing) {
            return res.status(409).json({ error: 'An account with this email already exists.' });
        }

        const password_hash = await hashPassword(data.password);
        const user = await User.create({
            email: data.email,
            name: data.name,
            password_hash,
            auth_provider: 'local'
        });

        setAuthCookies(res, user.id, user.email);
        res.status(201).json({ user: { id: user.id, email: user.email, name: user.name } });
    } catch (err) {
        if (err instanceof z.ZodError) {
            return res.status(400).json({ error: err.errors[0]?.message || 'Invalid input.' });
        }
        console.error('[auth] signup error:', err);
        res.status(500).json({ error: 'Internal server error.' });
    }
});

const LoginSchema = z.object({
    email: z.string().email(),
    password: z.string()
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
    try {
        const data = LoginSchema.parse(req.body);
        // password_hash has `select: false` on the schema — must opt back in
        const user = await User.findOne({ email: data.email }).select('+password_hash');

        // Constant error message for "no such user" and "wrong password" —
        // don't leak which one it was.
        const genericError = { error: 'Invalid email or password.' };

        if (!user || user.auth_provider !== 'local' || !user.password_hash) {
            return res.status(401).json(genericError);
        }
        const valid = await verifyPassword(data.password, user.password_hash);
        if (!valid) {
            return res.status(401).json(genericError);
        }

        setAuthCookies(res, user.id, user.email);
        res.json({ user: { id: user.id, email: user.email, name: user.name } });
    } catch (err) {
        if (err instanceof z.ZodError) {
            return res.status(400).json({ error: err.errors[0]?.message || 'Invalid input.' });
        }
        console.error('[auth] login error:', err);
        res.status(500).json({ error: 'Internal server error.' });
    }
});

// POST /api/auth/logout
router.post('/logout', (req, res) => {
    res.clearCookie(ACCESS_TOKEN_COOKIE_NAME, { path: '/' });
    res.clearCookie(REFRESH_TOKEN_COOKIE_NAME, { path: '/' });
    res.json({ success: true });
});

// GET /api/auth/me
router.get('/me', requireAuth, async (req, res) => {
    const user = await User.findById(req.userId);
    if (!user) return res.status(404).json({ error: 'User not found.' });
    res.json({ user: { id: user.id, email: user.email, name: user.name, auth_provider: user.auth_provider } });
});

export default router;
