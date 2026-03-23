-- Migration: 001_sync_tables.sql
-- Description: Add tables for provider usage syncing and admin key storage

-- Table for storing encrypted admin keys for providers
CREATE TABLE IF NOT EXISTS usage_sync_configs (
    id TEXT PRIMARY KEY, -- e.g., 'anthropic'
    display_name TEXT NOT NULL,
    admin_key_enc TEXT, -- iv:authTag:encryptedData (from encryption.ts)
    status TEXT DEFAULT 'inactive', -- active, inactive, error, rate_limited
    last_poll_at DATETIME,
    last_error TEXT,
    error_count INTEGER DEFAULT 0,
    poll_interval_seconds INTEGER DEFAULT 60,
    org_id TEXT,
    org_name TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Table for storing aggregated usage records fetched from APIs
CREATE TABLE IF NOT EXISTS usage_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    provider TEXT NOT NULL, -- 'anthropic'
    model TEXT NOT NULL,
    bucket_start DATETIME NOT NULL,
    bucket_width TEXT NOT NULL, -- '1m', '1h', '1d'
    input_tokens INTEGER DEFAULT 0,
    output_tokens INTEGER DEFAULT 0,
    cache_read_tokens INTEGER DEFAULT 0,
    cache_write_tokens INTEGER DEFAULT 0,
    num_requests INTEGER DEFAULT 0,
    api_key_id TEXT,
    workspace_id TEXT,
    service_tier TEXT,
    cost_usd REAL,
    raw_json TEXT, -- Full JSON for recovery/debugging
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(provider, model, bucket_start, api_key_id, workspace_id)
);

-- Table for tracking last sync positions to avoid redundant overhead
CREATE TABLE IF NOT EXISTS poll_checkpoints (
    provider TEXT PRIMARY KEY,
    last_usage_bucket DATETIME,
    last_cost_date TEXT,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_usage_records_time ON usage_records(provider, bucket_start DESC);
CREATE INDEX IF NOT EXISTS idx_usage_records_model ON usage_records(model, bucket_start DESC);
