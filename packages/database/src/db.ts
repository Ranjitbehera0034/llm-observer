import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

// DB lives in LLM_OBSERVER_DATA_DIR if set, otherwise ~/.llm-observer/data.db
export const getDbPath = () => {
    const homeDir = process.env.HOME || process.env.USERPROFILE || '';
    const dbDir = process.env.LLM_OBSERVER_DATA_DIR || path.join(homeDir, '.llm-observer');
    if (!fs.existsSync(dbDir)) {
        fs.mkdirSync(dbDir, { recursive: true });
    }
    return path.join(dbDir, 'data.db');
};

// A candidate legacy file only counts if it is really an llm-observer database.
// Anything else named data.db (another app's, a scratch file) must be left alone.
const isLlmObserverDb = (file: string): boolean => {
    let probe: Database.Database | null = null;
    try {
        probe = new Database(file, { readonly: true, fileMustExist: true });
        const tables = probe.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[];
        const names = new Set(tables.map(t => t.name));
        return names.has('requests') && names.has('projects');
    } catch {
        return false;
    } finally {
        try { probe?.close(); } catch { /* ignore */ }
    }
};

const LEGACY_SUFFIX = '.legacy.bak';

// Default places an old install may have left its database.
const defaultLegacyPaths = () => [
    path.join(__dirname, '..', 'data.db'), // e.g. packages/proxy/data.db or dist/../data.db
    path.join(__dirname, 'data.db')
];

/**
 * Seed `newPath` from an old install-dir database. The copy goes through SQLite
 * (VACUUM INTO) rather than a file copy, so rows still sitting in the legacy
 * -wal are included, and it is written to a temporary name and renamed so an
 * interrupted copy can never look like a populated database on the next start.
 */
export const migrateLegacyDb = (newPath: string, legacyPaths: string[] = defaultLegacyPaths()) => {
    // Old install locations only. The current working directory is deliberately
    // NOT probed: running the CLI from a directory that happens to hold some other
    // data.db must never move or copy that file.

    // Never overwrite an existing database that holds anything. A new database is
    // only seeded from a legacy one when there is no file (or an empty file) yet.
    if (fs.existsSync(newPath) && fs.statSync(newPath).size > 0) return;

    for (const oldPath of legacyPaths) {
        if (oldPath === newPath || !fs.existsSync(oldPath) || fs.statSync(oldPath).size === 0) continue;

        if (!isLlmObserverDb(oldPath)) {
            console.log(`[MIGRATION] Ignoring ${oldPath}: not an LLM Observer database.`);
            continue;
        }

        console.log(`[MIGRATION] Found legacy database at ${oldPath}. Moving to ${newPath}...`);
        const partial = `${newPath}.migrating`;
        try {
            const newDir = path.dirname(newPath);
            if (!fs.existsSync(newDir)) fs.mkdirSync(newDir, { recursive: true });
            fs.rmSync(partial, { force: true });

            const legacy = new Database(oldPath, { fileMustExist: true });
            try {
                // Opening replays a pending -wal; VACUUM INTO then writes one consistent file.
                legacy.exec(`VACUUM INTO '${partial.replace(/'/g, "''")}'`);
            } finally {
                legacy.close(); // last connection: checkpoints and normally removes -wal/-shm
            }
            fs.renameSync(partial, newPath);

            fs.renameSync(oldPath, `${oldPath}${LEGACY_SUFFIX}`); // Keep a backup of the old one
            // Anything the close left behind belongs to the old file: keep it paired with
            // the renamed file rather than orphaned beside a path a new database may reuse.
            for (const ext of ['-wal', '-shm']) {
                if (!fs.existsSync(oldPath + ext)) continue;
                try { fs.renameSync(oldPath + ext, `${oldPath}${LEGACY_SUFFIX}${ext}`); } catch { /* best effort */ }
            }
            console.log(`[MIGRATION] Successfully moved database. Old file renamed to .legacy.bak`);
            return;
        } catch (err) {
            try { fs.rmSync(partial, { force: true }); } catch { /* ignore */ }
            console.error(`[MIGRATION] Failed to move legacy database:`, err);
        }
    }
};

const BACKUP_INFIX = '.pre-migrate-';
const BACKUP_SUFFIX = '.bak';
const BACKUP_PARTIAL_SUFFIX = '.partial';
const BACKUPS_TO_KEEP = 2;
const BACKUP_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;
export const SKIP_MIGRATION_BACKUP_ENV = 'LLM_OBSERVER_SKIP_MIGRATION_BACKUP';

const backupPrefix = (dbFile: string) => `${path.basename(dbFile)}${BACKUP_INFIX}`;

