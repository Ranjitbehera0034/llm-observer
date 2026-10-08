import { getDb, decrypt } from '@llm-observer/database';
import nodeFetch from 'node-fetch';
import { calculateSharedCost } from '../utils/pricing';
import { BudgetService } from '../services/budget.service';
import { SyncShapeError, normalizeOpenAIUsage, normalizeOpenAICost } from './response-shapes';
import { adminBaseUrl, isBaseUrlOverridden, openaiUsageUrl, openaiCostUrl } from './admin-endpoints';

const CIRCUIT_BREAKER_THRESHOLD = 10;
const MAX_BACKOFF_SECONDS = 300;
const BASE_INTERVAL_SECONDS = 60;

/** Typed error to carry HTTP status codes through the error handler */
class OpenAIAPIError extends Error {
    constructor(public readonly statusCode: number, message: string) {
        super(message);
        this.name = 'OpenAIAPIError';
    }
}

/** Injectable pieces, used by scripts/validate-admin-sync.js to record the responses the poller reads. */
export interface OpenAIPollerDeps {
    fetch?: typeof nodeFetch;
}

export class OpenAIPoller {
    private config: any;
    private timer: NodeJS.Timeout | null = null;
    private isPolling: boolean = false;
    private fetch: typeof nodeFetch;
    private warnedBaseUrl = false;

    constructor(config: any, deps: OpenAIPollerDeps = {}) {
        this.config = config;
        this.fetch = deps.fetch ?? nodeFetch;
    }

    /** Base URL for this poll; says so once when it is not the real OpenAI host. */
    private baseUrl(): string {
        const base = adminBaseUrl('openai');
        if (isBaseUrlOverridden('openai') && !this.warnedBaseUrl) {
            this.warnedBaseUrl = true;
            console.warn(`[OpenAIPoller] Using a non-default admin API base URL (${base}).`);
        }
        return base;
    }

