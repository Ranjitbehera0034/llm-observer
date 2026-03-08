CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  api_key TEXT UNIQUE,
  daily_budget REAL,
  weekly_budget REAL,
  monthly_budget REAL,
  alert_threshold REAL DEFAULT 0.8,
  kill_switch BOOLEAN DEFAULT 1,
  webhook_url TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS requests (
  id TEXT PRIMARY KEY,
  project_id TEXT,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  endpoint TEXT,
  prompt_tokens INTEGER,
  completion_tokens INTEGER,
  total_tokens INTEGER,
  cost_usd REAL NOT NULL,
  latency_ms INTEGER,
  status_code INTEGER,
  status TEXT DEFAULT 'success',
  is_streaming BOOLEAN DEFAULT 0,
  has_tools BOOLEAN DEFAULT 0,
  error_message TEXT,
  request_body TEXT,
  response_body TEXT,
  tags TEXT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (project_id) REFERENCES projects (id)
);

CREATE INDEX IF NOT EXISTS idx_requests_project_date ON requests(project_id, created_at);
CREATE INDEX IF NOT EXISTS idx_requests_provider_model ON requests(provider, model);
CREATE INDEX IF NOT EXISTS idx_requests_status ON requests(status);
CREATE INDEX IF NOT EXISTS idx_requests_cost ON requests(cost_usd);

CREATE TABLE IF NOT EXISTS model_pricing (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  input_cost_per_1m REAL NOT NULL,
  output_cost_per_1m REAL NOT NULL,
  cached_input_cost_per_1m REAL,
  effective_date DATE DEFAULT (date('now')),
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS alerts (
  id TEXT PRIMARY KEY,
  project_id TEXT,
  type TEXT NOT NULL,
  severity TEXT,
  message TEXT NOT NULL,
  data TEXT,
  notified_via TEXT,
  acknowledged BOOLEAN DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (project_id) REFERENCES projects (id)
);

CREATE INDEX IF NOT EXISTS idx_alerts_project_type ON alerts(project_id, type, created_at);

CREATE TABLE IF NOT EXISTS daily_stats (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT,
  date DATE NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  total_requests INTEGER DEFAULT 0,
  total_tokens INTEGER DEFAULT 0,
  total_cost_usd REAL DEFAULT 0,
  avg_latency_ms INTEGER,
  error_count INTEGER DEFAULT 0,
  blocked_count INTEGER DEFAULT 0,
  FOREIGN KEY (project_id) REFERENCES projects (id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_daily_stats_unique ON daily_stats(project_id, date, provider, model);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
