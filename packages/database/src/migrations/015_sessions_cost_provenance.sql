-- Cost provenance for sessions (RM-4)
-- Parsers set is_estimated when a cost is a guess (family-fallback pricing, no pricing
-- at all, estimated token counts). cost_source says which: 'pricing_table' (exact model
-- match), 'family_fallback' (priced at the nearest model of the same family),
-- 'unpriced' (no price found, cost is not real) or 'estimated' (token counts guessed).

ALTER TABLE sessions ADD COLUMN tool TEXT;
ALTER TABLE sessions ADD COLUMN is_estimated INTEGER DEFAULT 0;
ALTER TABLE sessions ADD COLUMN cost_source TEXT;

ALTER TABLE subagents ADD COLUMN is_estimated INTEGER DEFAULT 0;
ALTER TABLE subagents ADD COLUMN cost_source TEXT;

-- Backfill: Claude sessions that carry tokens but were priced at $0 were silently unpriced.
-- Flagging them lets the parser re-price them on its next cycle.
UPDATE sessions
SET tool = 'Claude Code'
WHERE provider = 'claude-code' AND tool IS NULL;

UPDATE sessions
SET is_estimated = 1, cost_source = 'unpriced'
WHERE provider = 'claude-code'
  AND COALESCE(estimated_cost_usd, 0) = 0
  AND (COALESCE(input_tokens, 0) + COALESCE(output_tokens, 0)
       + COALESCE(cache_read_tokens, 0) + COALESCE(cache_write_tokens, 0)) > 0;
