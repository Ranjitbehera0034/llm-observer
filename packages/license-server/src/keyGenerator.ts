import crypto from 'crypto';

function secret(): string {
    const value = process.env.LICENSE_SIGNING_SECRET;
    if (!value || value.length < 32) throw new Error('LICENSE_SIGNING_SECRET must contain at least 32 characters');
    return value;
}

// Full, case-preserving provider IDs avoid collisions from truncated payment IDs.
export function generateLicenseKey(opts: {
    provider: 'lemonsqueezy' | 'razorpay'; subscriptionId: string; customerId: string;
}): string {
    if (!/^[a-zA-Z0-9_-]{1,100}$/.test(opts.subscriptionId)) throw new Error('Invalid payment reference');
    const tag = opts.provider === 'lemonsqueezy' ? 'LS' : 'RZP';
    const reference = Buffer.from(opts.subscriptionId).toString('base64url');
    const signature = crypto.createHmac('sha256', secret()).update(`${tag}:${reference}`).digest('hex');
    return `PRO_${tag}_${signature}_${reference}`;
}

export function isValidLicenseKeyFormat(key: string): boolean {
    return typeof key === 'string' && /^PRO_(LS|RZP)_[a-f0-9]{64}_[A-Za-z0-9_-]{2,134}$/.test(key);
}

export function decodeLicenseKey(key: string): { provider: 'lemonsqueezy' | 'razorpay'; id: string } | null {
    if (!isValidLicenseKeyFormat(key)) return null;
    const match = /^PRO_(LS|RZP)_([a-f0-9]{64})_(.+)$/.exec(key)!;
    const [, tag, signature, reference] = match;
    const expected = crypto.createHmac('sha256', secret()).update(`${tag}:${reference}`).digest('hex');
    if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
    const id = Buffer.from(reference, 'base64url').toString();
    if (!/^[a-zA-Z0-9_-]{1,100}$/.test(id)) return null;
    return { provider: tag === 'LS' ? 'lemonsqueezy' : 'razorpay', id };
}

export function verifyLicenseKey(key: string): boolean { return decodeLicenseKey(key) !== null; }

export function verifyWebhookSignature(opts: { rawBody: Buffer; signature: string; secret: string }): boolean {
    if (!/^[a-fA-F0-9]{64}$/.test(opts.signature)) return false;
    const expected = crypto.createHmac('sha256', opts.secret).update(opts.rawBody).digest();
    return crypto.timingSafeEqual(Buffer.from(opts.signature, 'hex'), expected);
}

export async function getRawBody(req: Request): Promise<Buffer> { return Buffer.from(await req.arrayBuffer()); }
