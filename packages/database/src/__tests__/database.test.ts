import { initDb, getDb, insertSession, getSessionSummary } from '../index';
import { createProject, getProject, deleteProject } from '../repositories/projects.repo';
import { createBudgetLimit, getBudgetLimits, deleteBudgetLimit } from '../repositories/budgets.repo';

describe('Database Layer Repositories', () => {
    beforeAll(() => {
        initDb(':memory:');
    });

    describe('Projects', () => {
        it('creates and retrieves projects', () => {
            const id = createProject({
                name: 'Test Project',
                daily_budget: 10.0
            });

            const project = getProject(id);
            expect(project).toBeDefined();
            expect(project?.name).toBe('Test Project');
            
            deleteProject(id);
        });
    });

    describe('Budgets', () => {
        it('creates and retrieves budget limits', () => {
            const id = createBudgetLimit({
                name: 'Monthly Cap',
                scope: 'global',
                period: 'monthly',
                limit_usd: 500,
                warning_pct_1: 0.5,
                warning_pct_2: 0.8,
                kill_switch: true,
                safety_buffer_usd: 10,
                estimate_multiplier: 1.2,
                is_active: true
            });

            const budgets = getBudgetLimits();
            expect(budgets.find(b => b.name === 'Monthly Cap')).toBeDefined();
            
            deleteBudgetLimit(id);
        });
    });

    it('preserves unpriced sessions without confusing them with free usage', () => {
        insertSession({ provider: 'test', session_id: 'unpriced', started_at: '2026-01-01T00:00:00Z', estimated_cost_usd: null });
        insertSession({ provider: 'test', session_id: 'free', started_at: '2026-01-01T00:00:00Z', estimated_cost_usd: 0 });
        insertSession({ provider: 'test', session_id: 'paid', started_at: '2026-01-01T00:00:00Z', estimated_cost_usd: 2, parent_cost_usd: 1 });
        const rows = getDb().prepare('SELECT session_id, estimated_cost_usd, parent_cost_usd FROM sessions ORDER BY session_id').all();
        expect(rows).toEqual([
            { session_id: 'free', estimated_cost_usd: 0, parent_cost_usd: 0 },
            { session_id: 'paid', estimated_cost_usd: 2, parent_cost_usd: 1 },
            { session_id: 'unpriced', estimated_cost_usd: null, parent_cost_usd: null }
        ]);
        expect(getSessionSummary()).toMatchObject({ total_cost: 2, unpriced_sessions: 1, total_sessions: 3 });
    });

    it('verifies migration idempotency', () => {
        // Run initDb again should not fail
        expect(() => initDb(':memory:')).not.toThrow();
    });
});
