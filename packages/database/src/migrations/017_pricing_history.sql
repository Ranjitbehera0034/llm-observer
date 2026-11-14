-- A revision records when this installation learned a price, not the provider's
-- contractual effective date. Existing requests are not retroactively repriced.
CREATE TABLE pricing_history (
  revision INTEGER PRIMARY KEY AUTOINCREMENT,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  input_cost_per_1m REAL NOT NULL,
  output_cost_per_1m REAL NOT NULL,
  cached_input_cost_per_1m REAL,
  is_custom INTEGER NOT NULL DEFAULT 0,
  recorded_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
INSERT INTO pricing_history (provider, model, input_cost_per_1m, output_cost_per_1m, cached_input_cost_per_1m, is_custom)
SELECT provider, model, input_cost_per_1m, output_cost_per_1m, cached_input_cost_per_1m, is_custom FROM model_pricing;
CREATE INDEX idx_pricing_history_model ON pricing_history(provider, model, revision DESC);

CREATE TRIGGER pricing_history_insert AFTER INSERT ON model_pricing BEGIN
  INSERT INTO pricing_history (provider, model, input_cost_per_1m, output_cost_per_1m, cached_input_cost_per_1m, is_custom)
  VALUES (NEW.provider, NEW.model, NEW.input_cost_per_1m, NEW.output_cost_per_1m, NEW.cached_input_cost_per_1m, NEW.is_custom);
  UPDATE parsed_files_registry SET status = 'skipped' WHERE status = 'success';
END;
CREATE TRIGGER pricing_history_update AFTER UPDATE ON model_pricing
WHEN OLD.input_cost_per_1m IS NOT NEW.input_cost_per_1m OR OLD.output_cost_per_1m IS NOT NEW.output_cost_per_1m
  OR OLD.cached_input_cost_per_1m IS NOT NEW.cached_input_cost_per_1m OR OLD.is_custom IS NOT NEW.is_custom
BEGIN
  INSERT INTO pricing_history (provider, model, input_cost_per_1m, output_cost_per_1m, cached_input_cost_per_1m, is_custom)
  VALUES (NEW.provider, NEW.model, NEW.input_cost_per_1m, NEW.output_cost_per_1m, NEW.cached_input_cost_per_1m, NEW.is_custom);
  UPDATE parsed_files_registry SET status = 'skipped' WHERE status = 'success';
END;
ALTER TABLE requests ADD COLUMN pricing_catalog_revision INTEGER;
ALTER TABLE sessions ADD COLUMN pricing_catalog_revision INTEGER;
CREATE TRIGGER request_pricing_revision AFTER INSERT ON requests BEGIN
  UPDATE requests SET pricing_catalog_revision = (SELECT MAX(revision) FROM pricing_history) WHERE id = NEW.id;
END;
CREATE TRIGGER session_pricing_revision_insert AFTER INSERT ON sessions BEGIN
  UPDATE sessions SET pricing_catalog_revision = (SELECT MAX(revision) FROM pricing_history) WHERE id = NEW.id;
END;
CREATE TRIGGER session_pricing_revision_update AFTER UPDATE OF estimated_cost_usd ON sessions BEGIN
  UPDATE sessions SET pricing_catalog_revision = (SELECT MAX(revision) FROM pricing_history) WHERE id = NEW.id;
END;
-- Revisit old unknown-zero and single-model valuations with the corrected parser.
UPDATE parsed_files_registry SET status = 'skipped' WHERE provider IN ('claude-code', 'aider');
