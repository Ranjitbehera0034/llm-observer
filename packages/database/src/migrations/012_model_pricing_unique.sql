-- Pricing upserts (refreshPricing) use ON CONFLICT(provider, model), which requires
-- a unique index. Deduplicate existing rows first (keep the newest), then enforce.
DELETE FROM model_pricing
WHERE id NOT IN (
    SELECT MAX(id) FROM model_pricing GROUP BY provider, model
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_model_pricing_provider_model
    ON model_pricing(provider, model);
