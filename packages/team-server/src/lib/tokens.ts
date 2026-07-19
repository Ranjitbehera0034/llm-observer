import jwt from 'jsonwebtoken';

const ACCESS_TOKEN_TTL = '15m';
const REFRESH_TOKEN_TTL = '30d';

function getSecret(): string {
    const secret = process.env.JWT_SECRET;
    if (secret) return secret;
    if (process.env.NODE_ENV === 'production') {
        throw new Error('JWT_SECRET must be set in production.');
    }
    console.warn('[auth] JWT_SECRET not set — using an insecure development default. Set JWT_SECRET before deploying.');
    return 'dev-insecure-secret-do-not-use-in-production';
}

export interface AccessTokenPayload {
    sub: string; // user id
    email: string;
}

export function signAccessToken(payload: AccessTokenPayload): string {
    return jwt.sign(payload, getSecret(), { expiresIn: ACCESS_TOKEN_TTL });
}

export function verifyAccessToken(token: string): AccessTokenPayload {
    return jwt.verify(token, getSecret()) as AccessTokenPayload;
}

export interface RefreshTokenPayload {
    sub: string; // user id
}

export function signRefreshToken(payload: RefreshTokenPayload): string {
    return jwt.sign(payload, getSecret(), { expiresIn: REFRESH_TOKEN_TTL });
}

export function verifyRefreshToken(token: string): RefreshTokenPayload {
    return jwt.verify(token, getSecret()) as RefreshTokenPayload;
}
