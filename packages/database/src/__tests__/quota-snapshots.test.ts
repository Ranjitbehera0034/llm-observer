import { initDb, getDb, getLatestSnapshots, insertRateLimitSnapshot } from '../index';

describe('Quota observation persistence', () => {
    beforeEach(() => { initDb(':memory:'); getDb().prepare('DELETE FROM rate_limit_snapshots').run(); });
    it('preserves freshness, small changes, and reset changes', () => {
        const base = { provider: 'test', window_type: '5h', total_allowed: null, total_used: null, utilization_pct: .5, resets_at: '2026-11-14T12:00:00Z', is_estimated: false, captured_at: '2026-11-14T10:00:00Z' };
        insertRateLimitSnapshot(base);
        insertRateLimitSnapshot({ ...base, captured_at: '2026-11-14T10:05:00Z' });
        expect(getLatestSnapshots('test')[0].captured_at).toBe('2026-11-14T10:05:00Z');
        insertRateLimitSnapshot({ ...base, utilization_pct: .51, resets_at: '2026-11-14T13:00:00Z', captured_at: '2026-11-14T10:10:00Z' });
        expect(getLatestSnapshots('test')[0]).toMatchObject({ utilization_pct: .51, resets_at: '2026-11-14T13:00:00Z' });
    });
    it('returns one deterministic latest snapshot when timestamps tie', () => {
        const base = { provider: 'test', window_type: '5h', total_allowed: null, total_used: null, utilization_pct: .5, resets_at: null, is_estimated: false, captured_at: '2026-11-14T10:00:00Z' };
        insertRateLimitSnapshot(base);
        insertRateLimitSnapshot({ ...base, utilization_pct: .6 });
        expect(getLatestSnapshots('test')).toHaveLength(1);
        expect(getLatestSnapshots('test')[0].utilization_pct).toBe(.6);
    });
});
