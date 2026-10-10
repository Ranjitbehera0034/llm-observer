-- OpenTelemetry (OTLP) ingestion, opt-in (otlp_receiver_enabled).
--
-- sessions.source says where a session row came from: 'log' (a parser read the tool's own log file)
-- or 'otlp' (built from telemetry the tool pushed to the local receiver). A parser always wins: its
-- upsert (insertSession) resets source to 'log', and the receiver never touches a 'log' row.
ALTER TABLE sessions ADD COLUMN source TEXT NOT NULL DEFAULT 'log';

-- otlp_usage is the idempotency ledger for OTLP usage. One row per API request (kind 'event') or
-- per metric data point (kind 'metric'), keyed so that delivering the same export twice is a no-op.
-- The session total is always recomputed from these rows, never incremented.
--
-- PRIVACY RULE: usage numbers and identifiers only. There is deliberately no column that could hold
-- prompt, response, tool input/output, file path or user identity text.
CREATE TABLE IF NOT EXISTS otlp_usage (
  session_id TEXT NOT NULL,          -- telemetry session.id (equals the Claude Code log file's session id)
  kind TEXT NOT NULL,                -- 'event' | 'metric'
  dedupe_key TEXT NOT NULL,          -- request id, or hash of the metric series (and window for delta)
  model TEXT,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cache_read_tokens INTEGER NOT NULL DEFAULT 0,
  cache_write_tokens INTEGER NOT NULL DEFAULT 0,
  cost_usd REAL,                     -- as reported by the tool; NULL = the tool sent no cost
  started_at TEXT NOT NULL,          -- ISO 8601
  occurred_at TEXT NOT NULL,         -- ISO 8601
  received_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (session_id, kind, dedupe_key)
) WITHOUT ROWID;
