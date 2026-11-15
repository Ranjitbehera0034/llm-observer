process.env.LICENSE_SERVER_URL = 'http://localhost:3000/license/validate';
const settings = new Map<string, string>();
jest.mock('@llm-observer/database', () => ({
    getDb: jest.fn(), getSetting: (key: string) => settings.get(key) || null,
    updateSetting: (key: string, value: string) => settings.set(key, value),
}));
const mockFetch = jest.fn();
(global as any).fetch = mockFetch;
import { activateLicense, getLicenseInfo } from '../../licenseManager';
const valid = (days = 10) => ({ ok: true, status: 200, json: async () => ({ valid: true, valid_until: new Date(Date.now() + days * 86400000).toISOString() }) });
beforeEach(() => { settings.clear(); mockFetch.mockReset(); });
afterEach(() => { jest.restoreAllMocks(); });
it('keeps a bounded lease during a temporary provider outage', async () => {
    mockFetch.mockResolvedValueOnce(valid()); await activateLicense('PRO_test');
    settings.set('license_verified_at', String(Date.now() - 7 * 3600000));
    settings.set('license_last_attempt_at', '0');
    mockFetch.mockRejectedValue(new Error('offline'));
    expect((await getLicenseInfo(true)).isPro).toBe(true);
    settings.set('license_verified_at', String(Date.now() - 73 * 3600000));
    expect((await getLicenseInfo(true)).isPro).toBe(false);
});
it('expires access even when the service is unavailable', async () => {
    mockFetch.mockResolvedValueOnce(valid()); await activateLicense('PRO_test');
    settings.set('license_valid_until', '2020-01-01');
    mockFetch.mockRejectedValue(new Error('offline'));
    expect((await getLicenseInfo(true)).isPro).toBe(false);
});
it('revokes after the provider confirms a refund', async () => {
    mockFetch.mockResolvedValueOnce(valid()); await activateLicense('PRO_test');
    settings.set('license_verified_at', String(Date.now() - 7 * 3600000));
    settings.set('license_last_attempt_at', '0');
    mockFetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({ valid: false }) });
    expect((await getLicenseInfo(true)).isPro).toBe(false);
});
it('does not expose the saved key in status responses', async () => {
    mockFetch.mockResolvedValueOnce(valid()); await activateLicense('PRO_test');
    expect((await getLicenseInfo(true)).licenseKey).toBeUndefined();
});
it('rejects a successful response without an expiry', async () => {
    mockFetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({ valid: true }) });
    expect((await activateLicense('PRO_test')).success).toBe(false);
});

it('does not let the one-minute status cache extend the paid-through date', async () => {
    const now = Date.now();
    const time = jest.spyOn(Date, 'now').mockReturnValue(now);
    mockFetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ valid: true, valid_until: new Date(now + 1000).toISOString() }) });
    await activateLicense('PRO_test');
    expect((await getLicenseInfo(true)).isPro).toBe(true);
    time.mockReturnValue(now + 2000);
    mockFetch.mockRejectedValue(new Error('offline'));
    expect((await getLicenseInfo()).isPro).toBe(false);
});

it('does not let the status cache extend the 72-hour offline limit', async () => {
    const now = Date.now();
    const time = jest.spyOn(Date, 'now').mockReturnValue(now);
    mockFetch.mockResolvedValueOnce(valid()); await activateLicense('PRO_test');
    settings.set('license_verified_at', String(now - 72 * 3600000 + 1000));
    settings.set('license_last_attempt_at', String(now));
    expect((await getLicenseInfo(true)).isPro).toBe(true);
    time.mockReturnValue(now + 2000);
    expect((await getLicenseInfo()).isPro).toBe(false);
});

it('keeps a billing recovery link after a failed renewal revokes Pro', async () => {
    mockFetch.mockResolvedValueOnce(valid()); await activateLicense('PRO_LS_test');
    settings.set('license_verified_at', String(Date.now() - 7 * 3600000));
    settings.set('license_last_attempt_at', '0');
    mockFetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({ valid: false }) });
    const status = await getLicenseInfo(true);
    expect(status.isPro).toBe(false);
    expect(status.portalUrl).toBe('https://app.lemonsqueezy.com/my-orders');
});
