import crypto from 'crypto';

/**
 * Signed license keys (v1).
 *
 * Format: LLMO1.<base64url(JSON payload)>.<base64url(Ed25519 signature)>
 *
 * The license server signs with LICENSE_PRIVATE_KEY (never leaves Vercel); the
 * app verifies offline with the matching public key embedded in
 * packages/proxy/src/licenseKeys.ts. Unlike the legacy HMAC PRO_ keys, nobody
 * can mint a valid key from the open-source code, and customers' Pro keeps
 * working even when this server is unreachable.
 *
 * Generate a keypair with `npm run keygen --workspace=@llm-observer/license-server`.
 */

export const SIGNED_KEY_PREFIX = 'LLMO1';

export interface LicensePayload {
    v: 1;
    /** Stable customer/subscription reference, e.g. "ls:12345" or "rzp:sub_ABC". */
    sub: string;
    plan: 'pro';
    /** Issued-at, unix seconds. */
    iat: number;
}

const b64url = (buf: Buffer) => buf.toString('base64url');

function loadPrivateKey(): crypto.KeyObject | null {
    const raw = process.env.LICENSE_PRIVATE_KEY;
    if (!raw) return null;
    // Accept a PEM block, or the PEM with "\n" escaped as is common in env UIs
    const pem = raw.includes('BEGIN') ? raw.replace(/\\n/g, '\n') : `-----BEGIN PRIVATE KEY-----\n${raw}\n-----END PRIVATE KEY-----`;
    return crypto.createPrivateKey(pem);
}

export function isSigningConfigured(): boolean {
    return !!process.env.LICENSE_PRIVATE_KEY;
}

export function signLicenseKey(sub: string, privateKey: crypto.KeyObject | null = loadPrivateKey()): string {
    if (!privateKey) throw new Error('LICENSE_PRIVATE_KEY is not configured');
    const payload: LicensePayload = { v: 1, sub, plan: 'pro', iat: Math.floor(Date.now() / 1000) };
    const body = b64url(Buffer.from(JSON.stringify(payload)));
    const sig = crypto.sign(null, Buffer.from(`${SIGNED_KEY_PREFIX}.${body}`), privateKey);
    return `${SIGNED_KEY_PREFIX}.${body}.${b64url(sig)}`;
}

/** Returns the payload if the key was signed by the private key matching `publicKey`. */
export function verifySignedKey(key: string, publicKey: crypto.KeyObject | string): LicensePayload | null {
    const parts = key.trim().split('.');
    if (parts.length !== 3 || parts[0] !== SIGNED_KEY_PREFIX) return null;
    try {
        const pub = typeof publicKey === 'string' ? crypto.createPublicKey(publicKey) : publicKey;
        const ok = crypto.verify(null, Buffer.from(`${parts[0]}.${parts[1]}`), pub, Buffer.from(parts[2], 'base64url'));
        if (!ok) return null;
        const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf-8'));
        if (payload?.v !== 1 || typeof payload.sub !== 'string' || payload.plan !== 'pro') return null;
        return payload as LicensePayload;
    } catch {
        return null;
    }
}

/** Public key (SPKI PEM) for the configured private key — what the app embeds. */
export function configuredPublicKeyPem(): string | null {
    const priv = loadPrivateKey();
    if (!priv) return null;
    return crypto.createPublicKey(priv).export({ type: 'spki', format: 'pem' }).toString();
}
