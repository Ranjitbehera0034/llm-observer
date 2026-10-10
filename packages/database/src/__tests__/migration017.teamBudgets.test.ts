/**
 * Migration 017 (Team tier, part 2): budgets.source separates budgets the user made
 * ('local') from budgets reconciled from a team policy ('team'); settings track the
 * policy version.
 */
import Database from 'better-sqlite3';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { runMigrations, initDb, closeDb, getDb, createBudgetLimit, getBudgetLimits, deleteTeamBudgets } from '../index';

const REAL_MIGRATIONS = path.join(__dirname, '..', 'migrations');
const realFiles = () => fs.readdirSync(REAL_MIGRATIONS).filter(f => f.endsWith('.sql')).sort();

const dirWith = (files: string[]) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'llmo-m017-'));
    for (const f of files) fs.copyFileSync(path.join(REAL_MIGRATIONS, f), path.join(dir, f));
    return dir;
};

describe('017 budgets.source', () => {
    let silence: jest.SpyInstance[];
    beforeEach(() => {
        silence = [jest.spyOn(console, 'log').mockImplementation(() => {}), jest.spyOn(console, 'error').mockImplementation(() => {})];
    });
    afterEach(() => { closeDb(); silence.forEach(s => s.mockRestore()); });

    it('exists, and is applied after 016', () => {
        expect(realFiles().some(f => f.startsWith('017_'))).toBe(true);
    });

    it('upgrades a database that has budgets: existing rows become source=local, and the version setting starts at 0', () => {
        const db = new Database(':memory:');
        runMigrations(db, dirWith(realFiles().filter(f => f < '017')));
        db.prepare("INSERT INTO budgets (name, scope, period, limit_usd) VALUES ('mine', 'global', 'daily', 5)").run();

        runMigrations(db, REAL_MIGRATIONS);

        const row = db.prepare("SELECT name, source FROM budgets").get() as any;
        expect(row).toEqual({ name: 'mine', source: 'local' });
        expect((db.prepare("SELECT value FROM settings WHERE key = 'team_policy_version'").get() as any).value).toBe('0');
    });

    it('refuses an unknown source value', () => {
        const db = new Database(':memory:');
        runMigrations(db, REAL_MIGRATIONS);
        expect(() => db.prepare("INSERT INTO budgets (name, scope, period, limit_usd, source) VALUES ('x', 'global', 'daily', 5, 'cloud')").run()).toThrow();
    });

    it('createBudgetLimit defaults to local; deleteTeamBudgets removes only team rows and their alerts', () => {
        initDb(':memory:');
        const base = { scope: 'global' as const, period: 'daily' as const, limit_usd: 5, warning_pct_1: 0.8, warning_pct_2: 0.9, kill_switch: true, safety_buffer_usd: 0.05, estimate_multiplier: 3, is_active: true };
        const local = createBudgetLimit({ ...base, name: 'local one' });
        const team = createBudgetLimit({ ...base, name: 'team one', source: 'team' });
        getDb().prepare("INSERT INTO alerts (id, type, message, budget_id, period_start) VALUES ('a1', 'budget_exceeded', 'm', ?, 'p')").run(team);

        expect(getBudgetLimits().map(b => [b.name, b.source])).toEqual([['local one', 'local'], ['team one', 'team']]);
        expect(deleteTeamBudgets()).toBe(1);
        expect(getBudgetLimits().map(b => b.id)).toEqual([local]);
        expect(getDb().prepare('SELECT count(*) AS n FROM alerts WHERE budget_id = ?').get(team)).toEqual({ n: 0 });
        expect(deleteTeamBudgets()).toBe(0);
    });
});
