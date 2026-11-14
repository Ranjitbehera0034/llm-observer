import { getSetting, updateSetting } from '@llm-observer/database';

jest.mock('@llm-observer/database', () => ({
    getDb: jest.fn(),
    getSetting: jest.fn(),
    updateSetting: jest.fn(),
}));

process.env.LICENSE_SERVER_URL = 'http://localhost:3000/license/validate';
const mockFetch = jest.fn();
(global as any).fetch = mockFetch;

// Import after mocks are set up so the module picks up the mocked fetch/db.
import { activateLicense } from '../../licenseManager';

describe('licenseManager.activateLicense', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        (getSetting as jest.Mock).mockReturnValue(null);
    });

    it('rejects a fake PRO_-prefixed key when the license server says invalid (regression: prefix alone must not be trusted)', async () => {
        mockFetch.mockResolvedValue({
            ok: true,
            status: 200,
            json: async () => ({ valid: false, error: 'Invalid or forged license key.' }),
        });

        const result = await activateLicense('PRO_FAKE_00000000_MADEUP');

        // The whole point of this test: a PRO_-shaped key still has to be
        // checked against the server. It must not be accepted on prefix alone.
        expect(mockFetch).toHaveBeenCalledTimes(1);
        const [url, opts] = mockFetch.mock.calls[0];
        expect(String(url)).toContain('/license/validate');
        expect(JSON.parse(opts.body).license_key).toBe('PRO_FAKE_00000000_MADEUP');

        expect(result.success).toBe(false);
        expect(updateSetting).not.toHaveBeenCalledWith('license_status', 'active');
    });

    it('activates a genuine PRO_ key once the license server confirms it is valid', async () => {
        mockFetch.mockResolvedValue({
            ok: true,
            status: 200,
            json: async () => ({ valid: true, valid_until: new Date(Date.now() + 86400000).toISOString(), tier: 'pro', message: 'License verified. Enjoy Pro features!' }),
        });

        const result = await activateLicense('PRO_RZP_A1B2C3D4_SUB123456');

        expect(result.success).toBe(true);
        expect(updateSetting).toHaveBeenCalledWith('license_key', 'PRO_RZP_A1B2C3D4_SUB123456');
        expect(updateSetting).toHaveBeenCalledWith('license_status', 'active');
    });

    it('rejects malformed keys before ever contacting the server', async () => {
        const result = await activateLicense('not-a-real-key');
        expect(result.success).toBe(false);
        expect(mockFetch).not.toHaveBeenCalled();
    });

    it('fails closed when the license server is unreachable', async () => {
        mockFetch.mockRejectedValue(new Error('ECONNREFUSED'));

        const result = await activateLicense('PRO_LS_A1B2C3D4_SUB123456');

        expect(result.success).toBe(false);
        expect(updateSetting).not.toHaveBeenCalledWith('license_status', 'active');
    });
});
