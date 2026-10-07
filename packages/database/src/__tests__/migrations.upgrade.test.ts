import Database from 'better-sqlite3';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { initDb, closeDb, runMigrations } from '../db';

const REAL_MIGRATIONS = path.join(__dirname, '..', 'migrations');
const realFiles = () => fs.readdirSync(REAL_MIGRATIONS).filter(f => f.endsWith('.sql')).sort();

const mkTmp = (prefix: string) => fs.mkdtempSync(path.join(os.tmpdir(), `llmo-${prefix}-`));

/** Copy a subset of the real migrations into a scratch directory. */
const migrationsDirWith = (files: string[], extra: Record<string, string> = {}) => {
    const dir = mkTmp('migs');
    for (const f of files) fs.copyFileSync(path.join(REAL_MIGRATIONS, f), path.join(dir, f));
    for (const [name, sql] of Object.entries(extra)) fs.writeFileSync(path.join(dir, name), sql);
    return dir;
};

const columns = (db: Database.Database, table: string) =>
    (db.prepare(`SELECT name FROM pragma_table_info('${table}')`).all() as { name: string }[]).map(c => c.name);

const versions = (db: Database.Database) =>
    (db.prepare('SELECT name FROM _schema_version_v2 ORDER BY name').all() as { name: string }[]).map(r => r.name);

const backupsIn = (dir: string) => fs.readdirSync(dir).filter(f => f.includes('.pre-migrate-') && f.endsWith('.bak')).sort();

