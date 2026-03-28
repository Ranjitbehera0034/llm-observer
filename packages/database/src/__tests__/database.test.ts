import { initDb, getDb } from '../index';
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

    it('verifies migration idempotency', () => {
        // Run initDb again should not fail
        expect(() => initDb(':memory:')).not.toThrow();
    });
});
