import Database from 'better-sqlite3';

process.env.LICENSE_SERVER_URL = 'http://localhost:3000/license/validate';
const settings = new Map<string, string>();
let db: Database.Database;
jest.mock('@llm-observer/database', () => ({
    getDb: () => db,
    getSetting: (key: string) => settings.get(key) || null,
    updateSetting: (key: string, value: string) => settings.set(key, value),
}));
const originalFetch = global.fetch;
const mockFetch = jest.fn();
global.fetch = mockFetch;

import { activateLicense, getLicenseInfo } from '../../licenseManager';
import { runRetentionCleanup } from '../../retentionManager';

beforeEach(() => {
    settings.clear();
    mockFetch.mockReset();
    db = new Database(':memory:');
    db.exec(`
        CREATE TABLE requests (id TEXT PRIMARY KEY, created_at TEXT);
        INSERT INTO requests VALUES ('recent', datetime('now', '-5 days'));
        INSERT INTO requests VALUES ('paid-history', datetime('now', '-30 days'));
        INSERT INTO requests VALUES ('too-old', datetime('now', '-91 days'));
        CREATE TABLE app_connections (id TEXT PRIMARY KEY, timestamp TEXT);
        INSERT INTO app_connections VALUES ('recent', datetime('now', '-5 days'));
        INSERT INTO app_connections VALUES ('too-old', datetime('now', '-31 days'));
    `);
});
afterEach(() => db.close());
afterAll(() => { global.fetch = originalFetch; });

async function activatePaidLicense() {
    mockFetch.mockResolvedValueOnce({
        ok: true, status: 200,
        json: async () => ({ valid: true, valid_until: new Date(Date.now() + 20 * 86400000).toISOString() }),
    });
    expect((await activateLicense('PRO_retention_test')).success).toBe(true);
}

function requestIds() {
    return db.prepare('SELECT id FROM requests ORDER BY id').all().map((row: any) => row.id);
}

it('keeps the normal seven-day window for a fresh free installation', async () => {
    await runRetentionCleanup();
    expect(requestIds()).toEqual(['recent']);
    expect(mockFetch).not.toHaveBeenCalled();
});

it('keeps 90 days for active Pro and still purges older records', async () => {
    await activatePaidLicense();
    await runRetentionCleanup();
    expect(requestIds()).toEqual(['paid-history', 'recent']);
    expect(db.prepare('SELECT id FROM app_connections').all()).toEqual([{ id: 'recent' }]);
});

it('preserves paid history when an outage exceeds the offline lease', async () => {
    await activatePaidLicense();
    settings.set('license_verified_at', String(Date.now() - 73 * 3600000));
    settings.set('license_last_attempt_at', '0');
    mockFetch.mockRejectedValue(new Error('offline'));
    await runRetentionCleanup();
    expect((await getLicenseInfo(true)).isPro).toBe(false);
    expect(requestIds()).toEqual(['paid-history', 'recent']);
});

it('preserves the bounded history window after confirmed revocation', async () => {
    await activatePaidLicense();
    settings.set('license_verified_at', String(Date.now() - 7 * 3600000));
    settings.set('license_last_attempt_at', '0');
    mockFetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({ valid: false }) });
    await runRetentionCleanup();
    expect(settings.get('license_status')).toBe('cancelled');
    expect((await getLicenseInfo(true)).isPro).toBe(false);
    expect(requestIds()).toEqual(['paid-history', 'recent']);
});

it('preserves history when a paid-through date expires while offline', async () => {
    await activatePaidLicense();
    settings.set('license_valid_until', '2020-01-01');
    settings.set('license_last_attempt_at', '0');
    mockFetch.mockRejectedValue(new Error('offline'));
    await runRetentionCleanup();
    expect((await getLicenseInfo(true)).isPro).toBe(false);
    expect(requestIds()).toEqual(['paid-history', 'recent']);
});

it.each(['PRO_LS_OLDKEY_SUB123', 'sk_live_legacy'])('preserves history while a legacy license needs migration: %s', async key => {
    settings.set('license_key', key);
    await runRetentionCleanup();
    expect(requestIds()).toEqual(['paid-history', 'recent']);
});


it('purges old ISO network timestamps without deleting newer legacy timestamps on the cutoff day', async () => {
    const oldIso = new Date(Date.now() - 30 * 86400000 - 3600000).toISOString();
    const recentLegacy = new Date(Date.now() - 30 * 86400000 + 3600000).toISOString().replace('T', ' ').slice(0, 19);
    db.prepare('INSERT INTO app_connections VALUES (?, ?)').run('old-iso', oldIso);
    db.prepare('INSERT INTO app_connections VALUES (?, ?)').run('new-legacy', recentLegacy);
    await runRetentionCleanup();
    expect(db.prepare('SELECT id FROM app_connections ORDER BY id').all()).toEqual([{ id: 'new-legacy' }, { id: 'recent' }]);
});
