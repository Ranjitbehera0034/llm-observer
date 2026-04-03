-- Migration: Optimization Engine Cache Table
-- Version: 009

CREATE TABLE IF NOT EXISTS optimization_cache (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    computed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    days_analyzed INTEGER NOT NULL,
    score INTEGER NOT NULL,
    total_savings_usd DECIMAL(10, 2) NOT NULL,
    results_json TEXT NOT NULL,
    expires_at DATETIME NOT NULL
);

-- Index for expiration cleanup
CREATE INDEX IF NOT EXISTS idx_optimization_cache_expires_at ON optimization_cache(expires_at);
