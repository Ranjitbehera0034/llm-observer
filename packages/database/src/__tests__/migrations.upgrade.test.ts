import Database from 'better-sqlite3';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { initDb, closeDb, runMigrations, migrateLegacyDb, removeDatabaseFiles, pruneMigrationBackups } from '../db';

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

describe('016_alerts_minimise', () => {
    it('rewrites existing alert rows to metadata only and leaves other alerts alone', () => {
        const before = realFiles().filter(f => f < '016');
        const db = new Database(':memory:');
        runMigrations(db, migrationsDirWith(before));
        db.exec("INSERT OR IGNORE INTO organizations (id, name) VALUES ('default', 'Default Organization'); INSERT OR IGNORE INTO projects (id, name) VALUES ('default', 'Default Project')");

        const full = {
            id: 'req-1', project_id: 'default', provider: 'openai', model: 'gpt-4', cost_usd: 1.5, latency_ms: 800,
            status: 'error', status_code: 500, request_body: '{"messages":"SECRET PROMPT"}', response_body: 'SECRET ANSWER',
        };
        const ins = db.prepare("INSERT INTO alerts (id, project_id, type, message, data) VALUES (?, 'default', ?, 'm', ?)");
        ins.run('a1', 'latency_spike', JSON.stringify(full));
        ins.run('a2', 'response_drift', JSON.stringify({ provider: 'openai', model: 'gpt-4', driftScore: 3 }));
        ins.run('a3', 'latency_spike', 'not json {request_body');
        ins.run('a4', 'latency_spike', null);

        runMigrations(db, REAL_MIGRATIONS);

        const row = (id: string) => (db.prepare('SELECT data FROM alerts WHERE id = ?').get(id) as any).data as string;
        expect(JSON.parse(row('a1'))).toEqual({ request_id: 'req-1', project_id: 'default', model: 'gpt-4', status: 'error', cost_usd: 1.5, latency_ms: 800 });
        expect(row('a1')).not.toMatch(/SECRET|request_body|response_body/);
        expect(JSON.parse(row('a2'))).toEqual({ provider: 'openai', model: 'gpt-4', driftScore: 3 });
        expect(row('a3')).toBe('not json {request_body');
        expect(row('a4')).toBeNull();
    });
});


