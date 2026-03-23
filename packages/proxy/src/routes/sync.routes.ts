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
// 2. Add/Update Anthropic Key — with better per-status-code error messages
// ─────────────────────────────────────────────────────────────────────────────
router.post('/providers/anthropic/key', async (req, res) => {
    const { adminKey } = req.body;

    // Client-side-style prefix validation on the server too
    if (!adminKey) {
        return res.status(400).json({ error: "No key provided." });
    }
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
            headers: {
                'x-api-key': adminKey,
                'anthropic-version': '2023-06-01'
            }
        });

        if (!testRes.ok) {
            if (testRes.status === 401) {
                return res.status(401).json({ error: 'This key was rejected by Anthropic. It may be expired, revoked, or invalid.' });
            }
            if (testRes.status === 403) {
                return res.status(403).json({ error: 'Access denied. Your account may not have admin permissions. Only organization admins can create Admin API keys.' });
            }
            if (testRes.status === 429) {
                return res.status(429).json({ error: "Anthropic's API is rate limiting us right now. Please try again in a minute." });
            }
            if (testRes.status >= 500) {
                return res.status(502).json({ error: "Anthropic's API is temporarily unavailable. Please try again in a few minutes." });
            }
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
            error_count = 0,
            last_error = NULL,
            updated_at = CURRENT_TIMESTAMP
        `).run('anthropic', 'Anthropic', encryptedKey, orgData.id, orgData.name);

        await usageSyncManager.refreshConfig('anthropic');

        res.json({
            success: true,
            orgName: orgData.name,
            message: `Connected to organization: ${orgData.name}. Usage data will appear within 60 seconds.`
        });

    } catch (err: any) {
        if (err.code === 'ENOTFOUND' || err.code === 'ECONNREFUSED' || err.code === 'ETIMEDOUT') {
            return res.status(503).json({ error: 'Cannot reach Anthropic. Check your internet connection.' });
        }
        res.status(500).json({ error: err.message });
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Remove Key — stops poller, NULLs key, preserves historical records
// ─────────────────────────────────────────────────────────────────────────────
router.delete('/providers/:id/key', async (req, res) => {
    const { id } = req.params;
    const db = getDb();
    db.prepare("UPDATE usage_sync_configs SET admin_key_enc = NULL, status = 'inactive', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(id);
    await usageSyncManager.refreshConfig(id);
    res.json({ success: true, message: 'Anthropic sync disconnected. Historical data preserved.' });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Usage — Today (by model)
// ─────────────────────────────────────────────────────────────────────────────
router.get('/usage/today', (req, res) => {
    const db = getDb();
    const today = new Date().toISOString().split('T')[0];

    const usage = db.prepare(`
        SELECT 
            model,
            SUM(input_tokens) as input_tokens,
            SUM(output_tokens) as output_tokens,
            SUM(cache_read_tokens) as cache_read_tokens,
            SUM(num_requests) as num_requests,
            SUM(COALESCE(cost_usd, 0)) as cost_usd
        FROM usage_records
        WHERE provider = 'anthropic' AND date(bucket_start) = ?
        GROUP BY model
        ORDER BY cost_usd DESC
    `).all(today);

    res.json(usage);
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. Usage — Daily totals for bar chart (last N days)
// ─────────────────────────────────────────────────────────────────────────────
router.get('/usage/daily', (req, res) => {
    const days = Math.min(parseInt(req.query.days as string) || 30, 90);
    const db = getDb();

    const rows = db.prepare(`
        SELECT
            date(bucket_start) as date,
            SUM(COALESCE(cost_usd, 0)) as cost_usd,
            SUM(input_tokens + output_tokens) as total_tokens,
            SUM(num_requests) as num_requests
        FROM usage_records
        WHERE provider = 'anthropic'
          AND bucket_start >= date('now', ?)
        GROUP BY date(bucket_start)
        ORDER BY date ASC
    `).all(`-${days} days`) as any[];

    // Fill in missing days with zeros so the chart always has N data points
    const result: { date: string; cost_usd: number; total_tokens: number; num_requests: number }[] = [];
    const rowMap = new Map(rows.map((r) => [r.date, r]));

    for (let i = days - 1; i >= 0; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        const dateStr = d.toISOString().split('T')[0];
        result.push(rowMap.get(dateStr) || { date: dateStr, cost_usd: 0, total_tokens: 0, num_requests: 0 });
    }

    res.json(result);
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. Usage — By model (last N days)
// ─────────────────────────────────────────────────────────────────────────────
router.get('/usage/by-model', (req, res) => {
    const days = Math.min(parseInt(req.query.days as string) || 7, 90);
    const db = getDb();

    const rows = db.prepare(`
        SELECT
            model,
            SUM(input_tokens) as input_tokens,
            SUM(output_tokens) as output_tokens,
            SUM(cache_read_tokens) as cache_read_tokens,
            SUM(num_requests) as num_requests,
            SUM(COALESCE(cost_usd, 0)) as cost_usd
        FROM usage_records
        WHERE provider = 'anthropic'
          AND bucket_start >= date('now', ?)
        GROUP BY model
        ORDER BY cost_usd DESC
    `).all(`-${days} days`) as any[];

    // Compute % of total
    const totalCost = rows.reduce((sum, r) => sum + (r.cost_usd || 0), 0);
    const enriched = rows.map((r) => ({
        ...r,
        pct_of_total: totalCost > 0 ? Math.round((r.cost_usd / totalCost) * 100) : 0
    }));

    res.json(enriched);
});

export default router;
