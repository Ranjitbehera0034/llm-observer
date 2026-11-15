CREATE TABLE task_inbox (
  id TEXT PRIMARY KEY,
  source_key TEXT NOT NULL UNIQUE,
  source TEXT NOT NULL CHECK(source IN ('manual','optimizer','ai-analyst')),
  title TEXT NOT NULL,
  detail TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'todo' CHECK(status IN ('todo','in_progress','done','dismissed')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
