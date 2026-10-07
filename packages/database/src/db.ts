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

const migrateLegacyDb = (newPath: string) => {
    // Old install locations only. The current working directory is deliberately
    // NOT probed: running the CLI from a directory that happens to hold some other
    // data.db must never move or copy that file.
    const legacyPaths = [
        path.join(__dirname, '..', 'data.db'), // e.g. packages/proxy/data.db or dist/../data.db
        path.join(__dirname, 'data.db')
    ];

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
        try {
            const newDir = path.dirname(newPath);
            if (!fs.existsSync(newDir)) fs.mkdirSync(newDir, { recursive: true });

            fs.copyFileSync(oldPath, newPath);
            fs.renameSync(oldPath, `${oldPath}.legacy.bak`); // Keep a backup of the old one
            console.log(`[MIGRATION] Successfully moved database. Old file renamed to .legacy.bak`);
            return;
        } catch (err) {
            console.error(`[MIGRATION] Failed to move legacy database:`, err);
        }
    }
};

const BACKUP_INFIX = '.pre-migrate-';
const BACKUP_SUFFIX = '.bak';
const BACKUPS_TO_KEEP = 2;

// Snapshot the database before applying pending migrations (VACUUM INTO writes a
// consistent, standalone copy even in WAL mode) and keep only the newest few.
const backupBeforeMigrating = (database: Database.Database): string => {
    const dbFile = database.name;
    const stamp = new Date().toISOString().replace(/[-:.]/g, '');
    const backupPath = `${dbFile}${BACKUP_INFIX}${stamp}${BACKUP_SUFFIX}`;
    database.exec(`VACUUM INTO '${backupPath.replace(/'/g, "''")}'`);

    const dir = path.dirname(dbFile);
    const prefix = `${path.basename(dbFile)}${BACKUP_INFIX}`;
    const backups = fs.readdirSync(dir)
        .filter(f => f.startsWith(prefix) && f.endsWith(BACKUP_SUFFIX))
        .sort();
    for (const old of backups.slice(0, Math.max(0, backups.length - BACKUPS_TO_KEEP))) {
        try { fs.unlinkSync(path.join(dir, old)); } catch { /* best effort */ }
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
    if (pending.length === 0) return [];

    let backupPath: string | null = null;
    if (!database.memory) {
        const existing = database.prepare(
            "SELECT count(*) AS n FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name != '_schema_version_v2'"
        ).get() as { n: number };
        if (existing.n > 0) {
            backupPath = backupBeforeMigrating(database);
            console.log(`Database backed up before migrating: ${backupPath}`);
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
