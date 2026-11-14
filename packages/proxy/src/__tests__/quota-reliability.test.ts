import { pollRateLimits } from '../rate-limits/poller';
import { readClaudeOAuth } from '../rate-limits/credentials';
import { cleanupOldSnapshots, getDb, insertRateLimitSnapshot, getLatestSnapshots } from '@llm-observer/database';
import express from 'express';
import request from 'supertest';
import limitsRoutes from '../routes/limits.routes';

jest.mock('../rate-limits/credentials', () => ({ readClaudeOAuth: jest.fn() }));
jest.mock('@llm-observer/database', () => ({
    cleanupOldSnapshots: jest.fn(), insertRateLimitSnapshot: jest.fn(), getLatestSnapshots: jest.fn(),
    getDb: jest.fn(() => ({ prepare: () => ({ get: () => ({ count: 2 }) }) }))
}));
const app = express();
app.use('/limits', limitsRoutes);

describe('Quota failure isolation and freshness', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        jest.spyOn(console, 'error').mockImplementation(() => {});
        (readClaudeOAuth as jest.Mock).mockResolvedValue(null);
    });
    afterEach(() => jest.restoreAllMocks());
    it('refreshes other providers after credential and cleanup failures', async () => {
        (cleanupOldSnapshots as jest.Mock).mockImplementationOnce(() => { throw new Error('cleanup'); });
        (readClaudeOAuth as jest.Mock).mockRejectedValueOnce(new Error('credential unavailable'));
        await pollRateLimits();
        for (const provider of ['cursor', 'openai', 'aider']) {
            expect(insertRateLimitSnapshot).toHaveBeenCalledWith(expect.objectContaining({ provider, window_type: 'activity_daily' }));
        }
        expect(insertRateLimitSnapshot).toHaveBeenCalledWith(expect.objectContaining({ provider: 'anthropic', window_type: 'activity_5h', utilization_pct: null }));
    });
    it('refreshes later providers after an individual activity query fails', async () => {
        (getDb as jest.Mock).mockImplementationOnce(() => { throw new Error('anthropic db'); });
        await pollRateLimits();
        expect(insertRateLimitSnapshot).toHaveBeenCalledWith(expect.objectContaining({ provider: 'aider' }));
    });
    it('does not overlap polls and releases its guard when the poll finishes', async () => {
        let release!: (value: null) => void;
        (readClaudeOAuth as jest.Mock).mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
        const first = pollRateLimits();
        await pollRateLimits();
        expect(readClaudeOAuth).toHaveBeenCalledTimes(1);
        release(null);
        await first;
        await pollRateLimits();
        expect(readClaudeOAuth).toHaveBeenCalledTimes(2);
    });
    it('labels stale quota separately from fresh activity on the same provider', async () => {
        const now = new Date().toISOString();
        (getLatestSnapshots as jest.Mock).mockImplementation(provider => provider === 'anthropic' ? [
            { window_type: '5h', captured_at: '2020-01-01T00:00:00Z', resets_at: null, utilization_pct: .9, is_estimated: false },
            { window_type: 'activity_5h', captured_at: now, resets_at: null, utilization_pct: null, is_estimated: true }
        ] : []);
        const res = await request(app).get('/limits');
        const provider = res.body.providers[0];
        expect(provider.source).toBe('mixed');
        expect(provider.last_updated).toBe(now);
        expect(provider.windows[0]).toMatchObject({ stale: true, status: 'stale', source: 'oauth_api' });
        expect(provider.windows[1]).toMatchObject({ stale: false, status: 'monitoring', source: 'session_count', label: 'Sessions in Last 5 Hours' });
    });
});
