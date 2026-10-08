import crypto from 'crypto';

/**
 * Offline verification of signed (LLMO1) license keys.
 *
 * The license server signs keys with an Ed25519 private key that only exists
 * in its Vercel environment; this is the matching public key. Anyone can read
 * it, but only the server can produce a key it accepts — so Pro can't be
 * unlocked by typing a made-up key, and it keeps working when the license
 * server is unreachable.
 *
 * Rotating the server's keypair (npm run keygen in packages/license-server)
 * means updating this constant and shipping a release.
 */
const LICENSE_PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAXLOILcsKLpbHbjuQyIpfMJ+69+Bo5mM7906R0Hfbpro=
-----END PUBLIC KEY-----`;

export const SIGNED_KEY_PREFIX = 'LLMO1';

export interface LicensePayload {
    v: 1;
    sub: string;
    /** 'team' gets the same limits as 'pro'. */
    plan: LicensePlan;
    /** Seats bought (team plan). Informational: nothing enforces it offline. */
    seats?: number;
    iat: number;
}

export type LicensePlan = 'pro' | 'team';
const MAX_SEATS = 100_000;

let publicKey: crypto.KeyObject = crypto.createPublicKey(LICENSE_PUBLIC_KEY_PEM);

/** Test hook: verify against a throwaway keypair instead of the production key. */
export function __setLicensePublicKeyForTests(pem: string): void {
    publicKey = crypto.createPublicKey(pem);
}

export function isSignedKey(key: string): boolean {
    return key.startsWith(`${SIGNED_KEY_PREFIX}.`);
}

export function verifySignedKey(key: string): LicensePayload | null {
    const parts = key.trim().split('.');
    if (parts.length !== 3 || parts[0] !== SIGNED_KEY_PREFIX) return null;
    try {
        const ok = crypto.verify(null, Buffer.from(`${parts[0]}.${parts[1]}`), publicKey, Buffer.from(parts[2], 'base64url'));
        if (!ok) return null;
        const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf-8'));
        if (payload?.v !== 1 || typeof payload.sub !== 'string') return null;
        if (payload.plan !== 'pro' && payload.plan !== 'team') return null;
        if (payload.seats !== undefined
            && !(typeof payload.seats === 'number' && Number.isInteger(payload.seats) && payload.seats >= 1 && payload.seats <= MAX_SEATS)) return null;
        return payload as LicensePayload;
    } catch {
        return null;
    }
}

/** Format of legacy keys issued by the license server before 2.0.1. */
export const LEGACY_KEY_FORMAT = /^PRO_(LS|RZP)_[A-F0-9]{8}_[A-Z0-9]{1,12}$/;
