import { Request, Response, NextFunction } from 'express';

interface TokenBucket {
    tokens: number;
    lastRefilled: number;
}

// In-memory buckets partitioned by project_id
const buckets: Record<string, TokenBucket> = {};

// Default Rate Limit parameters (can be moved to DB settings later)
const MAX_BURST_CAPACITY = 100; // max 100 requests burst
const REFILL_RATE = 100; // 100 tokens per minute
const REFILL_INTERVAL_MS = 60000;

export const rateLimitGuard = (req: Request, res: Response, next: NextFunction) => {
    // Rely on project_id resolved by budgetGuard which runs right before this
    const key = (req as any).projectId || req.ip || 'anonymous';

    const now = Date.now();
    let bucket = buckets[key];

    if (!bucket) {
        bucket = { tokens: MAX_BURST_CAPACITY, lastRefilled: now };
        buckets[key] = bucket;
    }

    // Refill tokens calculation based on elapsed time
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