const listBackups = (dbFile: string): string[] => {
    const dir = path.dirname(dbFile);
    const prefix = backupPrefix(dbFile);
    try {
        return fs.readdirSync(dir)
            .filter(f => f.startsWith(prefix) && f.endsWith(BACKUP_SUFFIX))
            .sort((a, b) => stampOf(a).localeCompare(stampOf(b)) || a.localeCompare(b))
            .map(f => path.join(dir, f));
    } catch {
        return [];
    }
};

// 'data.db.pre-migrate-v016-20261007T165400370Z.bak' -> '20261007T165400370Z'
const stampOf = (file: string) => /(\d{8}T\d+Z)\.bak$/.exec(file)?.[1] ?? '';

/**
 * Expire pre-migration backups: they are full copies of the database (proxy
 * bodies included), so keep only the newest few and nothing older than 14 days.
 */
export const pruneMigrationBackups = (dbFile: string, now: number = Date.now()): void => {
    const backups = listBackups(dbFile);
    const keep = new Set(backups.slice(Math.max(0, backups.length - BACKUPS_TO_KEEP)));
    for (const file of backups) {
        let expired = false;
        try { expired = now - fs.statSync(file).mtimeMs > BACKUP_MAX_AGE_MS; } catch { /* vanished */ }
        if (keep.has(file) && !expired) continue;
        try { fs.unlinkSync(file); } catch { /* best effort */ }
    }
};

/**
 * Remove the database file and everything kept beside it that holds a copy of
 * its data: -wal/-shm/-journal, pre-migration backups (and half-written ones)
 * and the .legacy.bak left by a legacy relocation. Returns the files removed.
 */
export const removeDatabaseFiles = (dbFile: string): string[] => {
    const dir = path.dirname(dbFile);
    const base = path.basename(dbFile);
    const removed: string[] = [];
    let names: string[] = [];
    try { names = fs.readdirSync(dir); } catch { return removed; }
    for (const name of names) {
        const isOurs = name === base
            || name === `${base}-wal` || name === `${base}-shm` || name === `${base}-journal`
            || name.startsWith(`${base}${BACKUP_INFIX}`)
            || name === `${base}${LEGACY_SUFFIX}` || name.startsWith(`${base}${LEGACY_SUFFIX}-`);
        if (!isOurs) continue;
        try {
            fs.rmSync(path.join(dir, name), { force: true });
            removed.push(path.join(dir, name));
        } catch { /* best effort */ }
    }
    return removed;
};

/**
 * Snapshot the database before applying pending migrations (VACUUM INTO writes a
 * consistent, standalone copy even in WAL mode). Returns the backup path, or null
 * when backups are switched off. The copy is written under a temporary name and
 * renamed on success, so a failure never leaves a truncated file that looks like
 * a backup. The file name carries the schema version the upgrade starts from and
 * only one backup is taken per starting version: retrying a failed upgrade must
 * never replace the one true pre-migration copy with an already half-migrated one.
 */
const backupBeforeMigrating = (database: Database.Database, startVersion: string): string | null => {
    if (process.env[SKIP_MIGRATION_BACKUP_ENV] === '1') {
        console.log(`Skipping the pre-migration backup (${SKIP_MIGRATION_BACKUP_ENV}=1).`);
        return null;
    }
    const dbFile = database.name;
    const versionTag = `v${startVersion}-`;

    const existing = listBackups(dbFile).find(f => path.basename(f).startsWith(`${backupPrefix(dbFile)}${versionTag}`));
    if (existing) return existing;

    const stamp = new Date().toISOString().replace(/[-:.]/g, '');
    const backupPath = `${dbFile}${BACKUP_INFIX}${versionTag}${stamp}${BACKUP_SUFFIX}`;
    const partialPath = `${backupPath}${BACKUP_PARTIAL_SUFFIX}`;
    try {
        fs.rmSync(partialPath, { force: true });
        // Created owner-only up front (VACUUM INTO accepts an empty target), so the
        // copy is never readable by others while it is being written.
        fs.writeFileSync(partialPath, '', { mode: 0o600 });
        database.exec(`VACUUM INTO '${partialPath.replace(/'/g, "''")}'`);
        try { fs.chmodSync(partialPath, 0o600); } catch { /* not supported on this platform */ }
        fs.renameSync(partialPath, backupPath);
    } catch (err: any) {
        try { fs.rmSync(partialPath, { force: true }); } catch { /* ignore */ }
        let size = '';
        try { size = ` (about ${Math.ceil(fs.statSync(dbFile).size / (1024 * 1024))} MB)`; } catch { /* ignore */ }
        throw new Error(
            `Could not back up the database before migrating it: ${err.message}. ` +
            `The backup is a full copy of the database${size}, so check that the disk has enough free space. ` +
            `To upgrade without a backup, set ${SKIP_MIGRATION_BACKUP_ENV}=1 and start again. The database was not modified.`
        );
    }
    return backupPath;
};

