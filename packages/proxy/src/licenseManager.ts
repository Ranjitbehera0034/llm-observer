import { getDb, getSetting, updateSetting } from '@llm-observer/database';

export interface LicenseInfo {
    isPro: boolean;
    licenseKey?: string;
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
    maxProjects: 100, // Effectively unlimited
    logRetentionDays: 90
};

// Simple cache to avoid DB hits on every request
let cachedLicense: LicenseInfo | null = null;
let lastCheckTime = 0;
const CACHE_TTL = 60 * 1000; // 1 minute

export async function getLicenseInfo(forceRefresh = false): Promise<LicenseInfo> {
    const now = Date.now();
    if (cachedLicense && !forceRefresh && (now - lastCheckTime < CACHE_TTL)) {
        return cachedLicense;
    }

    const licenseKey = getSetting('license_key');

    // Pro if key starts with 'PRO_' (mock) or 'sk_live_' (real)
    const isPro = licenseKey?.startsWith('PRO_') || licenseKey?.startsWith('sk_live_') || false;

    cachedLicense = {
        isPro,
        licenseKey: licenseKey || undefined,
        limits: isPro ? PRO_LIMITS : FREE_LIMITS
    };
    lastCheckTime = now;

    return cachedLicense;
}

const VALIDATOR_URL = process.env.LICENSE_SERVER_URL || 'https://api.llmobserver.com/validate';

export async function activateLicense(key: string): Promise<{ success: boolean; message: string }> {
    // 1. Local early exit for speed/MVP
    if (!key.startsWith('PRO_') && !key.startsWith('sk_live_')) {
        return { success: false, message: 'Invalid format. Keys should start with PRO_ or sk_live_.' };
    }

    try {
        console.log(`[LICENSE] Validating key ${key.substring(0, 8)}... via ${VALIDATOR_URL}`);

        // Allow PRO_ prefix for local development without external call
        if (key.startsWith('PRO_')) {
            updateSetting('license_key', key);
            cachedLicense = null;
            return { success: true, message: 'License activated successfully! (Local Mode)' };
        }

        const response = await fetch(VALIDATOR_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ license_key: key })
        });

        const data = await response.json() as any;

        if (response.ok && data.valid) {
            updateSetting('license_key', key);
            cachedLicense = null;
            return { success: true, message: 'License activated successfully! Enjoy Pro features.' };
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