describe('pre-migration backups', () => {
    let silence: jest.SpyInstance[];
    const envBefore = { ...process.env };
    const DAY = 24 * 60 * 60 * 1000;

    beforeEach(() => {
        silence = [jest.spyOn(console, 'log').mockImplementation(() => {}), jest.spyOn(console, 'error').mockImplementation(() => {})];
    });
    afterEach(() => {
        closeDb();
        jest.restoreAllMocks();
        silence.forEach(s => s.mockRestore());
        process.env = { ...envBefore };
    });

    /** A file database seeded with migrations up to (not including) 003, plus a marker row. */
    const seededDb = () => {
        const all = realFiles();
        const base = all.filter(f => f < '003');
        const dataDir = mkTmp('bak');
        const dbFile = path.join(dataDir, 'data.db');
        const db = new Database(dbFile);
        runMigrations(db, migrationsDirWith(base));
        return { db, dataDir, dbFile, base };
    };
    const nextMigration = (base: string[], sql = 'CREATE TABLE next_one (a INTEGER);') => migrationsDirWith(base, { '003_next.sql': sql });

    const fakeBackup = (dir: string, name: string, ageMs: number, content = 'old') => {
        const f = path.join(dir, name);
        fs.writeFileSync(f, content);
        const t = new Date(Date.now() - ageMs);
        fs.utimesSync(f, t, t);
        return f;
    };

    it('writes the backup under a temporary name, removes the partial file and explains a failure', () => {
        const { db, dataDir, base } = seededDb();
        const realExec = Database.prototype.exec;
        jest.spyOn(Database.prototype, 'exec').mockImplementation(function (this: Database.Database, sql: string) {
            const m = /^VACUUM INTO '(.*)'$/.exec(sql);
            if (m) {
                fs.writeFileSync(m[1].replace(/''/g, "'"), 'partial'); // half-written copy, then the disk fills up
                throw new Error('database or disk is full');
            }
            return realExec.call(this, sql);
        });
        let message = '';
        try { runMigrations(db, nextMigration(base)); } catch (e: any) { message = e.message; }
        (Database.prototype.exec as unknown as jest.SpyInstance).mockRestore();

        expect(message).toMatch(/back up the database/i);
        expect(message).toMatch(/free space/i);
        expect(message).toMatch(/LLM_OBSERVER_SKIP_MIGRATION_BACKUP=1/);
        expect(message).toMatch(/database or disk is full/);
        expect(fs.readdirSync(dataDir).filter(f => f.includes('pre-migrate'))).toEqual([]);
        expect(versions(db)).toEqual(base); // nothing was applied
        db.close();
    });

    it('LLM_OBSERVER_SKIP_MIGRATION_BACKUP=1 upgrades without taking a backup', () => {
        const { db, dataDir, base } = seededDb();
        process.env.LLM_OBSERVER_SKIP_MIGRATION_BACKUP = '1';
        expect(runMigrations(db, nextMigration(base))).toEqual(['003_next.sql']);
        expect(fs.readdirSync(dataDir).filter(f => f.includes('pre-migrate'))).toEqual([]);
        db.close();
    });

    it('records the starting schema version in the name and keeps one backup per starting version', () => {
        const { db, dataDir, base } = seededDb();
        const failing = nextMigration(base, 'CREATE TABLE half (a INTEGER); INSERT INTO no_such_table VALUES (1);');
        expect(() => runMigrations(db, failing)).toThrow(/003_next\.sql failed/);
        const first = backupsIn(dataDir);
        expect(first).toHaveLength(1);
        expect(first[0]).toMatch(/^data\.db\.pre-migrate-v002-\d{8}T\d+Z\.bak$/);
        const original = fs.readFileSync(path.join(dataDir, first[0]));

        // A supervisor restarting the failing upgrade must not replace or add to it.
        for (let i = 0; i < 4; i++) expect(() => runMigrations(db, failing)).toThrow(/003_next\.sql failed/);
        expect(backupsIn(dataDir)).toEqual(first);
        expect(fs.readFileSync(path.join(dataDir, first[0])).equals(original)).toBe(true);
        db.close();
    });

    it('does not reuse a same-version backup older than 14 days: takes a fresh one that survives the prune', () => {
        const { db, dataDir, base } = seededDb();
        const aged = fakeBackup(dataDir, 'data.db.pre-migrate-v002-20200101T000000000Z.bak', 20 * DAY);
        runMigrations(db, nextMigration(base));
        expect(fs.existsSync(aged)).toBe(false);
        const left = backupsIn(dataDir);
        expect(left).toHaveLength(1);
        expect(left[0]).toMatch(/^data\.db\.pre-migrate-v002-/);
        expect(left[0]).not.toContain('20200101');
        // a real copy of the pre-migration database, not the stale fake
        const copy = new Database(path.join(dataDir, left[0]), { readonly: true });
        expect(versions(copy)).toEqual(base);
        copy.close();
        db.close();
    });

    it('never prunes the backup it is protecting the running upgrade with', () => {
        const { db, dataDir, base } = seededDb();
        // The in-use backup is a recent same-version one, but three newer backups of other versions exist.
        const inUse = fakeBackup(dataDir, 'data.db.pre-migrate-v002-20260101T000000000Z.bak', 2 * DAY);
        for (const v of ['v003', 'v004', 'v005']) fakeBackup(dataDir, `data.db.pre-migrate-${v}-2026020${v.slice(-1)}T000000000Z.bak`, DAY);
        runMigrations(db, nextMigration(base));
        expect(fs.existsSync(inUse)).toBe(true);
        db.close();
    });

    it('the failed-upgrade error names the backup that is still on disk', () => {
        const { db, dataDir, base } = seededDb();
        const failing = nextMigration(base, 'INSERT INTO no_such_table VALUES (1);');
        let message = '';
        for (let i = 0; i < 3; i++) {
            try { runMigrations(db, failing); } catch (e: any) { message = e.message; }
        }
        expect(message).toContain(path.join(dataDir, backupsIn(dataDir)[0]));
        db.close();
    });

    it('creates the backup owner-only (0600)', () => {
        if (process.platform === 'win32') return;
        const { db, dataDir, base } = seededDb();
        const prevUmask = process.umask(0o022);
        try {
            runMigrations(db, nextMigration(base));
        } finally { process.umask(prevUmask); }
        const [name] = backupsIn(dataDir);
        expect(fs.statSync(path.join(dataDir, name)).mode & 0o777).toBe(0o600);
        db.close();
    });

    it('deletes backups older than 14 days even when they are among the newest two', () => {
        const { db, dataDir, base } = seededDb();
        const old = fakeBackup(dataDir, 'data.db.pre-migrate-v001-20200101T000000000Z.bak', 15 * DAY);
        const recent = fakeBackup(dataDir, 'data.db.pre-migrate-v001-20260101T000000000Z.bak', 2 * DAY);
        runMigrations(db, nextMigration(base));
        expect(fs.existsSync(old)).toBe(false);
        expect(fs.existsSync(recent)).toBe(true);
        expect(backupsIn(dataDir)).toHaveLength(2); // recent + the new one
        db.close();
    });

    it('expires old backups on a boot with nothing to migrate', () => {
        const dataDir = mkTmp('expire');
        const dbFile = path.join(dataDir, 'data.db');
        initDb(dbFile);
        closeDb();
        const old = fakeBackup(dataDir, 'data.db.pre-migrate-v016-20200101T000000000Z.bak', 20 * DAY);
        initDb(dbFile);
        expect(fs.existsSync(old)).toBe(false);
    });

    it('pruneMigrationBackups keeps the newest two by the stamp in the name', () => {
        const dataDir = mkTmp('prune2');
        const dbFile = path.join(dataDir, 'data.db');
        for (const stamp of ['20260101T000000000Z', '20260102T000000000Z', '20260103T000000000Z']) {
            fakeBackup(dataDir, `data.db.pre-migrate-v001-${stamp}.bak`, DAY);
        }
        pruneMigrationBackups(dbFile);
        expect(backupsIn(dataDir)).toEqual([
            'data.db.pre-migrate-v001-20260102T000000000Z.bak',
            'data.db.pre-migrate-v001-20260103T000000000Z.bak',
        ]);
    });

    it('removeDatabaseFiles deletes the database, its journals, backups and .legacy.bak, and nothing else', () => {
        const dataDir = mkTmp('rm');
        const dbFile = path.join(dataDir, 'data.db');
        const ours = ['data.db', 'data.db-wal', 'data.db-shm', 'data.db.pre-migrate-v001-20260101T000000000Z.bak',
            'data.db.pre-migrate-v001-20260101T000000000Z.bak.partial', 'data.db.legacy.bak', 'data.db.legacy.bak-wal'];
        const others = ['settings.json', 'other.db', 'notes.bak'];
        for (const f of [...ours, ...others]) fs.writeFileSync(path.join(dataDir, f), 'x');
        const removed = removeDatabaseFiles(dbFile).map(f => path.basename(f)).sort();
        expect(removed).toEqual([...ours].sort());
        expect(fs.readdirSync(dataDir).sort()).toEqual([...others].sort());
    });
});

