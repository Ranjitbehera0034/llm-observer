-- PRIVACY RULE: This schema is designed to extract ONLY metadata (token counts, duration, tool counts).
-- It MUST NOT extract or store prompt text or raw conversational content to preserve developer privacy.

CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider TEXT NOT NULL,
  session_id TEXT NOT NULL,
  project_path TEXT,
  project_name TEXT,
  model_primary TEXT,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  duration_seconds INTEGER,
  message_count INTEGER DEFAULT 0,
  input_tokens INTEGER DEFAULT 0,
  output_tokens INTEGER DEFAULT 0,
  cache_read_tokens INTEGER DEFAULT 0,
  cache_write_tokens INTEGER DEFAULT 0,
  cache_hit_rate REAL DEFAULT 0,
  estimated_cost_usd REAL DEFAULT 0,
  session_type TEXT,
  tool_calls_json TEXT DEFAULT '{}',
  has_subagents BOOLEAN DEFAULT 0,
  subagent_count INTEGER DEFAULT 0,
  raw_metadata_json TEXT,
  file_path TEXT,
  file_modified_at INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(provider, session_id)
);

CREATE INDEX IF NOT EXISTS idx_sessions_provider_started ON sessions(provider, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_project_started ON sessions(project_name, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_cost ON sessions(estimated_cost_usd DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_type ON sessions(session_type, started_at DESC);

CREATE TABLE IF NOT EXISTS parsed_files_registry (
  file_path TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  last_modified_at INTEGER NOT NULL,
  last_parsed_at TEXT NOT NULL,
  status TEXT NOT NULL,
  error_message TEXT
);
