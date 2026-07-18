-- Response Drift Detection (v1.15.0)
-- Tracks a rolling lexical baseline per (provider, model) and a per-request
-- similarity score against it, so a sudden shift in a model's output style
-- (e.g. after a silent provider-side model update) can be flagged.

CREATE TABLE IF NOT EXISTS response_drift_baselines (
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  term_freq_json TEXT NOT NULL DEFAULT '{}',
  sample_count INTEGER NOT NULL DEFAULT 0,
  avg_similarity REAL,
  variance_similarity REAL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (provider, model)
);

ALTER TABLE requests ADD COLUMN drift_score REAL;
ALTER TABLE requests ADD COLUMN drift_flag BOOLEAN DEFAULT 0;
