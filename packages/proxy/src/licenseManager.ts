import { getDb, getSetting, updateSetting } from '@llm-observer/database';
import { createHash, createHmac } from 'crypto';
import os from 'os';
import { version as APP_VERSION } from '../package.json';
import { isSignedKey, verifySignedKey, LEGACY_KEY_FORMAT } from './licenseKeys';

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

    // Signed keys are re-verified on every check, so a key can't be made Pro by
    // editing the database. Legacy PRO_ keys were verified by the license
    // server (or dev mode) at activation and are guarded by the HMAC below.
    const isPro = !!licenseKey && (
        isSignedKey(licenseKey) ? verifySignedKey(licenseKey) !== null : licenseKey.startsWith('PRO_')
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

/**
 * Base URL of the license server (packages/license-server). LICENSE_SERVER_URL
 * is the older name, which some setups pointed at the /license/validate path
 * itself — both forms are accepted.
 */
export function licenseServerUrl(): string {
    const raw = process.env.LLM_OBSERVER_LICENSE_SERVER || process.env.LICENSE_SERVER_URL || 'https://api.llm-observer.com';
    return raw.replace(/\/+$/, '').replace(/\/(license\/)?validate$/, '');
}

type ServerVerdict =
    | { kind: 'valid' }
    | { kind: 'revoked'; message: string }
    | { kind: 'invalid'; message: string }
    | { kind: 'unreachable' };

/**
 * Asks the license server about a key. Sends the key, the machine ID (a hash
 * of hostname/CPU/OS — see getMachineId) and the app version; the server uses
 * them to verify legacy keys, record which devices are activated, and report
 * expired subscriptions.
 */
async function askLicenseServer(key: string): Promise<ServerVerdict> {
    try {
        const response = await fetch(`${licenseServerUrl()}/license/validate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ license_key: key, machine_id: getMachineId(), version: APP_VERSION }),
            signal: AbortSignal.timeout(10_000),
        });
        const data = await response.json().catch(() => ({})) as any;
        if (response.ok && data.valid) return { kind: 'valid' };
        if (data.revoked) return { kind: 'revoked', message: data.error || 'This subscription has ended.' };
        if (response.status >= 400 && response.status < 500 && data.valid === false) {
            return { kind: 'invalid', message: data.error || 'Invalid license key. Please check your key or contact support.' };
        }
        return { kind: 'unreachable' };
    } catch {
        return { kind: 'unreachable' };
    }
}

function storeActiveLicense(key: string): void {
    updateSetting('license_key', key);
    updateSetting('license_key_hmac', signLicenseKey(key));
    updateSetting('license_status', 'active');
    updateSetting('license_machine_id', getMachineId());
    updateSetting('license_checked_at', new Date().toISOString());
    cachedLicense = null;
}

export async function activateLicense(rawKey: string): Promise<{ success: boolean; message: string }> {
    const key = rawKey.trim();

    // Signed keys: verified offline, so activation works even if the license
    // server is down. The server is still told (to record the device and catch
    // an already-expired subscription) but can only block on an explicit "revoked".
    if (isSignedKey(key)) {
        if (!verifySignedKey(key)) {
            return { success: false, message: 'Invalid license key. Please copy the full key from your purchase email.' };
        }
        const verdict = await askLicenseServer(key);
        if (verdict.kind === 'revoked') return { success: false, message: verdict.message };
        storeActiveLicense(key);
        return { success: true, message: 'License activated successfully! Enjoy Pro features.' };
    }

    // Legacy keys issued before 2.0.1 can only be verified by the license server.
    if (LEGACY_KEY_FORMAT.test(key)) {
        const verdict = await askLicenseServer(key);
        if (verdict.kind === 'valid') {
            storeActiveLicense(key);
            return { success: true, message: 'License activated successfully! Enjoy Pro features.' };
        }
        if (verdict.kind === 'unreachable') {
            return { success: false, message: 'Validation server unreachable. Please try again later.' };
        }
        return { success: false, message: verdict.message };
    }

    // Local development / tests only — never accepted in a normal install.
    if (key.startsWith('PRO_') && process.env.LLM_OBSERVER_DEV_LICENSE === '1') {
        storeActiveLicense(key);
        return { success: true, message: 'License activated successfully! (Dev Mode)' };
    }

    return { success: false, message: 'Invalid license key. Keys start with LLMO1. — purchase at https://www.llm-observer.com/#pricing' };
}

const REVALIDATE_EVERY_MS = 24 * 60 * 60 * 1000;
let revalidateTimer: NodeJS.Timeout | null = null;

/**
 * Re-checks the stored key with the license server at most once a day, so a
 * subscription that has ended drops back to Free. Network failures never
 * downgrade anyone — only an explicit "revoked" or "invalid" answer does.
 */
export async function revalidateLicense(force = false): Promise<void> {
    const key = getSetting('license_key');
    if (!key || getSetting('license_status') !== 'active') return;
    if (key.startsWith('PRO_') && !LEGACY_KEY_FORMAT.test(key)) return; // dev-mode / local-webhook key

    const last = Date.parse(getSetting('license_checked_at') || '') || 0;
    if (!force && Date.now() - last < REVALIDATE_EVERY_MS) return;

    const verdict = await askLicenseServer(key);
    if (verdict.kind === 'unreachable') return;
    updateSetting('license_checked_at', new Date().toISOString());
    if (verdict.kind === 'revoked' || verdict.kind === 'invalid') {
        console.warn(`[LICENSE] ${verdict.message} Switching to the Free plan.`);
        updateSetting('license_status', 'cancelled');
        cachedLicense = null;
    }
}

export function startLicenseRevalidation(): void {
    if (revalidateTimer) clearInterval(revalidateTimer);
    revalidateLicense().catch(() => { /* never let licensing crash the app */ });
    revalidateTimer = setInterval(() => revalidateLicense().catch(() => {}), 60 * 60 * 1000);
    revalidateTimer.unref?.();
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
