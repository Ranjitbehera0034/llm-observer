import { Router } from 'express';
import { getDb, encrypt } from '@llm-observer/database';
import { usageSyncManager } from '../sync';
import fetch from 'node-fetch';

const router = Router();

// ─────────────────────────────────────────────────────────────────────────────
// 1. Provider Status — enhanced with has_key + next_poll_in_seconds
// ─────────────────────────────────────────────────────────────────────────────
router.get('/status', (req, res) => {
    const db = getDb();
    const configs = db.prepare('SELECT * FROM usage_sync_configs').all() as any[];

    const enriched = configs.map((c) => {
        const hasKey = !!c.admin_key_enc;
        let nextPollInSeconds: number | null = null;
        if (c.last_poll_at && c.status === 'active') {
            const lastPoll = new Date(c.last_poll_at).getTime();
            const interval = (c.poll_interval_seconds || 60) * 1000;
            const nextPoll = lastPoll + interval;
            nextPollInSeconds = Math.max(0, Math.round((nextPoll - Date.now()) / 1000));
        }
        // NEVER expose the key itself
        const { admin_key_enc: _omit, ...safe } = c;
        return { ...safe, has_key: hasKey, next_poll_in_seconds: nextPollInSeconds };
    });

    res.json(enriched);
});

// Per-provider status (section 4.9)
router.get('/providers/:id/status', (req, res) => {
    const { id } = req.params;
    const db = getDb();
    const c = db.prepare('SELECT * FROM usage_sync_configs WHERE id = ?').get(id) as any;
    if (!c) return res.status(404).json({ error: 'Provider not found' });

    const hasKey = !!c.admin_key_enc;
    let nextPollInSeconds: number | null = null;
    if (c.last_poll_at && c.status === 'active') {
        const lastPoll = new Date(c.last_poll_at).getTime();
        const interval = (c.poll_interval_seconds || 60) * 1000;
        nextPollInSeconds = Math.max(0, Math.round((lastPoll + interval - Date.now()) / 1000));
    }
    const { admin_key_enc: _omit, ...safe } = c;
    res.json({ ...safe, has_key: hasKey, next_poll_in_seconds: nextPollInSeconds });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Add/Update Provider Keys
// ─────────────────────────────────────────────────────────────────────────────

// Anthropic
router.post('/providers/anthropic/key', async (req, res) => {
    const { adminKey } = req.body;
    if (!adminKey) return res.status(400).json({ error: "No key provided." });
    
    if (adminKey.startsWith('sk-ant-api')) {
        return res.status(400).json({
            error: 'This is a regular API key, not an Admin key. Admin keys start with sk-ant-admin and can be created at console.anthropic.com → Settings → Admin Keys.'
        });
    }
    if (!adminKey.startsWith('sk-ant-admin')) {
        return res.status(400).json({
            error: "This doesn't look like an Anthropic Admin API key. Admin keys start with sk-ant-admin."
        });
    }

    try {
        const testRes = await fetch('https://api.anthropic.com/v1/organizations/me', {
            headers: { 'x-api-key': adminKey, 'anthropic-version': '2023-06-01' }
        });

        if (!testRes.ok) {
            if (testRes.status === 401) return res.status(401).json({ error: 'This key was rejected by Anthropic. It may be expired, revoked, or invalid.' });
            if (testRes.status === 403) return res.status(403).json({ error: 'Access denied. Only organization admins can create Admin API keys.' });
            const errBody = await testRes.text();
            return res.status(testRes.status).json({ error: `Anthropic rejected key: ${errBody}` });
        }

        const orgData = await testRes.json() as any;
        const encryptedKey = encrypt(adminKey);

        const db = getDb();
        db.prepare(`
            INSERT INTO usage_sync_configs (id, display_name, admin_key_enc, status, org_id, org_name, updated_at)
            VALUES (?, ?, ?, 'active', ?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(id) DO UPDATE SET
            admin_key_enc = excluded.admin_key_enc,
            status = 'active',
            org_id = excluded.org_id,
            org_name = excluded.org_name,
            error_count = 0, last_error = NULL, updated_at = CURRENT_TIMESTAMP
        `).run('anthropic', 'Anthropic', encryptedKey, orgData.id, orgData.name);

        await usageSyncManager.refreshConfig('anthropic');
        res.json({ success: true, orgName: orgData.name, message: `Connected to Anthropic: ${orgData.name}.` });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

// OpenAI
router.post('/providers/openai/key', async (req, res) => {
    const { adminKey } = req.body;
    if (!adminKey) return res.status(400).json({ error: "No key provided." });

    if (adminKey.startsWith('sk-proj-')) {
        return res.status(400).json({
            error: 'This is a project API key, not an Admin key. Admin keys start with sk-admin- and are created at platform.openai.com/settings/organization/admin-keys.'
        });
    }
    if (adminKey.startsWith('sk-ant-')) {
        return res.status(400).json({
            error: 'This is an Anthropic key, not an OpenAI key. Use the Anthropic card instead.'
        });
    }
    if (!adminKey.startsWith('sk-admin-')) {
        return res.status(400).json({
            error: "This doesn't look like an OpenAI Admin API key. Admin keys start with sk-admin- and are created at platform.openai.com/settings/organization/admin-keys. Note: only Organization Owners can create Admin keys."
        });
    }

    try {
        const testRes = await fetch('https://api.openai.com/v1/organization/admin_api_keys?limit=1', {
            headers: { 'Authorization': `Bearer ${adminKey}` }
        });

        if (!testRes.ok) {
            if (testRes.status === 401) return res.status(401).json({ error: 'This key was rejected by OpenAI. It may be expired, revoked, or invalid.' });
            if (testRes.status === 403) return res.status(403).json({ error: 'Access denied. Only Organization Owners can use Admin API keys.' });
            const errBody = await testRes.text();
            return res.status(testRes.status).json({ error: `OpenAI rejected key: ${errBody}` });
        }

        const encryptedKey = encrypt(adminKey);
        const db = getDb();
        db.prepare(`
            INSERT INTO usage_sync_configs (id, display_name, admin_key_enc, status, updated_at)
            VALUES (?, ?, ?, 'active', CURRENT_TIMESTAMP)
            ON CONFLICT(id) DO UPDATE SET
            admin_key_enc = excluded.admin_key_enc,
            status = 'active',
            error_count = 0, last_error = NULL, updated_at = CURRENT_TIMESTAMP
        `).run('openai', 'OpenAI', encryptedKey);

        await usageSyncManager.refreshConfig('openai');
        res.json({ success: true, message: 'Connected to OpenAI. Usage data will appear shortly.' });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Remove Key 
// ─────────────────────────────────────────────────────────────────────────────
router.delete('/providers/:id/key', async (req, res) => {
    const { id } = req.params;
    const db = getDb();
    db.prepare("UPDATE usage_sync_configs SET admin_key_enc = NULL, status = 'inactive', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(id);
    await usageSyncManager.refreshConfig(id);
    res.json({ success: true, message: `${id} sync disconnected. Historical data preserved.` });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Usage — Today (Aggregated)
// ─────────────────────────────────────────────────────────────────────────────
router.get('/usage/today', (req, res) => {
    const db = getDb();
    const today = new Date().toISOString().split('T')[0];
    const provider = req.query.provider as string;

    const whereClause = provider ? `WHERE provider = ? AND date(bucket_start) = ?` : `WHERE date(bucket_start) = ?`;
    const params = provider ? [provider, today] : [today];

    const models = db.prepare(`
        SELECT 
            provider, model,
            SUM(input_tokens) as input_tokens,
            SUM(output_tokens) as output_tokens,
            SUM(cache_read_tokens) as cache_read_tokens,
            SUM(num_requests) as num_requests,
            SUM(COALESCE(cost_usd, 0)) as cost_usd
        FROM usage_records
        ${whereClause}
        GROUP BY provider, model
        ORDER BY cost_usd DESC
    `).all(...params);

    const totalCost = (models as any[]).reduce((sum, m) => sum + m.cost_usd, 0);
    
    // Group by provider for breakdown
    const providers: Record<string, number> = {};
    (models as any[]).forEach(m => {
        providers[m.provider] = (providers[m.provider] || 0) + m.cost_usd;
    });

    res.json({ total: totalCost, providers, models });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. Usage — Daily totals (Aggregated)
// ─────────────────────────────────────────────────────────────────────────────
router.get('/usage/daily', (req, res) => {
    const days = Math.min(parseInt(req.query.days as string) || 30, 90);
    const providerFilter = req.query.provider as string;
    const db = getDb();

    const whereClause = providerFilter ? `WHERE provider = ? AND bucket_start >= date('now', ?)` : `WHERE bucket_start >= date('now', ?)`;
    const params = providerFilter ? [providerFilter, `-${days} days`] : [`-${days} days`];

    const rows = db.prepare(`
        SELECT
            date(bucket_start) as date,
            provider,
            SUM(COALESCE(cost_usd, 0)) as cost_usd
        FROM usage_records
        ${whereClause}
        GROUP BY date(bucket_start), provider
        ORDER BY date ASC
    `).all(...params) as any[];

    // Fill in missing days and stack by provider
    const result: any[] = [];
    const rowMap = new Map<string, any>();
    
    for (const row of rows) {
        if (!rowMap.has(row.date)) rowMap.set(row.date, { date: row.date });
        const entry = rowMap.get(row.date);
        entry[row.provider] = row.cost_usd;
        entry.total = (entry.total || 0) + row.cost_usd;
    }

    for (let i = days - 1; i >= 0; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        const dateStr = d.toISOString().split('T')[0];
        result.push(rowMap.get(dateStr) || { date: dateStr, total: 0 });
    }

    res.json(result);
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. Usage — By model (Aggregated)
// ─────────────────────────────────────────────────────────────────────────────
router.get('/usage/by-model', (req, res) => {
    const days = Math.min(parseInt(req.query.days as string) || 7, 90);
    const providerFilter = req.query.provider as string;
    const db = getDb();

    const whereClause = providerFilter ? `WHERE provider = ? AND bucket_start >= date('now', ?)` : `WHERE bucket_start >= date('now', ?)`;
    const params = providerFilter ? [providerFilter, `-${days} days`] : [`-${days} days`];

    const rows = db.prepare(`
        SELECT
            provider, model,
            SUM(input_tokens) as input_tokens,
            SUM(output_tokens) as output_tokens,
            SUM(cache_read_tokens) as cache_read_tokens,
            SUM(num_requests) as num_requests,
            SUM(COALESCE(cost_usd, 0)) as cost_usd
        FROM usage_records
        ${whereClause}
        GROUP BY provider, model
        ORDER BY cost_usd DESC
    `).all(...params) as any[];

    const totalCost = rows.reduce((sum, r) => sum + (r.cost_usd || 0), 0);
    const enriched = rows.map((r) => ({
        ...r,
        pct_of_total: totalCost > 0 ? Math.round((r.cost_usd / totalCost) * 100) : 0
    }));

    res.json(enriched);
});

export default router;
