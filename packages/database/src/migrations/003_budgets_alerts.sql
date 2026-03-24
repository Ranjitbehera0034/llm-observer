-- LLM Observer v1.4.0 - Budgets and Alerts Migration

-- 1. Create Budgets Table
CREATE TABLE IF NOT EXISTS budgets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    scope TEXT NOT NULL CHECK(scope IN ('global', 'provider', 'model')),
    scope_value TEXT, -- Provider name or Model name, NULL for global
    period TEXT NOT NULL CHECK(period IN ('daily', 'weekly', 'monthly')),
    limit_usd REAL NOT NULL CHECK(limit_usd > 0),
    warning_pct_1 REAL DEFAULT 0.80,
    warning_pct_2 REAL DEFAULT 0.90,
    kill_switch INTEGER DEFAULT 0, -- Boolean: 0 = No, 1 = Yes
    safety_buffer_usd REAL DEFAULT 0.05,
    is_active INTEGER DEFAULT 1, -- Boolean: 0 = No, 1 = Yes
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 2. Extend Alerts Table (Idempotent schema updates)
-- Not all SQLite versions support multiple ADD COLUMN in one statement, so we split them.
ALTER TABLE alerts ADD COLUMN budget_id INTEGER;
ALTER TABLE alerts ADD COLUMN scope TEXT;
ALTER TABLE alerts ADD COLUMN scope_value TEXT;
-- We reuse the existing 'data' column for metadata, but add budget-specific ones.
ALTER TABLE alerts ADD COLUMN current_spend_usd REAL;
ALTER TABLE alerts ADD COLUMN limit_usd REAL;
ALTER TABLE alerts ADD COLUMN period_start TEXT;
ALTER TABLE alerts ADD COLUMN metadata TEXT; -- JSON blob for additional context 

-- 3. Indexes
CREATE INDEX IF NOT EXISTS idx_alerts_acknowledged ON alerts(acknowledged, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_budgets_lookup ON budgets(scope, scope_value, is_active);

-- 4. Deduplication Index for Budget Alerts
-- This ensures budget+type+period_start uniqueness while allowing NULLs for traditional project alerts.
CREATE UNIQUE INDEX IF NOT EXISTS idx_alerts_dedup ON alerts(budget_id, type, period_start) WHERE budget_id IS NOT NULL;
