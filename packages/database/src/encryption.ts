import crypto from 'crypto';
import os from 'os';
import { machineIdSync } from 'node-machine-id';

// Advanced Encryption Standard, 256-bit key, Galois/Counter Mode
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;

/**
 * Derives a consistent 32-byte key specific to this machine and user.
 * This prevents the database from being copied and decrypted elsewhere.
 */
function getDerivedKey(): Buffer {
    let machineId = 'fallback-machine-id';
    try {
        machineId = machineIdSync();
    } catch (err) {
        console.warn('Could not determine machine ID. Falling back to default identifier.', err);
    }
    
    const username = os.userInfo().username || 'unknown-user';
    
    // We use a static salt because the key derivation input (machineId + username) 
    // is already unique to the environment, and we need to reliably re-derive 
    // the exact same key across application restarts.
    const staticSalt = 'llm-observer-salt'; 
    
    return crypto.scryptSync(`${machineId}:${username}`, staticSalt, 32);
}

/**
 * Encrypts a plaintext string using AES-256-GCM.
 * @param plaintext The string to encrypt (e.g., API key)
 * @returns Ciphertext in the format: iv:authTag:encryptedData (hex)
 */
export function encrypt(plaintext: string): string {
    const key = getDerivedKey();
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
    
    let encrypted = cipher.update(plaintext, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag().toString('hex');
    
    return `${iv.toString('hex')}:${authTag}:${encrypted}`;
}

/**
 * Decrypts a ciphertext string formatted as iv:authTag:encryptedData.
 * @param ciphertext The encrypted string
 * @returns Plaintext string
 */
export function decrypt(ciphertext: string): string {
    const key = getDerivedKey();
    const parts = ciphertext.split(':');
    
    if (parts.length !== 3) {
        throw new Error('Invalid ciphertext format. Expected iv:authTag:encryptedData');
    }
    
    const [ivHex, authTagHex, encryptedHex] = parts;
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);
    
    let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
    return decrypted;
}
