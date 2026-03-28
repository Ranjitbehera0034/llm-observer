/**
 * Shared in-memory database setup for all E2E/integration tests.
 * Call createTestDb() in your jest.mock('@llm-observer/database') factory.
 */
// Using require-style imports to be safely callable from jest.mock factories
import path from 'path';
import fs from 'fs';
import BetterSQLite3, { type Database } from 'better-sqlite3';
import { randomUUID } from 'crypto';

export function createTestDb(): { 
    database: Database; 
    bulkInsertRequests: (requests: any[]) => void;
    getBudgetLimits: (activeOnly?: boolean) => any[];
} {
    const database = new BetterSQLite3(':memory:');
    const migrationDir = path.join(__dirname, '../../../../../packages/database/src/migrations');

    // Base schemas and runtime migrations (scan directory)
    if (fs.existsSync(migrationDir)) {
        const files = fs.readdirSync(migrationDir)
            .filter(f => f.endsWith('.sql'))
            .sort();
        for (const file of files) {
            const fullPath = path.join(migrationDir, file);
            try {
                database.exec(fs.readFileSync(fullPath, 'utf8'));
            } catch (err: any) {
                console.warn(`[testDb] Migration ${file} failed: ${err.message}`);
            }
        }
    }

    // Runtime versioned migrations
    const safeExec = (sql: string) => {
        try { database.exec(sql); } catch { /* already exists */ }
    };
    safeExec('ALTER TABLE requests ADD COLUMN pricing_unknown BOOLEAN DEFAULT 0;');
    safeExec('ALTER TABLE model_pricing ADD COLUMN is_custom BOOLEAN DEFAULT 0;');
    safeExec('ALTER TABLE projects ADD COLUMN organization_id TEXT;');
    safeExec('ALTER TABLE requests ADD COLUMN prompt_hash TEXT;');
    safeExec('ALTER TABLE projects ADD COLUMN saved_filters TEXT DEFAULT "[]";');
    safeExec('ALTER TABLE daily_stats ADD COLUMN synced_at DATETIME;');
    safeExec('ALTER TABLE requests ADD COLUMN metadata TEXT DEFAULT "{}";');

    // Seed mandatory defaults
    database.prepare("INSERT OR IGNORE INTO organizations (id, name) VALUES ('default', 'Default Organization')").run();
    database.prepare('INSERT OR IGNORE INTO projects (id, name, daily_budget) VALUES (?, ?, ?)').run('default', 'Default Project', 100.0);
    database.prepare('INSERT OR IGNORE INTO model_pricing (provider, model, input_cost_per_1m, output_cost_per_1m) VALUES (?, ?, ?, ?)').run('openai', 'gpt-4', 30.0, 60.0);

    function bulkInsertRequests(requests: any[]) {
        const stmt = database.prepare(`
            INSERT INTO requests (
                id, project_id, provider, model, endpoint,
                prompt_tokens, completion_tokens, total_tokens,
                cost_usd, latency_ms, status_code, status,
                is_streaming, has_tools, error_message,
                request_body, response_body, pricing_unknown, tags, prompt_hash, metadata, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        for (const req of requests) {
            stmt.run(
                req.id || randomUUID(),
                req.project_id || 'default', req.provider || 'openai', req.model || 'gpt-4', req.endpoint || '/v1/chat/completions',
                req.prompt_tokens || 0, req.completion_tokens || 0, req.total_tokens || 0,
                req.cost_usd || 0, req.latency_ms || 0, req.status_code || 200, req.status || 'success',
                req.is_streaming ? 1 : 0, req.has_tools ? 1 : 0, req.error_message || null,
                req.request_body || null, req.response_body || null, req.pricing_unknown ? 1 : 0,
                req.tags || null, req.prompt_hash || null, req.metadata || '{}',
                req.created_at || new Date().toISOString()
            );
        }
    }

    function getBudgetLimits(activeOnly: boolean = false) {
        let query = 'SELECT * FROM budgets';
        if (activeOnly) query += ' WHERE is_active = 1';
        return database.prepare(query).all();
    }

    return { database, bulkInsertRequests, getBudgetLimits };
}
