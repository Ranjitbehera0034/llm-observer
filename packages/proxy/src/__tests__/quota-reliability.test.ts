import { pollRateLimits } from '../rate-limits/poller';
import { cleanupOldSnapshots, getDb, insertRateLimitSnapshot, getLatestSnapshots } from '@llm-observer/database';
import express from 'express';
import request from 'supertest';
import limitsRoutes from '../routes/limits.routes';

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
    });
    afterEach(() => jest.restoreAllMocks());
    it('refreshes other providers after cleanup failure using local activity only', async () => {
        (cleanupOldSnapshots as jest.Mock).mockImplementationOnce(() => { throw new Error('cleanup'); });
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
    it('keeps quota estimates local on repeated polls', async () => {
        await pollRateLimits();
        await pollRateLimits();
        expect(insertRateLimitSnapshot).toHaveBeenCalledWith(expect.objectContaining({ provider: 'anthropic', is_estimated: true }));
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
