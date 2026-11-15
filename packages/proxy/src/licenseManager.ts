import { getDb, getSetting, updateSetting } from '@llm-observer/database';
import { createHash, createHmac, timingSafeEqual } from 'crypto';
import os from 'os';

/**
 * Generates a machine-specific HMAC key for signing locally stored license keys.
 * Uses machine fingerprint as the HMAC secret so a key copied to another machine
 * won't pass integrity checks.
 */
function getLicenseHmacSecret(): string {
    return getMachineId();
}

/**
 * Signs a license key with a machine-specific HMAC.
 * The HMAC is stored alongside the key so we can detect tampering.
 */
function signLicenseKey(key: string): string {
    return createHmac('sha256', getLicenseHmacSecret()).update(key).digest('hex');
}

/**
 * Verifies that a stored license key has not been tampered with
 * by comparing the stored HMAC against a freshly computed one.
 */
function verifyLicenseKeyIntegrity(key: string, storedHmac: string | null): boolean {
    if (!storedHmac) return false;
    const expected = signLicenseKey(key);
    // Constant-time comparison
    if (expected.length !== storedHmac.length) return false;
    try {
        return timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(storedHmac, 'hex'));
    } catch {
        return false;
    }
}

export interface LicenseInfo {
    isPro: boolean;
    licenseKey?: string;
    validUntil?: string;
    portalUrl?: string;
    status: 'active' | 'cancelled' | 'free';
    limits: {
        maxProjects: number;
        logRetentionDays: number;
    };
}

const FREE_LIMITS = {
    maxProjects: 1,
    logRetentionDays: 7
};

const PRO_LIMITS = {
    maxProjects: 100,
    logRetentionDays: 90
};

// Simple cache to avoid DB hits on every request
let cachedLicense: LicenseInfo | null = null;
let lastCheckTime = 0;
let cachedAccessExpiresAt = 0;
const CACHE_TTL = 60 * 1000; // 1 minute

/**
 * FIX SEC-01: Generate a non-identifying machine fingerprint.
 * Uses SHA256 of stable hardware/OS properties. Not reversible to personal data.
 */
export function getMachineId(): string {
    const raw = [
        os.hostname(),
        os.cpus()[0]?.model || '',
        os.platform(),
        os.arch(),
        os.type(),
    ].join('|');
    return createHash('sha256').update(raw).digest('hex').substring(0, 32);
}

export async function getLicenseInfo(forceRefresh = false): Promise<LicenseInfo> {
    const now = Date.now();
    if (cachedLicense && !forceRefresh && (now - lastCheckTime < CACHE_TTL) && (!cachedLicense.isPro || now < cachedAccessExpiresAt)) {
        return cachedLicense;
    }

    const licenseKey = getSetting('license_key');
    const licenseStatus = getSetting('license_status');

    const isPro = !!licenseKey && (
        licenseKey.startsWith('PRO_') ||
        licenseKey.startsWith('sk_live_')
    );

    // Verify the stored key hasn't been tampered with (e.g. via direct DB edit)
    if (isPro) {
        const storedHmac = getSetting('license_key_hmac');
        if (!verifyLicenseKeyIntegrity(licenseKey, storedHmac)) {
            console.warn('[LICENSE] License key integrity check failed — key may have been tampered with. Treating as free tier.');
            cachedLicense = { isPro: false, licenseKey: undefined, status: 'free', limits: FREE_LIMITS };
            lastCheckTime = now;
            return cachedLicense;
        }
    }

    // Revalidate at most once every six hours, with a bounded offline lease.
    // Provider denial revokes access immediately; outages cannot grant new Pro.
    if (isPro) {
        const lastVerified = Number(getSetting('license_verified_at') || 0);
        const validUntil = Date.parse(getSetting('license_valid_until') || '');
        const lastAttempt = Number(getSetting('license_last_attempt_at') || 0);
        if ((now - lastVerified >= 6 * 3600000 || !Number.isFinite(validUntil) || validUntil <= now || licenseStatus === 'cancelled') && now - lastAttempt >= 5 * 60000) {
            await refreshEntitlement(licenseKey!);
        }
        const refreshedUntil = Date.parse(getSetting('license_valid_until') || '');
        const verifiedAt = Number(getSetting('license_verified_at') || 0);
        cachedAccessExpiresAt = Math.min(refreshedUntil, verifiedAt + 72 * 3600000);
        if (getSetting('license_status') !== 'active' || !Number.isFinite(cachedAccessExpiresAt) || cachedAccessExpiresAt <= Date.now()) {
            cachedLicense = { isPro: false, status: 'free', limits: FREE_LIMITS, portalUrl: billingPortal(licenseKey) };
            lastCheckTime = now;
            return cachedLicense;
        }
    }

    cachedLicense = {
        isPro,
        validUntil: getSetting('license_valid_until') || undefined,
        portalUrl: billingPortal(licenseKey),
        status: isPro ? 'active' : 'free',
        limits: isPro ? PRO_LIMITS : FREE_LIMITS
    };
    lastCheckTime = now;

    return cachedLicense;
}

