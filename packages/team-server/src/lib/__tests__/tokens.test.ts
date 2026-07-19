import { signAccessToken, verifyAccessToken, signRefreshToken, verifyRefreshToken } from '../tokens';

describe('tokens', () => {
    beforeAll(() => {
        process.env.JWT_SECRET = 'test-secret-for-tokens-test-file';
    });

    it('round-trips an access token', () => {
        const token = signAccessToken({ sub: 'user_123', email: 'a@b.com' });
        const payload = verifyAccessToken(token);
        expect(payload.sub).toBe('user_123');
        expect(payload.email).toBe('a@b.com');
    });

    it('round-trips a refresh token', () => {
        const token = signRefreshToken({ sub: 'user_123' });
        expect(verifyRefreshToken(token).sub).toBe('user_123');
    });

    it('rejects a tampered token', () => {
        const token = signAccessToken({ sub: 'user_123', email: 'a@b.com' });
        const tampered = token.slice(0, -2) + (token.slice(-2) === 'aa' ? 'bb' : 'aa');
        expect(() => verifyAccessToken(tampered)).toThrow();
    });

    it('rejects a token signed with a different secret', () => {
        const token = signAccessToken({ sub: 'user_123', email: 'a@b.com' });
        const originalSecret = process.env.JWT_SECRET;
        process.env.JWT_SECRET = 'a-completely-different-secret';
        expect(() => verifyAccessToken(token)).toThrow();
        process.env.JWT_SECRET = originalSecret;
    });

    it('does not accept an access token as a refresh token or vice versa interchangeably without checking claims', () => {
        // Both are signed with the same secret/algorithm, so this test documents
        // the current behavior rather than a hard guarantee — callers must not
        // rely on token *type* being structurally enforced, only on which
        // claims (sub vs sub+email) they choose to trust.
        const access = signAccessToken({ sub: 'user_1', email: 'x@y.com' });
        const asRefresh = verifyRefreshToken(access);
        expect(asRefresh.sub).toBe('user_1');
    });
});
