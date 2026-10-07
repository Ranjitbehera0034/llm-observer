// Runs the real SQL against an in-memory SQLite database seeded with ISO-format
// rows (as the proxy writes them), so timestamp-comparison bugs are caught.
jest.mock('@llm-observer/database', () => {
    const { createTestDb } = require('../helpers/testDb');
    const t = createTestDb();
    const alerts: any[] = [];
    return {
        getDb: () => t.database,
        bulkInsertRequests: t.bulkInsertRequests,
        createAlert: jest.fn((a: any) => { alerts.push(a); return 'alert-id'; }),
    };
});

import { _detectAnomalies } from '../../anomalyDetector';
import { getDb, createAlert, bulkInsertRequests } from '@llm-observer/database';

const HOUR = 60 * 60 * 1000;
// Four simulated days of hourly runs; the old text comparison misbehaves on the
// cutoff's calendar date, so most runs of the day were false positives.
const START = Date.parse('2026-10-03T00:30:00.000Z');

const iso = (ms: number) => new Date(ms).toISOString();
const seed = (cost: number, atMs: number) => (bulkInsertRequests as any)([{ cost_usd: cost, created_at: iso(atMs) }]);

describe('anomalyDetector (in-memory SQLite)', () => {
    let fetchMock: jest.Mock;

    beforeEach(() => {
        getDb().prepare('DELETE FROM requests').run();
        getDb().prepare('DELETE FROM projects WHERE id != ?').run('default');
        getDb().prepare('UPDATE projects SET webhook_url = NULL').run();
        (createAlert as jest.Mock).mockClear();
        fetchMock = jest.fn().mockResolvedValue({ ok: true });
        (global as any).fetch = fetchMock;
        jest.spyOn(console, 'log').mockImplementation(() => { });
    });

    afterEach(() => jest.restoreAllMocks());

    it('fires zero alerts for steady $1/hour traffic over 96 hourly runs', async () => {
        for (let h = 0; h < 96; h++) {
            const t = START + h * HOUR;
            seed(1, t);
            await _detectAnomalies(t + 30 * 60 * 1000);
        }
        expect(createAlert).not.toHaveBeenCalled();
    });

    it('ignores a spike that is older than the current hour but on the same calendar date', async () => {
        const now = Date.parse('2026-10-07T20:00:00.000Z');
        for (let h = 1; h <= 48; h++) seed(1, now - h * HOUR);
        seed(20, now - 5 * HOUR); // 5h ago, same UTC date as the one-hour cutoff
        await _detectAnomalies(now);
        expect(createAlert).not.toHaveBeenCalled();
    });

    it('fires on a real $20 spike in the current hour', async () => {
        const now = Date.parse('2026-10-07T20:00:00.000Z');
        for (let h = 1; h <= 48; h++) seed(1, now - h * HOUR - 10 * 60 * 1000);
        seed(20, now - 10 * 60 * 1000);
        await _detectAnomalies(now);
        expect(createAlert).toHaveBeenCalledTimes(1);
        expect(createAlert).toHaveBeenCalledWith(expect.objectContaining({ project_id: 'default', type: 'anomaly' }));
    });

    it('does not alert below the noise threshold', async () => {
        const now = Date.parse('2026-10-07T20:00:00.000Z');
        for (let h = 1; h <= 48; h++) seed(0.001, now - h * HOUR - 10 * 60 * 1000);
        seed(0.008, now - 10 * 60 * 1000);
        await _detectAnomalies(now);
        expect(createAlert).not.toHaveBeenCalled();
    });

    it('posts to the project webhook with an abort timeout', async () => {
        const now = Date.parse('2026-10-07T20:00:00.000Z');
        getDb().prepare('UPDATE projects SET webhook_url = ? WHERE id = ?').run('http://hook.test/x', 'default');
        for (let h = 1; h <= 48; h++) seed(1, now - h * HOUR - 10 * 60 * 1000);
        seed(20, now - 10 * 60 * 1000);
        await _detectAnomalies(now);
        expect(fetchMock).toHaveBeenCalledTimes(1);
        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toBe('http://hook.test/x');
        expect(init.signal).toBeInstanceOf(AbortSignal);
    });
});
