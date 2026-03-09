"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.seedDefaultApiKey = exports.validateApiKey = exports.createApiKey = exports.hashApiKey = void 0;
const db_1 = require("../db");
const crypto_1 = require("crypto");
const hashApiKey = (apiKey) => {
    return (0, crypto_1.createHash)('sha256').update(apiKey).digest('hex');
};
exports.hashApiKey = hashApiKey;
const createApiKey = (name, projectId, organizationId, expiresAt = null) => {
    const db = (0, db_1.getDb)();
    const id = (0, crypto_1.randomUUID)();
    // Generate a secure random token (e.g. llmo_ + 32 hex chars)
    const rawKey = `llmo_${(0, crypto_1.randomUUID)().replace(/-/g, '')}${(0, crypto_1.randomUUID)().replace(/-/g, '')}`;
    const keyHash = (0, exports.hashApiKey)(rawKey);
    const keyHint = rawKey.substring(0, 8) + '...' + rawKey.slice(-4);
    const stmt = db.prepare(`
        INSERT INTO api_keys (id, key_hash, key_hint, name, project_id, organization_id, expires_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(id, keyHash, keyHint, name, projectId, organizationId, expiresAt);
    return { id, apiKey: rawKey };
};
exports.createApiKey = createApiKey;
const validateApiKey = (apiKey) => {
    const db = (0, db_1.getDb)();
    const hash = (0, exports.hashApiKey)(apiKey);
    const stmt = db.prepare(`
        SELECT * FROM api_keys WHERE key_hash = ?
    `);
    const record = stmt.get(hash);
    if (record) {
        // Update last used asynchronously
        try {
            db.prepare('UPDATE api_keys SET last_used_at = CURRENT_TIMESTAMP WHERE id = ?').run(record.id);
        }
        catch (e) { }
    }
    return record || null;
};
exports.validateApiKey = validateApiKey;
// Seed default API key if table is empty
const seedDefaultApiKey = () => {
    const db = (0, db_1.getDb)();
    const count = db.prepare('SELECT count(*) as count FROM api_keys').get().count;
    if (count === 0) {
        // Need to ensure organization 'default' and project 'default' exists
        const orgCount = db.prepare('SELECT count(*) as count FROM organizations WHERE id = ?').get('default').count;
        if (orgCount === 0) {
            db.prepare('INSERT INTO organizations (id, name) VALUES (?, ?)').run('default', 'Default Organization');
        }
        const projectCount = db.prepare('SELECT count(*) as count FROM projects WHERE id = ?').get('default').count;
        if (projectCount === 0) {
            db.prepare('INSERT INTO projects (id, name, organization_id) VALUES (?, ?, ?)').run('default', 'Default Project', 'default');
        }
        const { apiKey } = (0, exports.createApiKey)('Default Key', 'default', 'default');
        console.log(`\n=========================================`);
        console.log(`🔑 INITIAL SETUP: Default API Key Generated`);
        console.log(`🔑 KEY: ${apiKey}`);
        console.log(`⚠️  Save this key! It will not be shown again.`);
        console.log(`=========================================\n`);
    }
};
exports.seedDefaultApiKey = seedDefaultApiKey;
//# sourceMappingURL=auth.repo.js.map