/**
 * Apply every pending .sql file in `migrationsDir`, in name order.
 *
 * Each file and its version row commit together in one transaction (BEGIN
 * IMMEDIATE), so a failure leaves the schema untouched and the version row
 * absent; the next boot simply retries. The version row is re-checked inside the
 * write lock, so two processes starting at once cannot both apply the same file.
 * A file-backed database that already has data is backed up before the first
 * pending migration runs.
 */
export const runMigrations = (database: Database.Database, migrationsDir: string): string[] => {
    if (!fs.existsSync(migrationsDir)) {
        throw new Error(`Migrations directory not found at ${migrationsDir}. The installation is incomplete; reinstall llm-observer.`);
    }

    database.exec(`CREATE TABLE IF NOT EXISTS _schema_version_v2 (
        name TEXT PRIMARY KEY,
        applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );`);

    const files = fs.readdirSync(migrationsDir)
        .filter(f => f.endsWith('.sql'))
        .sort();
    const isApplied = database.prepare('SELECT 1 FROM _schema_version_v2 WHERE name = ?');
    const pending = files.filter(f => !isApplied.get(f));
    if (pending.length === 0) {
        if (!database.memory) pruneMigrationBackups(database.name); // backups expire even without an upgrade
        return [];
    }

    let backupPath: string | null = null;
    if (!database.memory) {
        const existing = database.prepare(
            "SELECT count(*) AS n FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name != '_schema_version_v2'"
        ).get() as { n: number };
        if (existing.n > 0) {
            const last = (database.prepare('SELECT max(name) AS name FROM _schema_version_v2').get() as { name: string | null }).name;
            const startVersion = (last ? last.split('_')[0].replace(/[^A-Za-z0-9]/g, '') : '') || 'none';
            backupPath = backupBeforeMigrating(database, startVersion);
            if (backupPath) console.log(`Database backed up before migrating: ${backupPath}`);
            pruneMigrationBackups(database.name);
        }
    }

    const applied: string[] = [];
    for (const file of pending) {
        const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
        database.exec('BEGIN IMMEDIATE');
        try {
            if (isApplied.get(file)) {
                // Another process applied it between our check and taking the lock.
                database.exec('COMMIT');
                continue;
            }
            database.exec(sql);
            database.prepare('INSERT INTO _schema_version_v2 (name) VALUES (?)').run(file);
            database.exec('COMMIT');
            applied.push(file);
            console.log(`Migration applied: ${file}`);
        } catch (err: any) {
            try { database.exec('ROLLBACK'); } catch { /* transaction already gone */ }
            console.error(`Failed to apply migration ${file}:`, err);
            const hint = backupPath ? ` Pre-migration backup: ${backupPath}.` : '';
            err.message = `Migration ${file} failed and was rolled back; the database was left unchanged.${hint} ${err.message}`;
            throw err; // Stop on failure to prevent corruption
        }
    }
    return applied;
};

let db: Database.Database | null = null;

export const initDb = (dbPath?: string): Database.Database => {
    if (db) return db;
    const targetPath = dbPath || getDbPath();

    // Auto-migrate from old locations if needed
    if (!dbPath) {
        migrateLegacyDb(targetPath);
    }

    const database = new Database(targetPath);
    try {
        database.pragma('busy_timeout = 5000');
        database.pragma('journal_mode = WAL');

        // --- Versioned migration system v2 ---
        runMigrations(database, path.join(__dirname, 'migrations'));

        // Seed default organization to prevent foreign key errors if enforced
        database.prepare("INSERT OR IGNORE INTO organizations (id, name) VALUES ('default', 'Default Organization')").run();
    } catch (err) {
        // Do not leave a half-initialised handle cached as the singleton.
        try { database.close(); } catch { /* ignore */ }
        throw err;
    }

    db = database;
    return db;
};

export const getDb = (): Database.Database => {
    if (!db) {
        throw new Error("Database not initialized. Call initDb() first.");
    }
    return db;
};

/** Close the singleton connection (checkpoints the WAL). A later initDb() reopens. */
export const closeDb = (): void => {
    if (!db) return;
    const handle = db;
    db = null;
    try { handle.close(); } catch (err) { console.error('Failed to close database:', err); }
};
