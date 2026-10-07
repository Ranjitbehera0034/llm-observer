import { initDb, getDb } from '../index';
import { insertSession, getSessionById, updateSessionTotals } from '../repositories/sessions.repo';

const base = (session_id: string) => ({
    provider: 'claude-code',
    session_id,
    started_at: '2026-07-01T10:00:00.000Z',
    estimated_cost_usd: 1,
});

describe('sessions repository', () => {
    beforeAll(() => {
        initDb(':memory:');
    });

    beforeEach(() => {
        getDb().prepare('DELETE FROM sessions').run();
    });

    it('returns the true row id when re-upserting an existing session (two-session test)', () => {
        const idA = insertSession(base('a'));
        const idB = insertSession(base('b'));
        expect(idB).not.toBe(idA);

        // Re-upsert A after B exists: lastInsertRowid would report B's id here.
        const idAAgain = insertSession({ ...base('a'), estimated_cost_usd: 2 });
        expect(idAAgain).toBe(idA);
        expect((getSessionById(idAAgain) as any).session_id).toBe('a');
        expect((getSessionById(idAAgain) as any).estimated_cost_usd).toBe(2);
    });

    it('persists tool, is_estimated and cost_source', () => {
        const id = insertSession({
            ...base('c'),
            tool: 'Claude Code',
            is_estimated: true,
            cost_source: 'family_fallback',
        });
        const row = getSessionById(id) as any;
        expect(row.tool).toBe('Claude Code');
        expect(row.is_estimated).toBe(1);
        expect(row.cost_source).toBe('family_fallback');
    });

    it('accepts the numeric is_estimated flag other parsers pass', () => {
        const id = insertSession({ ...base('d'), is_estimated: 1 } as any);
        expect((getSessionById(id) as any).is_estimated).toBe(1);
    });

    it('updateSessionTotals marks the parent estimated when a subagent is estimated', () => {
        const id = insertSession({ ...base('e'), cost_source: 'pricing_table', parent_cost_usd: 1 });
        getDb().prepare(`INSERT INTO subagents (parent_session_id, agent_id, started_at, estimated_cost_usd, is_estimated, cost_source)
            VALUES (?, 'x', '2026-07-01T10:00:00.000Z', 0.5, 1, 'family_fallback')`).run(id);
        updateSessionTotals(id, 0.5, 1);
        const row = getSessionById(id) as any;
        expect(row.is_estimated).toBe(1);
        expect(row.cost_source).toBe('family_fallback');
        expect(row.estimated_cost_usd).toBeCloseTo(1.5);
    });
});
