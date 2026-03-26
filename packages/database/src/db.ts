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

const migrateLegacyDb = (newPath: string) => {
    // Check common legacy locations
    const legacyPaths = [
        path.join(process.cwd(), 'data.db'),
        path.join(__dirname, '..', 'data.db'), // e.g. packages/proxy/data.db or dist/../data.db
        path.join(__dirname, 'data.db')
    ];

    for (const oldPath of legacyPaths) {
        if (fs.existsSync(oldPath) && oldPath !== newPath) {
            // Only migrate if the new DB doesn't exist or is very small (just initialized)
            const newExists = fs.existsSync(newPath);
            const legacySize = fs.statSync(oldPath).size;
            
            // basic check: only migrate if legacy exists and has data
            if (legacySize > 0) {
                if (newExists && fs.statSync(newPath).size > legacySize) {
                    console.log(`[MIGRATION] Legacy database found at ${oldPath}, but newer database already has more data. Skipping auto-migration.`);
                    continue;
                }

                console.log(`[MIGRATION] Found legacy database at ${oldPath}. Moving to ${newPath}...`);
                try {
                    const newDir = path.dirname(newPath);
                    if (!fs.existsSync(newDir)) fs.mkdirSync(newDir, { recursive: true });
                    
                    // Close any handles? Not yet opened.
                    fs.copyFileSync(oldPath, newPath);
                    fs.renameSync(oldPath, `${oldPath}.legacy.bak`); // Keep a backup of the old one
                    console.log(`[MIGRATION] Successfully moved database. Old file renamed to .legacy.bak`);
                    return; 
                } catch (err) {
                    console.error(`[MIGRATION] Failed to move legacy database:`, err);
                }
            }
        }
    }
};

let db: Database.Database | null = null;

export const initDb = (dbPath?: string): Database.Database => {
    if (db) return db;
    const targetPath = dbPath || getDbPath();
    
    // Auto-migrate from old locations if needed
    if (!dbPath) {
        migrateLegacyDb(targetPath);
    }

    db = new Database(targetPath);

    db.pragma('journal_mode = WAL');

    // --- Versioned migration system v2 ---
    db.exec(`CREATE TABLE IF NOT EXISTS _schema_version_v2 (
        name TEXT PRIMARY KEY,
        applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );`);

    const migrationsDir = path.join(__dirname, 'migrations');
    if (fs.existsSync(migrationsDir)) {
        const files = fs.readdirSync(migrationsDir)
            .filter(f => f.endsWith('.sql'))
            .sort();

        for (const file of files) {
            const row = db.prepare('SELECT 1 FROM _schema_version_v2 WHERE name = ?').get(file) as any;
            if (!row) {
                const migrationPath = path.join(migrationsDir, file);
                const sql = fs.readFileSync(migrationPath, 'utf8');
                try {
                    db.exec(sql);
                    db.prepare('INSERT INTO _schema_version_v2 (name) VALUES (?)').run(file);
                    console.log(`Migration applied: ${file}`);
                } catch (err: any) {
                    console.error(`Failed to apply migration ${file}:`, err);
                    throw err; // Stop on failure to prevent corruption
                }
            }
        }
    } else {
        console.warn(`Migrations directory not found at ${migrationsDir}`);
    }

    return db;
};

export const getDb = (): Database.Database => {
    if (!db) {
        throw new Error("Database not initialized. Call initDb() first.");
    }
    return db;
};
