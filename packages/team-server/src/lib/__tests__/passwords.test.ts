import { hashPassword, verifyPassword } from '../passwords';

describe('passwords', () => {
    it('hashes a password and verifies the correct plaintext against it', async () => {
        const hash = await hashPassword('correct horse battery staple');
        expect(hash).not.toBe('correct horse battery staple'); // never store plaintext
        expect(await verifyPassword('correct horse battery staple', hash)).toBe(true);
    });

    it('rejects an incorrect password', async () => {
        const hash = await hashPassword('correct horse battery staple');
        expect(await verifyPassword('wrong password', hash)).toBe(false);
    });

    it('produces a different hash each time (random salt)', async () => {
        const a = await hashPassword('same input');
        const b = await hashPassword('same input');
        expect(a).not.toBe(b);
        expect(await verifyPassword('same input', a)).toBe(true);
        expect(await verifyPassword('same input', b)).toBe(true);
    });
});
