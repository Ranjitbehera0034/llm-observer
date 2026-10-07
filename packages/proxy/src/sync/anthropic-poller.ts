import { getDb, decrypt } from '@llm-observer/database';
import fetch from 'node-fetch';
import { BudgetService } from '../services/budget.service';
import { SyncShapeError, normalizeAnthropicUsage, normalizeAnthropicCost } from './response-shapes';

const CIRCUIT_BREAKER_THRESHOLD = 10;
const MAX_BACKOFF_SECONDS = 300;
const BASE_INTERVAL_SECONDS = 60;

/** Typed error to carry HTTP status codes through the error handler */
class AnthropicAPIError extends Error {
    constructor(public readonly statusCode: number, message: string) {
        super(message);
        this.name = 'AnthropicAPIError';
    }
}

export class AnthropicPoller {
    private config: any;
    private timer: NodeJS.Timeout | null = null;
    private isPolling: boolean = false;

    constructor(config: any) {
        this.config = config;
    }

    start() {
        this.poll();
    }

    stop() {
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = null;
        }
    }

    private async poll() {
        if (this.isPolling) return;
        this.isPolling = true;

        let nextDelayMs = (this.config.poll_interval_seconds || BASE_INTERVAL_SECONDS) * 1000;

        try {
            const db = getDb();
            // Re-fetch config to ensure we have the latest status/key
            const latestConfig = db.prepare("SELECT * FROM usage_sync_configs WHERE id = 'anthropic'").get() as any;
            if (!latestConfig || latestConfig.status !== 'active' || !latestConfig.admin_key_enc) {
                this.isPolling = false;
                return;
            }

            // Circuit breaker: stop permanently after too many consecutive errors
            if (latestConfig.error_count >= CIRCUIT_BREAKER_THRESHOLD) {
                console.error('[AnthropicPoller] Circuit breaker tripped after 10 consecutive errors. Stopping poller.');
                this.stopWithError(db, 'Sync paused after 10 consecutive failures. Visit the Sync page to retry.');
                this.isPolling = false;
                return;
            }

            const apiKey = decrypt(latestConfig.admin_key_enc);

            // Phase 1 — Determine time range from checkpoint
            const checkpoint = db.prepare("SELECT * FROM poll_checkpoints WHERE provider = 'anthropic'").get() as any;
            const startingAt = checkpoint?.last_usage_bucket || new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

            // Phase 2 — Fetch usage report
            await this.syncUsage(apiKey, startingAt);

            // Phase 3 — Fetch cost report
            const costStartDate = checkpoint?.last_cost_date || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
            await this.syncCost(apiKey, costStartDate);

            // Phase 4 — Update success state
            db.prepare("UPDATE usage_sync_configs SET last_poll_at = CURRENT_TIMESTAMP, error_count = 0, last_error = NULL, status = 'active' WHERE id = 'anthropic'").run();

            // v1.4.0: Trigger budget evaluation after data refresh
            await BudgetService.evaluateAll();

        } catch (err: any) {
            console.error(`[AnthropicPoller] Poll failed:`, err.message);
            nextDelayMs = this.handleError(err);
        } finally {
            this.isPolling = false;
            // Only schedule next poll if timer hasn't been cleared (e.g., by stopWithError)
            if (this.timer !== null || this.timer === null) {
                this.timer = setTimeout(() => this.poll(), nextDelayMs);
            }
        }
    }

    private async syncUsage(apiKey: string, startingAt: string) {
        const db = getDb();
        let nextCursor: string | null = null;
        let latestBucket = startingAt;

        const upsert = db.prepare(`
            INSERT INTO usage_records 
            (provider, model, bucket_start, bucket_width, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, num_requests, raw_json, api_key_id, workspace_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(provider, model, bucket_start, COALESCE(api_key_id, ''), COALESCE(workspace_id, '')) DO UPDATE SET
            input_tokens = excluded.input_tokens,
            output_tokens = excluded.output_tokens,
            cache_read_tokens = excluded.cache_read_tokens,
            cache_write_tokens = excluded.cache_write_tokens,
            num_requests = excluded.num_requests,
            raw_json = excluded.raw_json
        `);

        do {
            let url = `https://api.anthropic.com/v1/organizations/usage_report/messages?starting_at=${encodeURIComponent(startingAt)}&bucket_width=1d&group_by[]=model`;
            if (nextCursor) url += `&page=${encodeURIComponent(nextCursor)}`;

            const res = await fetch(url, {
                headers: {
                    'x-api-key': apiKey,
                    'anthropic-version': '2023-06-01'
                }
            });

            if (!res.ok) {
                const body = await res.text();
                const retryAfter = res.headers.get('retry-after');
                const err = new AnthropicAPIError(res.status, `HTTP ${res.status}: ${body}`);
                (err as any).retryAfter = retryAfter ? parseInt(retryAfter, 10) : null;
                throw err;
            }

            const data = await res.json() as any;
            // Throws SyncShapeError before anything is written if the response is not a known shape.
            const records = normalizeAnthropicUsage(data);

            db.transaction(() => {
                for (const rec of records) {
                    upsert.run(
                        'anthropic', rec.model, rec.bucketStart, '1d',
                        rec.inputTokens, rec.outputTokens, rec.cacheReadTokens, rec.cacheWriteTokens, rec.numRequests,
                        JSON.stringify(rec.raw),
                        null, null
                    );
                }
            })();

            for (const rec of records) {
                if (new Date(rec.bucketStart) > new Date(latestBucket)) {
                    latestBucket = rec.bucketStart;
                }
            }

            // Update checkpoint after each page so partial progress is preserved
            if (latestBucket !== startingAt) {
                db.prepare("INSERT OR REPLACE INTO poll_checkpoints (provider, last_usage_bucket, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)")
                    .run('anthropic', latestBucket);
            }

            nextCursor = data.has_more ? data.next_page : null;
        } while (nextCursor);
    }

    private async syncCost(apiKey: string, startingAt: string) {
        const db = getDb();
        const endingAt = new Date().toISOString().split('T')[0];
        let nextCursor: string | null = null;
        let latestCostDate = startingAt;

        // Each cost row is set from the whole day's figure (SET, never "+="), so re-fetching a day
        // is harmless. Only the NULL-key rows the usage sync writes are touched.
        const setCost = db.prepare(`
            UPDATE usage_records
            SET cost_usd = ?
            WHERE provider = 'anthropic' 
              AND model = ?
              AND date(bucket_start) = ?
              AND bucket_width = '1d'
              AND COALESCE(api_key_id, '') = ''
              AND COALESCE(workspace_id, '') = ''
        `);

        do {
            // The documented date-time format is RFC 3339; the checkpoint is stored as a bare date.
            const start = /^\d{4}-\d{2}-\d{2}$/.test(startingAt) ? `${startingAt}T00:00:00Z` : startingAt;
            let url = `https://api.anthropic.com/v1/organizations/cost_report?starting_at=${encodeURIComponent(start)}&ending_at=${encodeURIComponent(endingAt)}&group_by[]=description`;
            if (nextCursor) url += `&page=${encodeURIComponent(nextCursor)}`;

            const res = await fetch(url, {
                headers: {
                    'x-api-key': apiKey,
                    'anthropic-version': '2023-06-01'
                }
            });

            if (!res.ok) {
                // Cost sync failure is non-fatal — log and continue
                console.warn(`[AnthropicPoller] Cost report fetch failed (${res.status}). Will retry next cycle.`);
                return;
            }

            const data = await res.json() as any;
            // A day's cost arrives as several rows (one per token type); normalisation sums them
            // and converts the documented cents to USD.
            const costs = normalizeAnthropicCost(data);

            db.transaction(() => {
                for (const c of costs) setCost.run(c.usd, c.model, c.date);
            })();
            for (const c of costs) {
                if (c.date > latestCostDate) latestCostDate = c.date;
            }

            nextCursor = data.has_more ? data.next_page : null;
        } while (nextCursor);

        // Update cost checkpoint
        if (latestCostDate !== startingAt) {
            db.prepare("INSERT OR REPLACE INTO poll_checkpoints (provider, last_cost_date, last_usage_bucket, updated_at) VALUES (?, ?, COALESCE((SELECT last_usage_bucket FROM poll_checkpoints WHERE provider = ?), ''), CURRENT_TIMESTAMP)")
                .run('anthropic', latestCostDate, 'anthropic');
        }
    }

    /**
     * Handles a poll error, updates DB state, and returns the delay in ms before the next retry.
     * For fatal errors (401/403) it calls stopWithError() and returns Infinity.
     */
    private handleError(err: any): number {
        const db = getDb();
        const statusCode = err instanceof AnthropicAPIError ? err.statusCode : 0;

        // A response we cannot read will not read better on retry. Stop with a visible error: an
        // 'error' status also stops budgets treating this provider as covered by sync.
        if (err instanceof SyncShapeError) {
            this.stopWithError(db, `${err.message}. Anthropic may have changed its API; nothing was stored.`);
            return Infinity;
        }

        // Fatal errors — stop the poller permanently
        if (statusCode === 401) {
            this.stopWithError(db, 'Your admin key was rejected by Anthropic. It may have been revoked or is invalid. Please update it in the Sync settings.');
            return Infinity;
        }
        if (statusCode === 403) {
            this.stopWithError(db, 'Access denied. Your account may not have admin permissions to read usage data.');
            return Infinity;
        }

        // Increment error count
        const result = db.prepare("UPDATE usage_sync_configs SET error_count = error_count + 1, last_error = ? WHERE id = 'anthropic' RETURNING error_count")
            .get(err.message) as any;
        const errorCount = result?.error_count || 1;

        // Circuit breaker pre-check
        if (errorCount >= CIRCUIT_BREAKER_THRESHOLD) {
            this.stopWithError(db, 'Sync paused after 10 consecutive failures. Visit the Sync page to retry.');
            return Infinity;
        }

        // 429 — use Retry-After header if available
        if (statusCode === 429 && err.retryAfter) {
            const retryMs = err.retryAfter * 1000;
            console.warn(`[AnthropicPoller] Rate limited. Retrying after ${err.retryAfter}s.`);
            return retryMs;
        }

        // Exponential backoff with ±20% jitter
        const baseSeconds = this.config.poll_interval_seconds || BASE_INTERVAL_SECONDS;
        const backoffSeconds = Math.min(baseSeconds * Math.pow(2, errorCount - 1), MAX_BACKOFF_SECONDS);
        const jitter = backoffSeconds * 0.2 * (Math.random() * 2 - 1); // ±20%
        const finalSeconds = Math.max(baseSeconds, backoffSeconds + jitter);
        console.warn(`[AnthropicPoller] Error #${errorCount}. Retrying in ${Math.round(finalSeconds)}s.`);
        return finalSeconds * 1000;
    }

    private stopWithError(db: any, message: string) {
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = null;
        }
        db.prepare("UPDATE usage_sync_configs SET status = 'error', last_error = ? WHERE id = 'anthropic'").run(message);
        console.error(`[AnthropicPoller] Stopped with error: ${message}`);
    }
}
