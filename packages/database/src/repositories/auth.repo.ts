import { getDb } from '../db';
import { randomUUID, createHash } from 'crypto';

export interface ApiKeyRecord {
    id: string;
    key_hash: string;
    key_hint: string;
    name: string;
    project_id: string | null;
    organization_id: string | null;
    created_at: string;
    expires_at: string | null;
    last_used_at: string | null;
}

export const hashApiKey = (apiKey: string): string => {
    return createHash('sha256').update(apiKey).digest('hex');
};

export const createApiKey = (
    name: string,
    projectId: string | null,
    organizationId: string | null,
    expiresAt: string | null = null
): { id: string; apiKey: string } => {
    const db = getDb();
    const id = randomUUID();

    // Generate a secure random token (e.g. llmo_ + 32 hex chars)
    const rawKey = `llmo_${randomUUID().replace(/-/g, '')}${randomUUID().replace(/-/g, '')}`;
    const keyHash = hashApiKey(rawKey);
    const keyHint = rawKey.substring(0, 8) + '...' + rawKey.slice(-4);

    const stmt = db.prepare(`
        INSERT INTO api_keys (id, key_hash, key_hint, name, project_id, organization_id, expires_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(id, keyHash, keyHint, name, projectId, organizationId, expiresAt);

    return { id, apiKey: rawKey };
};

export const validateApiKey = (apiKey: string): ApiKeyRecord | null => {
    const db = getDb();
    const hash = hashApiKey(apiKey);

    const stmt = db.prepare(`
        SELECT * FROM api_keys WHERE key_hash = ?
    `);

    const record = stmt.get(hash) as ApiKeyRecord;

    if (record) {
        // Update last used asynchronously
        try {
            db.prepare('UPDATE api_keys SET last_used_at = CURRENT_TIMESTAMP WHERE id = ?').run(record.id);
        } catch (e) { }
    }

    return record || null;
};

// Seed default API key if table is empty
export const seedDefaultApiKey = () => {
    const db = getDb();
    const count = (db.prepare('SELECT count(*) as count FROM api_keys').get() as any).count;

    if (count === 0) {
        // Need to ensure organization 'default' and project 'default' exists
        const orgCount = (db.prepare('SELECT count(*) as count FROM organizations WHERE id = ?').get('default') as any).count;
        if (orgCount === 0) {
            db.prepare('INSERT INTO organizations (id, name) VALUES (?, ?)').run('default', 'Default Organization');
        }

        const projectCount = (db.prepare('SELECT count(*) as count FROM projects WHERE id = ?').get('default') as any).count;
        if (projectCount === 0) {
            db.prepare('INSERT INTO projects (id, name, organization_id) VALUES (?, ?, ?)').run('default', 'Default Project', 'default');
        }

        const { apiKey } = createApiKey('Default Key', 'default', 'default');
        console.log(`\n=========================================`);
        console.log(`🔑 INITIAL SETUP: Default API Key Generated`);
        console.log(`🔑 KEY: ${apiKey}`);
        console.log(`⚠️  Save this key! It will not be shown again.`);
        console.log(`=========================================\n`);
    }
};
