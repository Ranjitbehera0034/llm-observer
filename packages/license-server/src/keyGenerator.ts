import crypto from 'crypto';

const SIGNING_SECRET = process.env.LICENSE_SIGNING_SECRET || 'dev-secret-change-in-prod';

/**
 * Generates a deterministic, signed PRO_ license key from payment metadata.
 *
 * Format: PRO_{PROVIDER}_{SHORT_HASH}_{SUBSCRIPTION_ID}
 *
 * The HMAC signature makes keys unforgeable without the secret.
 * The same payment event always generates the same key (idempotent).
 */
const fingerprintFor = (providerTag: string, shortSubId: string): string => {
    const hmac = crypto.createHmac('sha256', SIGNING_SECRET);
    hmac.update(`${providerTag}:${shortSubId}`);
    return hmac.digest('hex').substring(0, 8).toUpperCase();
};

export function generateLicenseKey(opts: {
    provider: 'lemonsqueezy' | 'razorpay';
    subscriptionId: string;
    customerId: string;
}): string {
    // Keep subscription ID but truncate for readability
    const shortSubId = opts.subscriptionId.replace(/[^a-zA-Z0-9]/g, '').substring(0, 12).toUpperCase();
    const providerTag = opts.provider === 'lemonsqueezy' ? 'LS' : 'RZP';

    // The fingerprint is an HMAC over exactly the components embedded in the
    // key, so /license/validate can re-derive and verify it offline.
    const fingerprint = fingerprintFor(providerTag, shortSubId);

    return `PRO_${providerTag}_${fingerprint}_${shortSubId}`;
}

/**
 * Verifies a license key is structurally valid (quick local check).
 * Full validation should also check against your DB / KV store.
 */
export function isValidLicenseKeyFormat(key: string): boolean {
    return /^PRO_(LS|RZP)_[A-F0-9]{8}_[A-Z0-9]{1,12}$/.test(key);
}

/**
 * Cryptographically verifies a PRO_ key: re-derives the HMAC fingerprint from
 * the key's own components and compares timing-safely. A key that merely
 * matches the format but wasn't issued by this server fails here.
 */
export function verifyLicenseKey(key: string): boolean {
    if (!isValidLicenseKeyFormat(key)) return false;
    const [, providerTag, fingerprint, shortSubId] = key.split('_');
    const expected = fingerprintFor(providerTag, shortSubId);
    try {
        return crypto.timingSafeEqual(Buffer.from(fingerprint), Buffer.from(expected));
    } catch {
        return false;
    }
}

/**
 * Verifies an HMAC-SHA256 signature from a payment provider webhook.
 * Uses timing-safe comparison to prevent timing attacks.
 */
export function verifyWebhookSignature(opts: {
    rawBody: Buffer;
    signature: string;
    secret: string;
}): boolean {
    const hmac = crypto.createHmac('sha256', opts.secret);
    hmac.update(opts.rawBody);
    const expected = hmac.digest('hex');

    try {
        return crypto.timingSafeEqual(
            Buffer.from(opts.signature, 'hex'),
            Buffer.from(expected, 'hex')
        );
    } catch {
        return false;
    }
}

/**
 * Reads the raw body from a Vercel Request (needed for HMAC verification).
 * Vercel passes the body as a Buffer in the raw request.
 */
export async function getRawBody(req: Request): Promise<Buffer> {
    const arrayBuffer = await req.arrayBuffer();
    return Buffer.from(arrayBuffer);
}
