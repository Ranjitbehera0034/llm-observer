import crypto from 'crypto';

const settings = new Map<string, string>();
jest.mock('@llm-observer/database', () => ({
    getDb: jest.fn(),
    getSetting: (k: string) => settings.get(k) ?? null,
    updateSetting: (k: string, v: string) => { settings.set(k, v); },
}));

import { activateLicense, getLicenseInfo, revalidateLicense, licenseServerUrl } from '../../licenseManager';
import { __setLicensePublicKeyForTests } from '../../licenseKeys';
import { buildPing, sendPingIfDue, setTelemetryOptIn } from '../../telemetry';

const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
__setLicensePublicKeyForTests(publicKey.export({ type: 'spki', format: 'pem' }).toString());

function sign(sub: string, key: crypto.KeyObject = privateKey): string {
    const body = Buffer.from(JSON.stringify({ v: 1, sub, plan: 'pro', iat: 1 })).toString('base64url');
    const sig = crypto.sign(null, Buffer.from(`LLMO1.${body}`), key).toString('base64url');
    return `LLMO1.${body}.${sig}`;
}

const reply = (status: number, body: object) => Promise.resolve(new Response(JSON.stringify(body), { status }));
let fetchMock: jest.Mock;

beforeEach(() => {
    settings.clear();
    fetchMock = jest.fn(() => reply(200, { valid: true }));
    (global as any).fetch = fetchMock;
    delete process.env.LLM_OBSERVER_DEV_LICENSE;
});

describe('activateLicense', () => {
    it('rejects made-up PRO_ keys (the old bypass)', async () => {
        for (const key of ['PRO_anything', 'PRO_TEST_KEY_123', 'sk_live_123']) {
            const res = await activateLicense(key);
            expect(res.success).toBe(false);
        }
        expect((await getLicenseInfo(true)).isPro).toBe(false);
    });

    it('accepts PRO_ keys only in explicit dev mode', async () => {
        process.env.LLM_OBSERVER_DEV_LICENSE = '1';
        expect((await activateLicense('PRO_TEST_KEY_123')).success).toBe(true);
        expect((await getLicenseInfo(true)).isPro).toBe(true);
    });

    it('activates a genuinely signed key and reports the device to the server', async () => {
        const key = sign('ls:1');
        expect((await activateLicense(key)).success).toBe(true);
        expect((await getLicenseInfo(true)).isPro).toBe(true);
        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toBe(`${licenseServerUrl()}/license/validate`);
        expect(JSON.parse(init.body)).toMatchObject({ license_key: key, version: expect.any(String), machine_id: expect.any(String) });
    });

    it('activates a signed key even when the license server is unreachable', async () => {
        fetchMock.mockImplementation(() => Promise.reject(new Error('ENOTFOUND')));
        expect((await activateLicense(sign('ls:2'))).success).toBe(true);
    });

    it('rejects a key signed by anyone else', async () => {
        const forger = crypto.generateKeyPairSync('ed25519').privateKey;
        expect((await activateLicense(sign('ls:3', forger))).success).toBe(false);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('refuses a signed key whose subscription the server says has ended', async () => {
        fetchMock.mockImplementation(() => reply(403, { valid: false, revoked: true, error: 'This subscription has ended.' }));
        const res = await activateLicense(sign('ls:4'));
        expect(res).toEqual({ success: false, message: 'This subscription has ended.' });
    });

    it('verifies legacy PRO_LS_ keys with the server', async () => {
        fetchMock.mockImplementation(() => reply(400, { valid: false, error: 'Invalid or forged license key.' }));
        expect((await activateLicense('PRO_LS_ABCD1234_SUB1')).success).toBe(false);
        fetchMock.mockImplementation(() => reply(200, { valid: true }));
        expect((await activateLicense('PRO_LS_ABCD1234_SUB1')).success).toBe(true);
    });

    it('does not treat a database-edited signed key as Pro', async () => {
        await activateLicense(sign('ls:5'));
        const [p, , sig] = settings.get('license_key')!.split('.');
        settings.set('license_key', `${p}.${Buffer.from('{"v":1,"sub":"x","plan":"pro","iat":1}').toString('base64url')}.${sig}`);
        expect((await getLicenseInfo(true)).isPro).toBe(false);
    });
});

describe('revalidateLicense', () => {
    it('drops to Free when the server says the subscription ended', async () => {
        await activateLicense(sign('ls:6'));
        fetchMock.mockImplementation(() => reply(403, { valid: false, revoked: true }));
        await revalidateLicense(true);
        expect((await getLicenseInfo(true)).isPro).toBe(false);
    });

    it('never downgrades because of a network failure', async () => {
        await activateLicense(sign('ls:7'));
        fetchMock.mockImplementation(() => Promise.reject(new Error('offline')));
        await revalidateLicense(true);
        expect((await getLicenseInfo(true)).isPro).toBe(true);
    });

    it('checks at most once a day', async () => {
        await activateLicense(sign('ls:8'));
        fetchMock.mockClear();
        await revalidateLicense();
        expect(fetchMock).not.toHaveBeenCalled();
    });
});

describe('telemetry', () => {
    it('sends nothing unless the user opted in', async () => {
        expect(await sendPingIfDue()).toBe(false);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('sends only install_id, version, os and tier once opted in', async () => {
        fetchMock.mockImplementation(() => Promise.resolve(new Response(null, { status: 204 })));
        setTelemetryOptIn(true);
        await new Promise(r => setImmediate(r));
        const body = JSON.parse(fetchMock.mock.calls[0][1].body);
        expect(Object.keys(body).sort()).toEqual(['install_id', 'os', 'tier', 'version']);
        expect(body.install_id).toMatch(/^[0-9a-f-]{36}$/);
        expect(body.tier).toBe('free');
        // already sent today
        expect(await sendPingIfDue()).toBe(false);
    });

    it('opting out forgets the install id', async () => {
        setTelemetryOptIn(true);
        await buildPing();
        setTelemetryOptIn(false);
        expect(settings.get('telemetry_install_id')).toBe('');
        expect(await sendPingIfDue()).toBe(false);
    });
});
