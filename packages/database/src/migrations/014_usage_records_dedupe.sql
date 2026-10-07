-- Make provider-sync usage_records idempotent (RM-3).
--
-- 001 declared UNIQUE(provider, model, bucket_start, api_key_id, workspace_id), but the pollers
-- bind api_key_id and workspace_id to NULL and SQLite treats NULLs as distinct, so the constraint
-- never fired: every poll of the still-open daily bucket inserted another row, and every consumer
-- that SUMs cost_usd (budgets, overview, app correlator) counted the day once per poll.
--
-- This migration deletes rows, so it is written to be safe on its own:
--   * each statement is atomic and re-running it changes nothing (the migration is only recorded
--     once the whole file has run, so a crash between statements just re-runs it);
--   * nothing but exact duplicates of the natural key is removed, and the survivor is the newest
--     row (highest id), which carries the latest tokens;
--   * a cost already stamped on an older duplicate is carried onto the survivor if the survivor
--     has none, so a day's cost is never lost to the dedupe.

-- 1. Carry the newest known cost onto the row that will survive.
UPDATE usage_records
SET cost_usd = (
    SELECT o.cost_usd FROM usage_records o
    WHERE o.provider = usage_records.provider
      AND o.model = usage_records.model
      AND o.bucket_start = usage_records.bucket_start
      AND COALESCE(o.api_key_id, '') = COALESCE(usage_records.api_key_id, '')
      AND COALESCE(o.workspace_id, '') = COALESCE(usage_records.workspace_id, '')
      AND o.cost_usd IS NOT NULL
    ORDER BY o.id DESC
    LIMIT 1
)
WHERE cost_usd IS NULL
  AND id IN (
    SELECT MAX(id) FROM usage_records
    GROUP BY provider, model, bucket_start, COALESCE(api_key_id, ''), COALESCE(workspace_id, '')
    HAVING COUNT(*) > 1
  );

-- 2. Keep the newest row per natural key.
DELETE FROM usage_records
WHERE id NOT IN (
    SELECT MAX(id) FROM usage_records
    GROUP BY provider, model, bucket_start, COALESCE(api_key_id, ''), COALESCE(workspace_id, '')
);

-- 3. Enforce the natural key with NULL and '' treated as the same value. Pollers upsert against
--    exactly this expression list (ON CONFLICT target must match it).
CREATE UNIQUE INDEX IF NOT EXISTS idx_usage_records_natural_key
ON usage_records (provider, model, bucket_start, COALESCE(api_key_id, ''), COALESCE(workspace_id, ''));