    /**
     * One usage + cost sync with explicit start points (Unix seconds), exactly as poll() runs them
     * (same code, same requests), without the config/checkpoint lookup, scheduling or budget
     * evaluation. Errors are thrown to the caller. Used by the live-key validator.
     */
    async syncOnce(apiKey: string, range: { usageStart: number; costStart: number }) {
        await this.syncUsage(apiKey, range.usageStart);
        await this.syncCost(apiKey, range.costStart);
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
            const latestConfig = db.prepare("SELECT * FROM usage_sync_configs WHERE id = 'openai'").get() as any;
            if (!latestConfig || latestConfig.status !== 'active' || !latestConfig.admin_key_enc) {
                this.isPolling = false;
                return;
            }

            // Circuit breaker: stop permanently after too many consecutive errors
            if (latestConfig.error_count >= CIRCUIT_BREAKER_THRESHOLD) {
                console.error('[OpenAIPoller] Circuit breaker tripped after 10 consecutive errors. Stopping poller.');
                this.stopWithError(db, 'Sync paused after 10 consecutive failures. Visit the Sync page to retry.');
                this.isPolling = false;
                return;
            }

            const apiKey = decrypt(latestConfig.admin_key_enc);

            // Phase 1 — Determine time range from checkpoint
            const checkpoint = db.prepare("SELECT * FROM poll_checkpoints WHERE provider = 'openai'").get() as any;
            
            // OpenAI requires Unix timestamps in seconds
            const startingAtSeconds = checkpoint?.last_usage_bucket 
                ? Math.floor(new Date(checkpoint.last_usage_bucket).getTime() / 1000)
                : Math.floor((Date.now() - 24 * 60 * 60 * 1000) / 1000);

            // Phase 2 — Fetch usage report (completions)
            await this.syncUsage(apiKey, startingAtSeconds);

            // Phase 3 — Fetch cost report
            // Costs API only supports daily buckets
            const costStartDateSeconds = checkpoint?.last_cost_date
                ? Math.floor(new Date(checkpoint.last_cost_date).getTime() / 1000)
                : Math.floor((Date.now() - 30 * 24 * 60 * 60 * 1000) / 1000);
            
            await this.syncCost(apiKey, costStartDateSeconds);

            // Phase 4 — Update success state
            db.prepare("UPDATE usage_sync_configs SET last_poll_at = CURRENT_TIMESTAMP, error_count = 0, last_error = NULL, status = 'active' WHERE id = 'openai'").run();

            // v1.4.0: Trigger budget evaluation after data refresh
            await BudgetService.evaluateAll();

        } catch (err: any) {
            console.error(`[OpenAIPoller] Poll failed:`, err.message);
            nextDelayMs = this.handleError(err);
        } finally {
            this.isPolling = false;
            // Only schedule next poll if timer hasn't been cleared (e.g., by stopWithError)
            if (this.timer !== null || this.timer === null) {
                this.timer = setTimeout(() => this.poll(), nextDelayMs);
            }
        }
    }

    private async syncUsage(apiKey: string, startingAt: number) {
        const db = getDb();
        let nextCursor: string | null = null;
        let latestBucketStart = startingAt;

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
            const url = openaiUsageUrl(this.baseUrl(), startingAt, nextCursor);

            const res = await this.fetch(url, {
                headers: {
                    'Authorization': `Bearer ${apiKey}`
                }
            });

            if (!res.ok) {
                const body = await res.text();
                const retryAfter = res.headers.get('retry-after');
                const err = new OpenAIAPIError(res.status, `HTTP ${res.status}: ${body}`);
                (err as any).retryAfter = retryAfter ? parseInt(retryAfter, 10) : null;
                throw err;
            }

            const data = await res.json() as any;
            // Throws SyncShapeError before anything is written if the response is not a known shape.
            const { records, latestBucketStart: pageLatest } = normalizeOpenAIUsage(data);

            db.transaction(() => {
                for (const rec of records) {
                    upsert.run(
                        'openai', rec.model, rec.bucketStart, '1d',
                        rec.inputTokens, rec.outputTokens, rec.cacheReadTokens, rec.cacheWriteTokens, rec.numRequests,
                        JSON.stringify(rec.raw),
                        null, null
                    );
                }
            })();

            // Checkpoint on the bucket START so the still-open day is fetched again on the next
            // poll (the upsert makes that safe); the end would skip it until tomorrow.
            if (pageLatest > latestBucketStart) latestBucketStart = pageLatest;

            // Update checkpoint after each page
            if (latestBucketStart !== startingAt) {
                const latestBucketIso = new Date(latestBucketStart * 1000).toISOString();
                db.prepare("INSERT OR REPLACE INTO poll_checkpoints (provider, last_usage_bucket, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)")
                    .run('openai', latestBucketIso);
            }

            nextCursor = data.has_more ? data.next_page : null;
        } while (nextCursor);
    }

    private async syncCost(apiKey: string, startingAt: number) {
        const db = getDb();
        let nextCursor: string | null = null;
        let latestCostTime = startingAt;

        // SET from the whole day's figure, so re-fetching a day is harmless.
        const setCost = db.prepare(`
            UPDATE usage_records
            SET cost_usd = ?
            WHERE provider = 'openai' 
              AND model = ?
              AND date(bucket_start) = ?
              AND bucket_width = '1d'
              AND COALESCE(api_key_id, '') = ''
              AND COALESCE(workspace_id, '') = ''
        `);

        do {
            const url = openaiCostUrl(this.baseUrl(), startingAt, nextCursor);

            const res = await this.fetch(url, {
                headers: {
                    'Authorization': `Bearer ${apiKey}`
                }
            });

            if (!res.ok) {
                if (res.status === 404) {
                    console.warn(`[OpenAIPoller] Costs API returned 404. Falling back to estimated costs from token counts.`);
                    await this.estimateCostsFromUsage(startingAt);
                    return;
                }
                // Cost sync failure is non-fatal — log and continue
                console.warn(`[OpenAIPoller] Cost report fetch failed (${res.status}). Will retry next cycle.`);
                return;
            }

            const data = await res.json() as any;
            // Several line items of one model-day are summed by normalisation.
            const { costs, latestBucketStart } = normalizeOpenAICost(data);

            db.transaction(() => {
                for (const c of costs) setCost.run(c.usd, c.model, c.date);
            })();
            if (latestBucketStart > latestCostTime) latestCostTime = latestBucketStart;

            nextCursor = data.has_more ? data.next_page : null;
        } while (nextCursor);

        // Update cost checkpoint
        if (latestCostTime !== startingAt) {
            const latestCostIso = new Date(latestCostTime * 1000).toISOString();
            db.prepare(`
                INSERT OR REPLACE INTO poll_checkpoints 
                (provider, last_cost_date, last_usage_bucket, updated_at) 
                VALUES (?, ?, COALESCE((SELECT last_usage_bucket FROM poll_checkpoints WHERE provider = ?), ''), CURRENT_TIMESTAMP)
            `).run('openai', latestCostIso, 'openai');
        }
    }

    /**
     * Fallback for when OpenAI Costs API returns 404.
     * Computes estimated costs using local pricing tables.
     */
    private async estimateCostsFromUsage(startingAt: number) {
        const db = getDb();
        const startingIso = new Date(startingAt * 1000).toISOString();

        const records = db.prepare(`
            SELECT * FROM usage_records 
            WHERE provider = 'openai' 
              AND bucket_start >= ? 
              AND cost_usd IS NULL
        `).all(startingIso) as any[];

        for (const rec of records) {
            const { costUsd, unknown } = calculateSharedCost('openai', rec.model, rec.input_tokens, rec.output_tokens);
            if (!unknown) {
                db.prepare("UPDATE usage_records SET cost_usd = ? WHERE id = ?").run(costUsd, rec.id);
            }
        }
    }

    private handleError(err: any): number {
        const db = getDb();
        const statusCode = err instanceof OpenAIAPIError ? err.statusCode : 0;

        // A response we cannot read will not read better on retry. Stop with a visible error: an
        // 'error' status also stops budgets treating this provider as covered by sync.
        if (err instanceof SyncShapeError) {
            this.stopWithError(db, `${err.message}. OpenAI may have changed its API; nothing was stored.`);
            return Infinity;
        }

        // Fatal errors — stop the poller permanently
        if (statusCode === 401) {
            this.stopWithError(db, 'Your OpenAI Admin key was rejected. It may have been revoked or is invalid. Please update it in the Sync settings.');
            return Infinity;
        }
        if (statusCode === 403) {
            this.stopWithError(db, 'Access denied. Only Organization Owners can use Admin keys. Check your role at platform.openai.com/settings/organization/members.');
            return Infinity;
        }

        // Increment error count
        const result = db.prepare("UPDATE usage_sync_configs SET error_count = error_count + 1, last_error = ? WHERE id = 'openai' RETURNING error_count")
            .get(err.message) as any;
        const errorCount = result?.error_count || 1;

        // Circuit breaker pre-check
        if (errorCount >= CIRCUIT_BREAKER_THRESHOLD) {
            this.stopWithError(db, 'Sync paused after 10 consecutive failures. Visit the Sync page to retry.');
            return Infinity;
        }

        // 429 — use Retry-After header if available
        if (statusCode === 429 && err.retryAfter) {
            return err.retryAfter * 1000;
        }

        // Exponential backoff
        const baseSeconds = this.config.poll_interval_seconds || BASE_INTERVAL_SECONDS;
        const backoffSeconds = Math.min(baseSeconds * Math.pow(2, errorCount - 1), MAX_BACKOFF_SECONDS);
        const jitter = backoffSeconds * 0.2 * (Math.random() * 2 - 1);
        return Math.max(baseSeconds, backoffSeconds + jitter) * 1000;
    }

    private stopWithError(db: any, message: string) {
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = null;
        }
        db.prepare("UPDATE usage_sync_configs SET status = 'error', last_error = ? WHERE id = 'openai'").run(message);
        console.error(`[OpenAIPoller] Stopped with error: ${message}`);
    }
}
