import { getDb, updateSetting } from '@llm-observer/database';
import { BudgetService } from './services/budget.service';
import { currentLicencePlan, getTeamConfig, refreshTeamPolicy, type TeamConfig } from './services/teamPolicy';

/**
 * SyncManager handles periodic data push from local SQLite to the Team Cloud server and pulls the team
 * budget policy back (see services/teamPolicy.ts).
 *
 * Only aggregated daily stats are pushed. Raw request logs, prompts, responses, file paths, sessions and
 * API keys stay local. Everything here requires a Team licence: without one nothing is sent or fetched
 * and team-sourced budgets are removed.
 */
export class SyncManager {
    private interval: NodeJS.Timeout | null = null;
    private isSyncing: boolean = false;

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
            const cfg = getTeamConfig();
            // Push first (when joined and licensed), then pull the policy. Either may fail without affecting the other.
            if (cfg && (await currentLicencePlan()) === 'team') {
                await this.pushAggregates(cfg);
            }
            const policy = await refreshTeamPolicy();
            if (policy.outcome === 'applied') {
                // Alert-type team budgets raise alerts through the same evaluation as local ones.
                await BudgetService.evaluateAll().catch((err: any) => console.error('[SyncManager] Budget evaluation failed:', err?.message || err));
            }
        } catch (err) {
            console.error('[SyncManager] Sync execution error:', err);
        } finally {
            this.isSyncing = false;
        }
    }

    private async pushAggregates(cfg: TeamConfig) {
        const db = getDb();
        try {
            // We sync everything that hasn't been synced in the last hour or has synced_at as null
            const unsyncedStats = db.prepare(`
        SELECT s.*, p.name as project_name
        FROM daily_stats s
        JOIN projects p ON s.project_id = p.id
        WHERE s.synced_at IS NULL OR s.synced_at < datetime('now', '-1 hour')
      `).all() as any[];

            if (unsyncedStats.length === 0) return;

            console.log(`[SyncManager] Syncing aggregated stats for team ${cfg.teamId ?? ''}...`);

            const payload = {
                team_api_key: cfg.apiKey,
                member_email: cfg.memberEmail,
                stats: unsyncedStats.map(s => ({
                    date: s.date,
                    provider: s.provider,
                    model: s.model,
                    project_name: s.project_name,
                    total_requests: s.total_requests,
                    total_tokens: s.total_tokens,
                    total_cost_usd: s.total_cost_usd,
                    avg_latency_ms: s.avg_latency_ms ?? 0,
                    error_count: s.error_count ?? 0,
                    blocked_count: s.blocked_count ?? 0
                }))
            };

            const response = await fetch(`${cfg.serverUrl}/api/team/sync`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
                redirect: 'error',
                signal: AbortSignal.timeout(30_000),
            });

            if (response.ok) {
                const result = (await response.json()) as any;
                console.log(`[SyncManager] Successfully synced ${result.synced_count} records`);

                const updateStmt = db.prepare("UPDATE daily_stats SET synced_at = datetime('now') WHERE id = ?");
                const transaction = db.transaction((ids: number[]) => {
                    for (const id of ids) updateStmt.run(id);
                });
                transaction(unsyncedStats.map(s => s.id));

                updateSetting('last_team_sync_at', new Date().toISOString());
                updateSetting('team_sync_error', '');
            } else {
                const error = (await response.text()).slice(0, 200);
                console.error(`[SyncManager] Sync failed: ${response.status} ${error}`);
                updateSetting('team_sync_error', `the team server answered ${response.status}`);
            }
        } catch (err: any) {
            console.error('[SyncManager] Sync execution error:', err?.message || err);
            try { updateSetting('team_sync_error', `could not reach the team server (${err?.cause?.code || err?.name || 'error'})`); } catch { /* ignore */ }
        }
    }
}

export const syncManager = new SyncManager();
