import { initDb, getDb } from '../index';
import { bulkInsertRequests } from '../repositories/requests.repo';

const rec = (over: Record<string, any> = {}) => ({
    project_id: 'default', provider: 'openai', model: 'gpt-4', cost_usd: 0.01, ...over,
}) as any;

describe('bulkInsertRequests', () => {
    beforeAll(() => {
        initDb(':memory:').prepare("INSERT OR IGNORE INTO projects (id, name) VALUES ('default', 'Default Project')").run();
    });
    beforeEach(() => { getDb().prepare('DELETE FROM requests').run(); });

    it('stores the id the caller supplied', () => {
        bulkInsertRequests([rec({ id: 'req-fixed-1' }), rec({ id: 'req-fixed-2' })]);
        const ids = (getDb().prepare('SELECT id FROM requests ORDER BY id').all() as any[]).map(r => r.id);
        expect(ids).toEqual(['req-fixed-1', 'req-fixed-2']);
    });

    it('still generates an id for records that have none', () => {
        bulkInsertRequests([rec(), rec({ id: 'req-fixed-3' })]);
        const ids = (getDb().prepare('SELECT id FROM requests').all() as any[]).map(r => r.id);
        expect(ids).toHaveLength(2);
        expect(ids).toContain('req-fixed-3');
        const generated = ids.find(i => i !== 'req-fixed-3');
        expect(generated).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-/);
    });
});
