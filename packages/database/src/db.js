"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getDb = exports.initDb = exports.getDbPath = void 0;
const better_sqlite3_1 = __importDefault(require("better-sqlite3"));
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
// By default, store DB in ~/.llm-observer/data.db
const getDbPath = () => {
    const homeDir = process.env.HOME || process.env.USERPROFILE || '';
    const dbDir = path_1.default.join(homeDir, '.llm-observer');
    if (!fs_1.default.existsSync(dbDir)) {
        fs_1.default.mkdirSync(dbDir, { recursive: true });
    }
    return path_1.default.join(dbDir, 'data.db');
};
exports.getDbPath = getDbPath;
let db = null;
const initDb = (dbPath) => {
    if (db)
        return db;
    const targetPath = dbPath || (0, exports.getDbPath)();
    db = new better_sqlite3_1.default(targetPath);
    db.pragma('journal_mode = WAL');
    // Run initial migrations
    const migrationPath = path_1.default.join(__dirname, '001_initial.sql');
    if (fs_1.default.existsSync(migrationPath)) {
        const migration = fs_1.default.readFileSync(migrationPath, 'utf8');
        db.exec(migration);
    }
    else {
        console.warn(`Migration file not found at ${migrationPath}`);
    }
    const authSchemaPath = path_1.default.join(__dirname, '002_auth.sql');
    const authSchemaSql = fs_1.default.readFileSync(authSchemaPath, 'utf-8');
    db.exec(authSchemaSql);
    // Apply Alerts Rules schema
    const alertsSchemaPath = path_1.default.join(__dirname, '003_alerts.sql');
    const alertsSchemaSql = fs_1.default.readFileSync(alertsSchemaPath, 'utf-8');
    db.exec(alertsSchemaSql);
    // Database upgrade migrations (dynamic ALTER)
    try {
        // Migration 1: Add pricing_unknown to requests
        const requestsColumns = db.prepare("PRAGMA table_info(requests)").all();
        if (!requestsColumns.some(col => col.name === 'pricing_unknown')) {
            db.exec('ALTER TABLE requests ADD COLUMN pricing_unknown BOOLEAN DEFAULT 0;');
            console.log('Migrated requests table: added pricing_unknown column');
        }
        // Migration 2: Add is_custom to model_pricing
        const pricingColumns = db.prepare("PRAGMA table_info(model_pricing)").all();
        if (!pricingColumns.some(col => col.name === 'is_custom')) {
            db.exec('ALTER TABLE model_pricing ADD COLUMN is_custom BOOLEAN DEFAULT 0;');
            console.log('Migrated model_pricing table: added is_custom column');
        }
        // Migration 3: Add organization_id to projects
        const projectColumns = db.prepare("PRAGMA table_info(projects)").all();
        if (!projectColumns.some(col => col.name === 'organization_id')) {
            db.exec('ALTER TABLE projects ADD COLUMN organization_id TEXT REFERENCES organizations(id);');
            console.log('Migrated projects table: added organization_id column');
        }
        // Migration 4: Add prompt_hash to requests
        const requestsColumnsPostAdd = db.prepare("PRAGMA table_info(requests)").all();
        if (!requestsColumnsPostAdd.some(col => col.name === 'prompt_hash')) {
            db.exec('ALTER TABLE requests ADD COLUMN prompt_hash TEXT;');
            console.log('Migrated requests table: added prompt_hash column');
        }
        // Migration 5: Add saved_filters to projects
        if (!projectColumns.some(col => col.name === 'saved_filters')) {
            db.exec('ALTER TABLE projects ADD COLUMN saved_filters TEXT DEFAULT "[]";');
            console.log('Migrated projects table: added saved_filters column');
        }
    }
    catch (err) {
        console.error('Migration checks failed:', err);
    }
    return db;
};
exports.initDb = initDb;
const getDb = () => {
    if (!db) {
        throw new Error("Database not initialized. Call initDb() first.");
    }
    return db;
};
exports.getDb = getDb;
//# sourceMappingURL=db.js.map