import crypto from 'crypto';

// Legacy PRO_ keys are only verified now; new keys are Ed25519-signed (see signing.ts).
//
// LICENSE_SECRET is the name .env.example documented while the code read
// LICENSE_SIGNING_SECRET, so a deploy that followed the docs signed every key
// with the public fallback below. Such keys are forgeable by anyone, so they
// are rejected unless the owner opts in with ALLOW_LEGACY_DEV_SECRET=true
// (to honour early customers while re-issuing them signed keys).
const DEV_SECRET = 'dev-secret-change-in-prod';

function legacySecrets(): string[] {
    const configured = [process.env.LICENSE_SIGNING_SECRET, process.env.LICENSE_SECRET].filter((s): s is string => !!s);
    if (configured.length === 0) return [DEV_SECRET]; // local dev / tests
    if (process.env.ALLOW_LEGACY_DEV_SECRET === 'true') configured.push(DEV_SECRET);
    return configured;
}

const fingerprintFor = (providerTag: string, shortSubId: string, secret: string = legacySecrets()[0]): string => {
    const hmac = crypto.createHmac('sha256', secret);
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
    return legacySecrets().some(secret => {
        const expected = fingerprintFor(providerTag, shortSubId, secret);
        try {
            return crypto.timingSafeEqual(Buffer.from(fingerprint), Buffer.from(expected));
        } catch {
            return false;
        }
    });
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
