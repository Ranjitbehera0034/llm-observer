import fetch from 'node-fetch';
import { fetchAnthropicRateLimitsLive } from '../rate-limits/poller';
import { insertRateLimitSnapshot } from '@llm-observer/database';
import { parseClaudeCredential } from '../rate-limits/credentials';

jest.mock('node-fetch', () => jest.fn());
jest.mock('@llm-observer/database', () => ({ insertRateLimitSnapshot: jest.fn(), getRateLimitConfig: jest.fn(() => null) }));
const mockedFetch = fetch as unknown as jest.Mock;
const response = (data: unknown) => ({ ok: true, status: 200, json: async () => data });

describe('Claude OAuth quota adapter', () => {
    beforeEach(() => jest.clearAllMocks());
    it('converts percentages and preserves zero without inventing absolute allowances', async () => {
        mockedFetch.mockResolvedValueOnce(response({ five_hour: { utilization: 0, resets_at: null }, seven_day: { utilization: 25, resets_at: '2026-11-20T00:00:00Z' } }));
        await fetchAnthropicRateLimitsLive('test-mapping');
        expect(mockedFetch).toHaveBeenCalledWith('https://api.anthropic.com/api/oauth/usage', expect.objectContaining({ redirect: 'error', timeout: 15000 }));
        expect(insertRateLimitSnapshot).toHaveBeenCalledWith(expect.objectContaining({ window_type: '5h', utilization_pct: 0, total_allowed: null, total_used: null }));
        expect(insertRateLimitSnapshot).toHaveBeenCalledWith(expect.objectContaining({ window_type: '7d', utilization_pct: .25 }));
    });
    it('keeps valid siblings while rejecting nonnumeric percentages', async () => {
        mockedFetch.mockResolvedValueOnce(response({ five_hour: { utilization: '20' }, seven_day: null, seven_day_oauth_apps: { utilization: 10 }, seven_day_opus: { utilization: true } }));
        await fetchAnthropicRateLimitsLive('test-siblings');
        expect(insertRateLimitSnapshot).toHaveBeenCalledTimes(1);
        expect(insertRateLimitSnapshot).toHaveBeenCalledWith(expect.objectContaining({ window_type: '7d', utilization_pct: .1 }));
    });
    it.each([{}, { five_hour: null }, { five_hour: { utilization: 101 } }, { five_hour: { utilization: 10, resets_at: 'invalid' } }])('rejects missing or malformed measurements: %j', async data => {
        mockedFetch.mockResolvedValueOnce(response(data));
        await expect(fetchAnthropicRateLimitsLive('test-invalid')).rejects.toThrow('No supported');
        expect(insertRateLimitSnapshot).not.toHaveBeenCalled();
    });
    it('honors rate-limit cooldown without repeated fetches', async () => {
        mockedFetch.mockResolvedValueOnce({ ok: false, status: 429, headers: { get: () => '3600' } });
        await expect(fetchAnthropicRateLimitsLive('test-cooldown')).rejects.toThrow('429');
        await expect(fetchAnthropicRateLimitsLive('test-cooldown')).rejects.toThrow('cooling down');
        expect(mockedFetch).toHaveBeenCalledTimes(1);
    });
});

describe('Claude credential schema', () => {
    it('extracts the nested profile token', () => {
        expect(parseClaudeCredential(JSON.stringify({ claudeAiOauth: { accessToken: 'test-token', scopes: ['user:profile'], expiresAt: Date.now() + 60000 } }))).toBe('test-token');
    });
    it.each(['not json', '{}', '{"mcpOAuth":{"accessToken":"wrong"}}', '{"accessToken":"bad token"}', '{"accessToken":"expired","expiresAt":1}', '{"accessToken":"inference","scopes":["user:inference"]}'])('rejects unsupported credentials without returning raw JSON: %s', raw => {
        expect(parseClaudeCredential(raw)).toBeNull();
    });
});
