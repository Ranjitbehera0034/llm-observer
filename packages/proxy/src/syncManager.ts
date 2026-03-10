import { getDb } from '@llm-observer/database';
import fetch from 'node-fetch';

/**
 * SyncManager handles periodic data push from local SQLite to the Team Cloud server.
 * Only aggregated daily stats are synced. Raw request logs, prompts, and keys stay local.
 */
export class SyncManager {
    private interval: NodeJS.Timeout | null = null;
    private isSyncing: boolean = false;
    private teamServerUrl: string = process.env.TEAM_SERVER_URL || 'http://localhost:4002';

    start(intervalMs: number = 15 * 60 * 1000) {
        this.stop();
        console.log(`[SyncManager] Starting background sync every ${intervalMs / 1000 / 60} minutes`);
        this.interval = setInterval(() => this.sync(), intervalMs);
        // Initial sync after 30 seconds
        setTimeout(() => this.sync(), 30000);
    }

    stop() {
        if (this.interval) {
            clearInterval(this.interval);
            this.interval = null;
        }
    }

    async sync() {
        if (this.isSyncing) return;
        this.isSyncing = true;

        try {
            const db = getDb();

            // 1. Get Settings
            const getSetting = (key: string) => db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;

            const teamId = getSetting('team_id')?.value;
            const teamApiKey = getSetting('team_api_key')?.value;
            const memberEmail = getSetting('team_member_email')?.value;
            const syncEnabled = getSetting('team_sync_enabled')?.value === 'true';

            if (!syncEnabled || !teamApiKey || !memberEmail) {
                // console.log('[SyncManager] Sync disabled or missing configuration');
                this.isSyncing = false;
                return;
            }

            console.log(`[SyncManager] Syncing aggregated stats for team ${teamId}...`);

            // 2. Query unsynced daily stats
            // We sync everything that hasn't been synced in the last hour or has synced_at as null
            const unsyncedStats = db.prepare(`
        SELECT s.*, p.name as project_name 
        FROM daily_stats s
        JOIN projects p ON s.project_id = p.id
        WHERE s.synced_at IS NULL OR s.synced_at < datetime('now', '-1 hour')
      `).all() as any[];

            if (unsyncedStats.length === 0) {
                // console.log('[SyncManager] No new stats to sync');
                this.isSyncing = false;
                return;
            }

            // 3. Push to Team Server
            const payload = {
                team_api_key: teamApiKey,
                member_email: memberEmail,
                stats: unsyncedStats.map(s => ({
                    date: s.date,
                    provider: s.provider,
                    model: s.model,
                    project_name: s.project_name,
                    total_requests: s.total_requests,
                    total_tokens: s.total_tokens,
                    total_cost_usd: s.total_cost_usd,
                    avg_latency_ms: s.avg_latency_ms,
                    error_count: s.error_count,
                    blocked_count: s.blocked_count
                }))
            };

            const response = await fetch(`${this.teamServerUrl}/api/team/sync`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            if (response.ok) {
                const result = (await response.json()) as any;
                console.log(`[SyncManager] Successfully synced ${result.synced_count} records`);

                // 4. Update local synced_at
                const updateStmt = db.prepare("UPDATE daily_stats SET synced_at = datetime('now') WHERE id = ?");
                const transaction = db.transaction((ids: number[]) => {
                    for (const id of ids) updateStmt.run(id);
                });
                transaction(unsyncedStats.map(s => s.id));

                // Update last sync setting
                db.prepare("INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))")
                    .run('last_team_sync_at', new Date().toISOString());

            } else {
                const error = await response.text();
                console.error(`[SyncManager] Sync failed: ${response.status} ${error}`);
            }
        } catch (err) {
            console.error('[SyncManager] Sync execution error:', err);
        } finally {
            this.isSyncing = false;
        }
    }
}

export const syncManager = new SyncManager();
