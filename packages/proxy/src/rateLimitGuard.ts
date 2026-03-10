import { Request, Response, NextFunction } from 'express';
import { getDb } from '@llm-observer/database';

interface TokenBucket {
    tokens: number;
    lastRefilled: number;
}

// In-memory buckets partitioned by project_id
const buckets: Record<string, TokenBucket> = {};

// FIX BUG-03: Rate limit config — load from DB settings if available
const MAX_BURST_CAPACITY = 100;
const REFILL_RATE = 100;        // 100 tokens per minute
const REFILL_INTERVAL_MS = 60_000;

// FIX BUG-03: Restore persisted state from DB on startup
const loadBucketsFromDb = () => {
    try {
        const db = getDb();
        const row = db.prepare("SELECT value FROM settings WHERE key = 'rate_limit_state'").get() as any;
        if (row?.value) {
            const saved = JSON.parse(row.value) as Record<string, TokenBucket>;
            const now = Date.now();
            for (const [key, bucket] of Object.entries(saved)) {
                // Only restore if saved within last 2 minutes (otherwise stale)
                if (now - bucket.lastRefilled < 120_000) {
                    buckets[key] = bucket;
                }
            }
        }
    } catch (e) { /* DB may not be ready yet; silent fail is safe */ }
};

// FIX BUG-03: Persist buckets to DB every 30 seconds
const saveBucketsToDb = () => {
    try {
        const db = getDb();
        // Only persist depleted buckets (< 50% capacity) to avoid unnecessary writes
        const toSave: Record<string, TokenBucket> = {};
        for (const [key, bucket] of Object.entries(buckets)) {
            if (bucket.tokens < MAX_BURST_CAPACITY * 0.5) {
                toSave[key] = bucket;
            }
        }
        db.prepare("INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES ('rate_limit_state', ?, CURRENT_TIMESTAMP)")
            .run(JSON.stringify(toSave));
    } catch (e) { /* Silent fail — rate limit persistence is best-effort */ }
};

// Schedule persistence
setTimeout(() => {
    loadBucketsFromDb();
    setInterval(saveBucketsToDb, 30_000);
}, 2000); // Delay 2s to wait for DB init

export const rateLimitGuard = (req: Request, res: Response, next: NextFunction) => {
    // Rely on project_id resolved by budgetGuard which runs right before this
    const key = (req as any).projectId || req.ip || 'anonymous';

    const now = Date.now();
    let bucket = buckets[key];

    if (!bucket) {
        bucket = { tokens: MAX_BURST_CAPACITY, lastRefilled: now };
        buckets[key] = bucket;
    }

    // Refill tokens based on elapsed time
    const timePassedMs = now - bucket.lastRefilled;
    if (timePassedMs > 0) {
        const tokensToAdd = (timePassedMs / REFILL_INTERVAL_MS) * REFILL_RATE;
        bucket.tokens = Math.min(MAX_BURST_CAPACITY, bucket.tokens + tokensToAdd);
        bucket.lastRefilled = now;
    }

    // Attempt token decrement
    if (bucket.tokens >= 1) {
        bucket.tokens -= 1;
        next();
    } else {
        res.status(429).json({
            error: {
                message: 'Rate limit exceeded. Too many requests in short succession.',
                type: 'rate_limited',
                code: 429
            }
        });
    }
};
