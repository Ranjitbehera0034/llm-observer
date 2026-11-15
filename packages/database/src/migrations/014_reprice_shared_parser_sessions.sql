-- Re-read existing source files once with corrected cache accounting and
-- nullable unknown prices. Preserve sessions and source files themselves.
UPDATE parsed_files_registry
SET status = 'skipped'
WHERE provider IN ('codex', 'cline', 'copilot', 'windsurf');
