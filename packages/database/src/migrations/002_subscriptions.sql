-- LLM Observer v1.3.0 Migration
-- Adds the subscriptions table for tracking fixed monthly costs.

CREATE TABLE IF NOT EXISTS subscriptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    service_name TEXT NOT NULL,
    provider TEXT, -- 'openai', 'anthropic', 'cursor', 'github', etc.
    monthly_cost_usd DECIMAL(10, 2) NOT NULL,
    billing_cycle TEXT CHECK(billing_cycle IN ('monthly', 'yearly')) DEFAULT 'monthly',
    is_active INTEGER DEFAULT 1,
    start_date TEXT DEFAULT CURRENT_TIMESTAMP,
    end_date TEXT,
    notes TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Index for faster lookup by status
CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON subscriptions(is_active);

-- Update internal version tracking (optional, but good for meta)
-- UPDATE _db_meta SET version = '1.3.0' WHERE id = 1; (Assumes _db_meta exists from v1.1.0)
