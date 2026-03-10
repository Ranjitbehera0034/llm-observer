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

    // Database upgrade migrations (dynamic ALTER)
    try {
        // Migration 1: Add pricing_unknown to requests
        const requestsColumns = db.prepare("PRAGMA table_info(requests)").all() as any[];
        if (!requestsColumns.some(col => col.name === 'pricing_unknown')) {
            db.exec('ALTER TABLE requests ADD COLUMN pricing_unknown BOOLEAN DEFAULT 0;');
            console.log('Migrated requests table: added pricing_unknown column');
        }

        // Migration 2: Add is_custom to model_pricing
        const pricingColumns = db.prepare("PRAGMA table_info(model_pricing)").all() as any[];
        if (!pricingColumns.some(col => col.name === 'is_custom')) {
            db.exec('ALTER TABLE model_pricing ADD COLUMN is_custom BOOLEAN DEFAULT 0;');
            console.log('Migrated model_pricing table: added is_custom column');
        }

        // Migration 3: Add organization_id to projects
        const projectColumns = db.prepare("PRAGMA table_info(projects)").all() as any[];
        if (!projectColumns.some(col => col.name === 'organization_id')) {
            db.exec('ALTER TABLE projects ADD COLUMN organization_id TEXT REFERENCES organizations(id);');
            console.log('Migrated projects table: added organization_id column');
        }

        // Migration 4: Add prompt_hash to requests
        const requestsColumnsPostAdd = db.prepare("PRAGMA table_info(requests)").all() as any[];
        if (!requestsColumnsPostAdd.some(col => col.name === 'prompt_hash')) {
            db.exec('ALTER TABLE requests ADD COLUMN prompt_hash TEXT;');
            console.log('Migrated requests table: added prompt_hash column');
        }

        // Migration 5: Add saved_filters to projects
        if (!projectColumns.some(col => col.name === 'saved_filters')) {
            db.exec('ALTER TABLE projects ADD COLUMN saved_filters TEXT DEFAULT "[]";');
            console.log('Migrated projects table: added saved_filters column');
        }
        // Migration 6: Add synced_at to daily_stats
        const statsColumns = db.prepare("PRAGMA table_info(daily_stats)").all() as any[];
        if (!statsColumns.some(col => col.name === 'synced_at')) {
            db.exec('ALTER TABLE daily_stats ADD COLUMN synced_at DATETIME;');
            console.log('Migrated daily_stats table: added synced_at column');
        }
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
