CREATE TABLE IF NOT EXISTS rate_limit_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    provider TEXT NOT NULL,
    window_type TEXT NOT NULL,
    total_allowed REAL,
    total_used REAL,
    utilization_pct REAL,
    resets_at TEXT,
    is_estimated INTEGER DEFAULT 0,
    captured_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_rl_snapshots_prog_win_cap ON rate_limit_snapshots(provider, window_type, captured_at DESC);
CREATE INDEX IF NOT EXISTS idx_rl_snapshots_captured ON rate_limit_snapshots(captured_at);

CREATE TABLE IF NOT EXISTS rate_limit_config (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    provider TEXT NOT NULL,
    window_type TEXT NOT NULL,
    alert_threshold_pct REAL DEFAULT 0.75,
    plan_type TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_rl_config_prov_win ON rate_limit_config(provider, window_type);
