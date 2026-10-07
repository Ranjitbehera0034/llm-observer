import fs from 'fs';
import os from 'os';
import path from 'path';
import { initDb, getDb, closeDb } from '../index';
import { createProject, getProject, deleteProject } from '../repositories/projects.repo';
import { createBudgetLimit, getBudgetLimits, deleteBudgetLimit } from '../repositories/budgets.repo';

describe('Database Layer Repositories', () => {
    beforeAll(() => {
        closeDb();
        initDb(':memory:');
    });

    afterAll(() => {
        closeDb();
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
        // initDb(':memory:') returns the cached singleton, so reopen a real file twice instead.
        closeDb();
        const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'llmo-idem-')), 'data.db');
        const log = jest.spyOn(console, 'log').mockImplementation(() => {});
        try {
            const first = initDb(file);
            const count = () => (first.prepare('SELECT count(*) AS n FROM _schema_version_v2').get() as any).n;
            const applied = count();
            expect(applied).toBeGreaterThan(0);
            closeDb();
            const second = initDb(file);
            expect((second.prepare('SELECT count(*) AS n FROM _schema_version_v2').get() as any).n).toBe(applied);
        } finally {
            log.mockRestore();
            closeDb();
        }
    });
});