describe('migration runner', () => {
    let silence: jest.SpyInstance[];
    const envBefore = { ...process.env };

    beforeEach(() => {
        silence = [jest.spyOn(console, 'log').mockImplementation(() => {}), jest.spyOn(console, 'error').mockImplementation(() => {})];
    });
    afterEach(() => {
        closeDb();
        silence.forEach(s => s.mockRestore());
        process.env = { ...envBefore };
    });

    it('rolls a failing migration back completely so the next run retries cleanly', () => {
        const all = realFiles();
        const upTo002 = all.filter(f => f < '003');
        // Fails after its first statements have already altered the schema.
        const broken = `ALTER TABLE alerts ADD COLUMN scratch_col INTEGER;\nINSERT INTO no_such_table VALUES (1);`;
        const failingDir = migrationsDirWith(upTo002, { '003_broken.sql': broken });

        const dbFile = path.join(mkTmp('fail'), 'data.db');
        const db = new Database(dbFile);
        expect(() => runMigrations(db, failingDir)).toThrow(/003_broken\.sql failed and was rolled back/);

        // Schema unchanged, version row absent.
        expect(columns(db, 'alerts')).not.toContain('scratch_col');
        expect(versions(db)).toEqual(upTo002);
        expect(db.inTransaction).toBe(false);

        // The fixed migration (same name) now applies on the retry.
        fs.writeFileSync(path.join(failingDir, '003_broken.sql'), 'ALTER TABLE alerts ADD COLUMN scratch_col INTEGER;');
        expect(runMigrations(db, failingDir)).toEqual(['003_broken.sql']);
        expect(columns(db, 'alerts')).toContain('scratch_col');
        db.close();
    });

    it('does not apply a migration another process already recorded', () => {
        const dir = migrationsDirWith(realFiles().filter(f => f < '003'));
        const db = new Database(path.join(mkTmp('race'), 'data.db'));
        runMigrations(db, dir);
        // Simulate a lost race: file is on disk and in pending, but the row exists once the lock is held.
        const racing = migrationsDirWith(realFiles().filter(f => f < '003'), { '099_once.sql': 'CREATE TABLE once_only (x INTEGER);' });
        const real = db.prepare.bind(db);
        let sawCheck = false;
        jest.spyOn(db, 'prepare').mockImplementation(((sql: string) => {
            const stmt = real(sql);
            if (sql.startsWith('SELECT 1 FROM _schema_version_v2') && !sawCheck) {
                sawCheck = true;
                const origGet = stmt.get.bind(stmt);
                let calls = 0;
                (stmt as any).get = (...args: any[]) => {
                    if (args[0] === '099_once.sql') calls++;
                    // First lookup (pending scan) says not applied; before the locked re-check, "another process" commits it.
                    if (calls === 2 && args[0] === '099_once.sql') {
                        db.exec('CREATE TABLE once_only (x INTEGER)');
                        db.prepare('INSERT INTO _schema_version_v2 (name) VALUES (?)').run('099_once.sql');
                    }
                    return origGet(...args);
                };
            }
            return stmt;
        }) as any);
        expect(runMigrations(db, racing)).toEqual([]); // skipped, not re-applied
        expect(versions(db)).toContain('099_once.sql');
        db.close();
    });

    it('throws when the migrations directory is missing', () => {
        const missing = path.join(mkTmp('missing'), 'nope');
        const db = new Database(':memory:');
        expect(() => runMigrations(db, missing)).toThrow(/Migrations directory not found/);
        db.close();
    });

    it('upgrades a file-backed database seeded at the previous schema and leaves a valid backup', () => {
        const all = realFiles();
        const last = all[all.length - 1];
        const previous = all.filter(f => f !== last);
        const dataDir = mkTmp('upgrade');
        const dbFile = path.join(dataDir, 'data.db');

        // Seed at schema N-1 with real rows.
        const seed = new Database(dbFile);
        runMigrations(seed, migrationsDirWith(previous));
        seed.exec("INSERT INTO organizations (id, name) VALUES ('default', 'Default Organization')");
        seed.exec("INSERT INTO projects (id, name, daily_budget) VALUES ('p1', 'Seeded', 5)");
        expect(versions(seed)).toEqual(previous);
        expect(backupsIn(dataDir)).toEqual([]); // fresh DB: nothing to back up
        seed.close();

        // Boot the real runner against it.
        process.env.LLM_OBSERVER_DATA_DIR = dataDir;
        const db = initDb(dbFile);
        expect(versions(db)).toEqual(all);
        expect(db.prepare("SELECT name FROM projects WHERE id = 'p1'").get()).toEqual({ name: 'Seeded' });

        const backups = backupsIn(dataDir);
        expect(backups).toHaveLength(1);
        const backup = new Database(path.join(dataDir, backups[0]), { readonly: true });
        expect(backup.pragma('integrity_check', { simple: true })).toBe('ok');
        expect(versions(backup)).toEqual(previous); // snapshot taken before the pending migration
        expect(backup.prepare("SELECT name FROM projects WHERE id = 'p1'").get()).toEqual({ name: 'Seeded' });
        backup.close();
    });

    it('is a no-op (no backup, no changes) on a database that already has every migration', () => {
        const dataDir = mkTmp('current');
        const dbFile = path.join(dataDir, 'data.db');
        closeDb();
        initDb(dbFile); // fresh database: applies 000..latest, nothing to back up
        expect(backupsIn(dataDir)).toEqual([]);
        closeDb();

        const db = initDb(dbFile);
        expect(versions(db)).toEqual(realFiles());
        expect(backupsIn(dataDir)).toEqual([]);
    });

    it('keeps only the two newest pre-migration backups', () => {
        const all = realFiles();
        const dataDir = mkTmp('prune');
        const dbFile = path.join(dataDir, 'data.db');
        const db = new Database(dbFile);
        runMigrations(db, migrationsDirWith(all.slice(0, 2)));
        for (let i = 0; i < 4; i++) {
            runMigrations(db, migrationsDirWith(all.slice(0, 2), { [`10${i}_x.sql`]: `CREATE TABLE x${i} (a INTEGER);` }));
        }
        expect(backupsIn(dataDir)).toHaveLength(2);
        db.close();
    });

    it('rejects a failed initDb without caching a half-initialised handle', () => {
        // Point at a directory that is a file so Database() itself fails, then recover.
        const dir = mkTmp('init');
        const bad = path.join(dir, 'blocked');
        fs.writeFileSync(bad, 'x');
        expect(() => initDb(path.join(bad, 'data.db'))).toThrow();
        const db = initDb(path.join(dir, 'ok.db'));
        expect(versions(db)).toEqual(realFiles());
    });

    describe('legacy database probing', () => {
        const makeForeignDb = (file: string) => {
            const f = new Database(file);
            f.exec('CREATE TABLE foreign_stuff (x TEXT)');
            for (let i = 0; i < 3000; i++) f.prepare('INSERT INTO foreign_stuff VALUES (?)').run('x'.repeat(100));
            f.close();
        };

        it('never reads or moves a data.db in the current working directory', () => {
            const cwdDir = mkTmp('cwd');
            const foreign = path.join(cwdDir, 'data.db');
            makeForeignDb(foreign);
            const before = fs.readFileSync(foreign);

            const dataDir = mkTmp('data');
            process.env.LLM_OBSERVER_DATA_DIR = dataDir;
            const spy = jest.spyOn(process, 'cwd').mockReturnValue(cwdDir);
            try {
                const db = initDb();
                expect(db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name = 'foreign_stuff'").get()).toEqual({ n: 0 });
            } finally {
                spy.mockRestore();
            }
            expect(fs.existsSync(foreign)).toBe(true);
            expect(fs.existsSync(`${foreign}.legacy.bak`)).toBe(false);
            expect(fs.readFileSync(foreign).equals(before)).toBe(true);
        });
    });
});