describe('legacy database relocation', () => {
    let silence: jest.SpyInstance[];
    beforeEach(() => {
        silence = [jest.spyOn(console, 'log').mockImplementation(() => {}), jest.spyOn(console, 'error').mockImplementation(() => {})];
    });
    afterEach(() => silence.forEach(s => s.mockRestore()));

    /**
     * A legacy install database with an un-checkpointed insert: the live files
     * (data.db + data.db-wal) are copied while the writer is still open, which is
     * exactly what a crashed or killed process leaves behind.
     */
    const legacyWithWalRows = (legacyDir: string) => {
        const live = path.join(mkTmp('live'), 'data.db');
        const d = new Database(live);
        d.pragma('journal_mode = WAL');
        d.pragma('wal_autocheckpoint = 0');
        d.exec('CREATE TABLE requests (id TEXT); CREATE TABLE projects (id TEXT, name TEXT)');
        d.exec("INSERT INTO projects VALUES ('old', 'old')");
        d.pragma('wal_checkpoint(TRUNCATE)');
        d.exec("INSERT INTO projects VALUES ('recent', 'recent')");
        const target = path.join(legacyDir, 'data.db');
        fs.copyFileSync(live, target);
        fs.copyFileSync(`${live}-wal`, `${target}-wal`);
        d.close();
        expect(fs.statSync(`${target}-wal`).size).toBeGreaterThan(0);
        return target;
    };

    it('carries rows that only exist in the legacy -wal and leaves no orphaned -wal/-shm', () => {
        const legacyDir = mkTmp('legacy');
        const oldPath = legacyWithWalRows(legacyDir);
        const newPath = path.join(mkTmp('new'), 'data.db');

        migrateLegacyDb(newPath, [oldPath]);

        const moved = new Database(newPath, { readonly: true });
        expect(moved.prepare('SELECT id FROM projects ORDER BY id').all()).toEqual([{ id: 'old' }, { id: 'recent' }]);
        moved.close();
        expect(fs.existsSync(`${oldPath}.legacy.bak`)).toBe(true);
        expect(fs.existsSync(oldPath)).toBe(false);
        expect(fs.existsSync(`${oldPath}-wal`)).toBe(false);
        expect(fs.existsSync(`${oldPath}-shm`)).toBe(false);
        expect(fs.readdirSync(path.dirname(newPath)).sort()).toEqual(['data.db']); // no leftover temp file
    });

    it('still refuses to relocate over a populated target database', () => {
        const legacyDir = mkTmp('legacy2');
        const oldPath = legacyWithWalRows(legacyDir);
        const newPath = path.join(mkTmp('new2'), 'data.db');
        fs.writeFileSync(newPath, 'existing data');
        migrateLegacyDb(newPath, [oldPath]);
        expect(fs.readFileSync(newPath, 'utf8')).toBe('existing data');
        expect(fs.existsSync(oldPath)).toBe(true);
    });

    it('relocates over an empty target file', () => {
        const legacyDir = mkTmp('legacy3');
        const oldPath = legacyWithWalRows(legacyDir);
        const newPath = path.join(mkTmp('new3'), 'data.db');
        fs.writeFileSync(newPath, '');
        migrateLegacyDb(newPath, [oldPath]);
        const moved = new Database(newPath, { readonly: true });
        expect(moved.prepare('SELECT count(*) AS n FROM projects').get()).toEqual({ n: 2 });
        moved.close();
    });
});
