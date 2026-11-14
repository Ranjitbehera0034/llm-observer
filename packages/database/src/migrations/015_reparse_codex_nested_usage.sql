-- Recompute existing Codex sessions from nested usage events and real metadata.
UPDATE parsed_files_registry SET status = 'skipped' WHERE provider = 'codex';
