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

    return db;
};

export const getDb = (): Database.Database => {
    if (!db) {
        throw new Error("Database not initialized. Call initDb() first.");
    }
    return db;
};
