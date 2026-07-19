import { getDb } from '../db';

export type CompareDimension = 'model' | 'provider' | 'tags';

// Explicit allowlist mapping — the SQL column name is always looked up here,
// never built from the caller's string directly, so there is no injection
// surface even though `dimension` ultimately originates from a query param.
const DIMENSION_COLUMN: Record<CompareDimension, string> = {
    model: 'model',
    provider: 'provider',
    tags: 'tags'
};

const isValidDimension = (d: string): d is CompareDimension => d in DIMENSION_COLUMN;

export const getComparisonValues = (dimension: string): string[] => {
    if (!isValidDimension(dimension)) {
        throw new Error(`Invalid comparison dimension: ${dimension}`);
    }
    const db = getDb();
    const col = DIMENSION_COLUMN[dimension];
    const rows = db.prepare(
        `SELECT DISTINCT ${col} as v FROM requests WHERE ${col} IS NOT NULL AND ${col} != '' ORDER BY v`
    ).all() as any[];
    return rows.map((r) => r.v);
};

export interface ComparisonMetrics {
    n: number;
    costValues: number[];
    latencyValues: number[];
    tokenValues: number[];
    errorCount: number;
}

export const getComparisonMetrics = (dimension: string, value: string, sinceIso: string): ComparisonMetrics => {
    if (!isValidDimension(dimension)) {
        throw new Error(`Invalid comparison dimension: ${dimension}`);
    }
    const db = getDb();
    const col = DIMENSION_COLUMN[dimension];
    const rows = db.prepare(`
        SELECT cost_usd, latency_ms, total_tokens, status
        FROM requests
        WHERE ${col} = ? AND created_at >= ?
    `).all(value, sinceIso) as any[];

    return {
        n: rows.length,
        costValues: rows.map((r) => r.cost_usd || 0),
        latencyValues: rows.filter((r) => r.latency_ms != null).map((r) => r.latency_ms),
        tokenValues: rows.filter((r) => r.total_tokens != null).map((r) => r.total_tokens),
        errorCount: rows.filter((r) => r.status === 'error').length
    };
};
