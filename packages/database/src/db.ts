import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

// By default, store DB in ~/.llm-observer/data.db
export const getDbPath = () => {
    const homeDir = process.env.HOME || process.env.USERPROFILE || '';
    const dbDir = path.join(homeDir, '.llm-observer');
    if (!fs.existsSync(dbDir)) {
        fs.mkdirSync(dbDir, { recursive: true });
    }
    return path.join(dbDir, 'data.db');
};

let db: Database.Database | null = null;

export const initDb = (dbPath?: string): Database.Database => {
    if (db) return db;
    const targetPath = dbPath || getDbPath();
    db = new Database(targetPath);

    db.pragma('journal_mode = WAL');

    // Run initial migrations
    const migrationPath = path.join(__dirname, '001_initial.sql');
    if (fs.existsSync(migrationPath)) {
        const migration = fs.readFileSync(migrationPath, 'utf8');
        db.exec(migration);
    } else {
        console.warn(`Migration file not found at ${migrationPath}`);
    }

    const authSchemaPath = path.join(__dirname, '002_auth.sql');
    const authSchemaSql = fs.readFileSync(authSchemaPath, 'utf-8');
    db.exec(authSchemaSql);

    // Apply Alerts Rules schema
    const alertsSchemaPath = path.join(__dirname, '003_alerts.sql');
    const alertsSchemaSql = fs.readFileSync(alertsSchemaPath, 'utf-8');
    db.exec(alertsSchemaSql);

    // --- Versioned migration system ---
    // Track applied migrations in a _schema_version table to avoid re-running
    db.exec(`CREATE TABLE IF NOT EXISTS _schema_version (
        version INTEGER PRIMARY KEY,
        description TEXT NOT NULL,
        applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );`);

    const getSchemaVersion = (): number => {
        const row = db!.prepare('SELECT MAX(version) as v FROM _schema_version').get() as any;
        return row?.v || 0;
    };

    const applyMigration = (version: number, description: string, sql: string) => {
        if (getSchemaVersion() >= version) return; // Already applied
        try {
            db!.exec(sql);
            db!.prepare('INSERT INTO _schema_version (version, description) VALUES (?, ?)').run(version, description);
            console.log(`Migration ${version} applied: ${description}`);
        } catch (err: any) {
            // Handle "duplicate column" gracefully for idempotency
            if (err?.message?.includes('duplicate column')) {
                db!.prepare('INSERT OR IGNORE INTO _schema_version (version, description) VALUES (?, ?)').run(version, description);
            } else {
                throw err;
            }
        }
    };

    try {
        applyMigration(1, 'Add pricing_unknown to requests',
            'ALTER TABLE requests ADD COLUMN pricing_unknown BOOLEAN DEFAULT 0;');

        applyMigration(2, 'Add is_custom to model_pricing',
            'ALTER TABLE model_pricing ADD COLUMN is_custom BOOLEAN DEFAULT 0;');

        applyMigration(3, 'Add organization_id to projects',
            'ALTER TABLE projects ADD COLUMN organization_id TEXT REFERENCES organizations(id);');

        applyMigration(4, 'Add prompt_hash to requests',
            'ALTER TABLE requests ADD COLUMN prompt_hash TEXT;');

        applyMigration(5, 'Add saved_filters to projects',
            'ALTER TABLE projects ADD COLUMN saved_filters TEXT DEFAULT "[]";');

        applyMigration(6, 'Add synced_at to daily_stats',
            'ALTER TABLE daily_stats ADD COLUMN synced_at DATETIME;');

        applyMigration(7, 'Add metadata to requests',
            'ALTER TABLE requests ADD COLUMN metadata TEXT DEFAULT "{}";');
    } catch (err) {
        console.error('Migration checks failed:', err);
    }

    return db;
};

export const getDb = (): Database.Database => {
    if (!db) {
        throw new Error("Database not initialized. Call initDb() first.");
    }
    return db;
};
