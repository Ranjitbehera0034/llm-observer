import { getDb, getSetting, updateSetting } from '@llm-observer/database';
import { createHash, createHmac } from 'crypto';
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
        const { timingSafeEqual } = require('crypto');
        return timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(storedHmac, 'hex'));
    } catch {
        return false;
    }
}

export interface LicenseInfo {
    isPro: boolean;
    licenseKey?: string;
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
    if (cachedLicense && !forceRefresh && (now - lastCheckTime < CACHE_TTL)) {
        return cachedLicense;
    }

    const licenseKey = getSetting('license_key');
    const licenseStatus = getSetting('license_status');

    // Cancelled subscription always becomes free regardless of stored key
    if (licenseStatus === 'cancelled') {
        cachedLicense = { isPro: false, licenseKey: undefined, status: 'cancelled', limits: FREE_LIMITS };
        lastCheckTime = now;
        return cachedLicense;
    }

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

    cachedLicense = {
        isPro,
        licenseKey: licenseKey || undefined,
        status: isPro ? 'active' : 'free',
        limits: isPro ? PRO_LIMITS : FREE_LIMITS
    };
    lastCheckTime = now;

    return cachedLicense;
}

const VALIDATOR_URL = process.env.LICENSE_SERVER_URL || 'https://api.llmobserver.com/validate';

export async function activateLicense(key: string): Promise<{ success: boolean; message: string }> {
    if (!key.startsWith('PRO_') && !key.startsWith('sk_live_')) {
        return { success: false, message: 'Invalid format. Keys should start with PRO_ or sk_live_.' };
    }

    try {
        // PRO_ prefix is for local dev/testing — no seat enforcement
        if (key.startsWith('PRO_')) {
            updateSetting('license_key', key);
            updateSetting('license_key_hmac', signLicenseKey(key));
            updateSetting('license_status', 'active');
            cachedLicense = null;
            return { success: true, message: 'License activated successfully! (Dev Mode)' };
        }

        // FIX SEC-01: Send machine fingerprint to license server for seat enforcement
        const machineId = getMachineId();
        const keyHash = createHash('sha256').update(key).digest('hex');

        console.log(`[LICENSE] Validating key ${key.substring(0, 8)}... via ${VALIDATOR_URL}`);

        const response = await fetch(VALIDATOR_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            // Only send the hash and machine ID — never the raw key over the wire
            body: JSON.stringify({ machine_id: machineId, key_hash: keyHash })
        });

        const data = await response.json() as any;

        if (response.ok && data.valid) {
            updateSetting('license_key', key);
            updateSetting('license_key_hmac', signLicenseKey(key));
            updateSetting('license_status', 'active');
            updateSetting('license_machine_id', machineId);
            cachedLicense = null;
            const seatsMsg = data.seats_used ? ` (Seat ${data.seats_used}/${data.max_seats})` : '';
            return { success: true, message: `License activated successfully! Enjoy Pro features.${seatsMsg}` };
        }

        if (response.status === 409) {
            return {
                success: false,
                message: `Seat limit reached. This license is already active on ${data.seats_used} devices (max: ${data.max_seats}). Deactivate another device or upgrade your plan.`
            };
        }

        return {
            success: false,
            message: data.error || 'Invalid license key. Please check your key or contact support.'
        };
    } catch (err) {
        console.error('License validation failed:', err);
        return {
            success: false,
            message: 'Validation server unreachable. Please try again later.'
        };
    }
}

export async function checkProjectLimit(): Promise<boolean> {
    const db = getDb();
    const info = await getLicenseInfo();

    const countRow = db.prepare('SELECT count(*) as count FROM projects').get() as any;
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
