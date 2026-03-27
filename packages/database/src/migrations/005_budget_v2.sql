-- LLM Observer v1.7.0 - Budget Guard v2 Migration

-- 1. Update budgets table
-- Add estimate_multiplier (for Layer 3 pre-estimation)
-- safety_buffer_usd was added in v1.4.0 (003_budgets_alerts.sql)
ALTER TABLE budgets ADD COLUMN estimate_multiplier REAL DEFAULT 3.0;

-- 2. Update projects table (Legacy v1.0.x budget compatibility)
-- Add safety_buffer and estimate_multiplier
-- Note: SQLite allows adding multiple columns but requires separate statements
ALTER TABLE projects ADD COLUMN safety_buffer REAL DEFAULT 0.05;
ALTER TABLE projects ADD COLUMN estimate_multiplier REAL DEFAULT 3.0;
