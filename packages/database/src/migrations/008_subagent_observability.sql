-- Migration: 008_subagent_observability.sql
-- Goal: Deep visibility into Claude Code subagents and tool costs.

-- 1. Extend sessions table with aggregate columns
ALTER TABLE sessions ADD COLUMN total_subagent_cost_usd REAL DEFAULT 0;
ALTER TABLE sessions ADD COLUMN parent_cost_usd REAL DEFAULT 0;
ALTER TABLE sessions ADD COLUMN deepest_agent_depth INTEGER DEFAULT 0;

-- 2. Create subagents table
CREATE TABLE IF NOT EXISTS subagents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  parent_session_id INTEGER NOT NULL,
  agent_id TEXT NOT NULL,
  agent_type TEXT DEFAULT 'general', -- explore, plan, execute, validate, general
  model TEXT,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  duration_seconds INTEGER DEFAULT 0,
  message_count INTEGER DEFAULT 0,
  input_tokens INTEGER DEFAULT 0,
  output_tokens INTEGER DEFAULT 0,
  cache_read_tokens INTEGER DEFAULT 0,
  cache_write_tokens INTEGER DEFAULT 0,
  estimated_cost_usd REAL DEFAULT 0,
  tool_calls_json TEXT DEFAULT '{}',
  file_path TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (parent_session_id) REFERENCES sessions(id) ON DELETE CASCADE,
  UNIQUE(parent_session_id, agent_id)
);

-- 3. Create tool_usage_daily table for pre-aggregated stats
CREATE TABLE IF NOT EXISTS tool_usage_daily (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL, -- YYYY-MM-DD
  provider TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  call_count INTEGER DEFAULT 0,
  total_tokens INTEGER DEFAULT 0,
  estimated_cost_usd REAL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(date, provider, tool_name)
);

-- 4. Create redundant_patterns table for efficiency insights
CREATE TABLE IF NOT EXISTS redundant_patterns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  type TEXT NOT NULL, -- repeated_read, repeated_bash
  target TEXT NOT NULL, -- file path or command string
  call_count INTEGER NOT NULL,
  sessions_affected INTEGER NOT NULL,
  estimated_waste_usd REAL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(date, type, target)
);

-- 5. Indexes for performance
CREATE INDEX IF NOT EXISTS idx_subagents_parent ON subagents(parent_session_id);
CREATE INDEX IF NOT EXISTS idx_subagents_cost ON subagents(estimated_cost_usd DESC);
CREATE INDEX IF NOT EXISTS idx_tool_usage_date ON tool_usage_daily(date DESC, provider);
CREATE INDEX IF NOT EXISTS idx_redundant_patterns_date ON redundant_patterns(date DESC);