function billingPortal(key: string | null): string | undefined {
    // A durable sign-in URL remains useful after expiry, payment failure, or an
    // outage. Provider-signed portal links expire after 24 hours.
    if (key?.startsWith('PRO_LS_')) return 'https://app.lemonsqueezy.com/my-orders';
    return undefined;
}

// Release builds can bake a verified public URL in via tsup. No secret is bundled.
declare const __LICENSE_SERVER_URL__: string;
const VALIDATOR_URL = process.env.LICENSE_SERVER_URL || (typeof __LICENSE_SERVER_URL__ !== 'undefined' ? __LICENSE_SERVER_URL__ : '');
let refreshPromise: Promise<{ success: boolean; message: string }> | null = null;

async function verifyRemote(key: string): Promise<{ success: boolean; message: string }> {
    if (!VALIDATOR_URL) return { success: false, message: 'Pro activation is not configured in this build. Contact support; free tracking remains available.' };
    try {
        const url = new URL(VALIDATOR_URL);
        if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))) throw new Error('HTTPS required');
        updateSetting('license_last_attempt_at', String(Date.now()));
        const response = await fetch(url.toString(), {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ license_key: key }), signal: AbortSignal.timeout(8000)
        });
        const data = await response.json() as any;
        const until = Date.parse(data.valid_until || '');
        if (response.ok && data.valid === true && Number.isFinite(until) && until > Date.now()) {
            updateSetting('license_key', key);
            updateSetting('license_key_hmac', signLicenseKey(key));
            updateSetting('license_status', 'active');
            updateSetting('license_valid_until', new Date(until).toISOString());
            updateSetting('license_verified_at', String(Date.now()));
            const portal = typeof data.portal_url === 'string' && /^https:\/\/[^/]+\.lemonsqueezy\.com\//.test(data.portal_url) ? data.portal_url : '';
            updateSetting('license_portal_url', portal);
            cachedLicense = null;
            return { success: true, message: 'License activated. Pro access is verified through ' + new Date(until).toLocaleDateString() + '.' };
        }
        // A temporary provider outage must not revoke a previously valid lease.
        if (data.valid === false && response.status < 500 && key === getSetting('license_key')) {
            updateSetting('license_status', 'cancelled');
            updateSetting('license_valid_until', '');
            cachedLicense = null;
        }
        return { success: false, message: data.error || 'License could not be verified. Please retry.' };
    } catch {
        return { success: false, message: 'License service unavailable. Please retry. Your existing verified access remains available until its offline limit.' };
    }
}

async function refreshEntitlement(key: string) {
    if (!refreshPromise) refreshPromise = verifyRemote(key).finally(() => { refreshPromise = null; });
    return refreshPromise;
}

export async function activateLicense(key: string): Promise<{ success: boolean; message: string }> {
    if (typeof key !== 'string' || !key.trim().startsWith('PRO_') || key.length > 256) return { success: false, message: 'Enter the PRO_ license key from your purchase email.' };
    return verifyRemote(key.trim());
}

export async function checkProjectLimit(): Promise<boolean> {
    const db = getDb();
    const info = await getLicenseInfo();

    // Exclude the bootstrapped 'default' project from the limit count
    // so free users can always create at least one project of their own.
    const countRow = db.prepare("SELECT count(*) as count FROM projects WHERE id != 'default'").get() as any;
    const projectCount = countRow.count;

    return projectCount < info.limits.maxProjects;
}

/**
 * Called by payment webhooks to instantly activate a Pro license locally.
 */
export function activateLicenseFromPayment(opts: {
    provider: 'lemonsqueezy' | 'razorpay';
    subscriptionId: string;
    customerId: string;
    amountCents: number;
    currency: string;
    event: string;
}): { success: boolean; key: string } {
    const key = `PRO_${opts.provider.toUpperCase()}_${opts.subscriptionId}`;

    updateSetting('license_key', key);
    updateSetting('license_key_hmac', signLicenseKey(key));
    updateSetting('license_status', 'active');
    updateSetting('license_provider', opts.provider);
    updateSetting('license_subscription_id', opts.subscriptionId);
    updateSetting('license_customer_id', opts.customerId);
    updateSetting('license_amount_cents', String(opts.amountCents));
    updateSetting('license_currency', opts.currency);
    updateSetting('license_activated_at', new Date().toISOString());
    updateSetting('license_last_event', opts.event);

    cachedLicense = null;

    console.log(`[LICENSE] ✅ Activated via ${opts.provider} webhook. Key: ${key.substring(0, 20)}...`);
    return { success: true, key };
}
