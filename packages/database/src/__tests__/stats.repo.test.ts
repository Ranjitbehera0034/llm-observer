import { initDb, getDb } from '../index';
import { getCostOptimizationSuggestions } from '../repositories/stats.repo';

const DAY = 86400_000;
const iso = (msAgo: number) => new Date(Date.now() - msAgo).toISOString();

describe('Rule W2 weekly window', () => {
    beforeAll(() => { initDb(':memory:'); });
    beforeEach(() => { getDb().prepare('DELETE FROM sessions').run(); });

    const addSession = (id: string, startedAt: string, cost: number) =>
        getDb().prepare("INSERT INTO sessions (provider, session_id, started_at, estimated_cost_usd) VALUES ('claude-code', ?, ?, ?)").run(id, startedAt, cost);
    const offPeak = () => getCostOptimizationSuggestions('default').filter((s: any) => s.type === 'off_peak_routing');

    it('uses sessions from the last 7 days', () => {
        addSession('recent', iso(6 * DAY), 20);
        expect(offPeak()).toHaveLength(1);
    });

    it('ignores an ISO-timestamped session just past the 7-day cutoff', () => {
        addSession('stale', iso(7 * DAY + 60_000), 20);
        expect(offPeak()).toHaveLength(0);
    });
});
