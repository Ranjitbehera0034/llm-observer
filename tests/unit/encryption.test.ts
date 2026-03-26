import { describe, it, expect } from 'vitest';
import { encrypt, decrypt } from '../../packages/database/src/encryption';

describe('Encryption Module', () => {
    it('successfully encrypts and decrypts a simple string', () => {
        const plaintext = 'sk-test-secret-key-12345';
        const ciphertext = encrypt(plaintext);
        
        expect(ciphertext).toBeDefined();
        expect(ciphertext).not.toEqual(plaintext);
        
        // Assert format: iv:authTag:encryptedData
        const parts = ciphertext.split(':');
        expect(parts.length).toBe(3);
        
        const decrypted = decrypt(ciphertext);
        expect(decrypted).toEqual(plaintext);
    });

    it('generates different ciphertexts for the same plaintext due to random IV', () => {
        const plaintext = 'another-secret';
        const cipher1 = encrypt(plaintext);
        const cipher2 = encrypt(plaintext);
        
        expect(cipher1).not.toEqual(cipher2);
        
        const dec1 = decrypt(cipher1);
        const dec2 = decrypt(cipher2);
        
        expect(dec1).toEqual(plaintext);
        expect(dec2).toEqual(plaintext);
    });

    it('throws error when decrypting invalid format', () => {
        expect(() => decrypt('invalid-format-string')).toThrow('Invalid ciphertext format');
    });

    it('throws error when decrypting with tampered data', () => {
        const plaintext = 'sensitive-data';
        const ciphertext = encrypt(plaintext);
        
        const parts = ciphertext.split(':');
        // Tamper with the encrypted data part
        parts[2] = 'bad' + parts[2].substring(3);
        const tamperedCiphertext = parts.join(':');
        
        expect(() => decrypt(tamperedCiphertext)).toThrow();
    });
});
