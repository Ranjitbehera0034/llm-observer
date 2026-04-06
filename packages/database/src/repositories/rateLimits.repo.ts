import { getDb } from '../db';

export interface RateLimitSnapshot {
    id?: number;
    provider: string;
    window_type: string;
    total_allowed: number | null;
    total_used: number | null;
    utilization_pct: number | null;
    resets_at: string | null;
    is_estimated: boolean;
    captured_at: string;
}

export interface RateLimitConfig {
    id?: number;
    provider: string;
    window_type: string;
    alert_threshold_pct: number;
    plan_type: string | null;
    created_at?: string;
    updated_at?: string;
}

export function insertRateLimitSnapshot(snapshot: Omit<RateLimitSnapshot, 'id'>): void {
    const db = getDb();

    // Deduplication check: get most recent snapshot for this provider & window
    const prevStmt = db.prepare(`
        SELECT utilization_pct FROM rate_limit_snapshots 
        WHERE provider = ? AND window_type = ? 
        ORDER BY captured_at DESC LIMIT 1
    `);
    const prev = prevStmt.get(snapshot.provider, snapshot.window_type) as any;

    if (
        prev && 
        prev.utilization_pct !== null && 
        snapshot.utilization_pct !== null &&
        Math.abs(prev.utilization_pct - snapshot.utilization_pct) < 0.02
    ) {
        // Less than 2% difference, skip inserting
        return;
    }

    const stmt = db.prepare(`
        INSERT INTO rate_limit_snapshots 
        (provider, window_type, total_allowed, total_used, utilization_pct, resets_at, is_estimated, captured_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
        snapshot.provider,
        snapshot.window_type,
        snapshot.total_allowed,
        snapshot.total_used,
        snapshot.utilization_pct,
        snapshot.resets_at,
        snapshot.is_estimated ? 1 : 0,
        snapshot.captured_at
    );
}

export function getLatestSnapshots(provider: string): RateLimitSnapshot[] {
    const db = getDb();
    // Get the latest snapshot for each window type for the given provider
    const stmt = db.prepare(`
        SELECT *
        FROM rate_limit_snapshots t1
        WHERE provider = ?
          AND captured_at = (
            SELECT MAX(captured_at)
            FROM rate_limit_snapshots t2
            WHERE t1.provider = t2.provider AND t1.window_type = t2.window_type
          )
    `);
    const rows = stmt.all(provider) as any[];
    return rows.map(r => ({
        ...r,
        is_estimated: r.is_estimated === 1
    }));
}

export function getSnapshotHistory(provider: string, sinceHours: number = 24): RateLimitSnapshot[] {
    const db = getDb();
    const stmt = db.prepare(`
        SELECT * FROM rate_limit_snapshots
        WHERE provider = ? AND captured_at >= datetime('now', ?)
        ORDER BY captured_at ASC
    `);
    const rows = stmt.all(provider, `-${sinceHours} hours`) as any[];
    return rows.map(r => ({
        ...r,
        is_estimated: r.is_estimated === 1
    }));
}

export function getRateLimitConfig(provider: string, window_type: string): RateLimitConfig | null {
    const db = getDb();
    const stmt = db.prepare('SELECT * FROM rate_limit_config WHERE provider = ? AND window_type = ?');
    const row = stmt.get(provider, window_type) as any;
    return row || null;
}

export function getAllRateLimitConfigs(): RateLimitConfig[] {
    const db = getDb();
    const stmt = db.prepare('SELECT * FROM rate_limit_config');
    return stmt.all() as RateLimitConfig[];
}

export function upsertRateLimitConfig(config: Omit<RateLimitConfig, 'id' | 'created_at' | 'updated_at'>): void {
    const db = getDb();
    const stmt = db.prepare(`
        INSERT INTO rate_limit_config (provider, window_type, alert_threshold_pct, plan_type)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(provider, window_type) DO UPDATE SET
            alert_threshold_pct = excluded.alert_threshold_pct,
            plan_type = excluded.plan_type,
            updated_at = CURRENT_TIMESTAMP
    `);
    stmt.run(config.provider, config.window_type, config.alert_threshold_pct, config.plan_type);
}

export function cleanupOldSnapshots(days: number = 30): void {
    const db = getDb();
    const stmt = db.prepare(`DELETE FROM rate_limit_snapshots WHERE captured_at < datetime('now', ?)`);
    stmt.run(`-${days} days`);
}
