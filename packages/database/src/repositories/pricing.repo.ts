import { getDb } from '../db';

export interface PricingRecord {
    provider: string;
    model: string;
    input: number;
    output: number;
    cached: number | null;
}

export const validatePricing = (items: PricingRecord[]) => {
    if (!Array.isArray(items) || items.length > 10000) throw new Error('Invalid pricing catalog');
    for (const item of items) {
        if (!item || typeof item.provider !== 'string' || !item.provider.trim() || typeof item.model !== 'string' || !item.model.trim()
            || ![item.input, item.output].every(n => typeof n === 'number' && Number.isFinite(n) && n >= 0)
            || (item.cached != null && (typeof item.cached !== 'number' || !Number.isFinite(item.cached) || item.cached < 0))) {
            throw new Error('Invalid pricing record; existing prices were preserved');
        }
    }
};

// Catalog refreshes preserve custom overrides and models absent from the feed.
export const syncPricingToDb = (pricingData: PricingRecord[]) => {
    validatePricing(pricingData);
    const db = getDb();
    const stmt = db.prepare(`INSERT INTO model_pricing
        (provider, model, input_cost_per_1m, output_cost_per_1m, cached_input_cost_per_1m)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(provider, model) DO UPDATE SET
        input_cost_per_1m = excluded.input_cost_per_1m,
        output_cost_per_1m = excluded.output_cost_per_1m,
        cached_input_cost_per_1m = excluded.cached_input_cost_per_1m,
        updated_at = datetime('now')
        WHERE model_pricing.is_custom = 0`);
    db.transaction(() => {
        for (const item of pricingData) stmt.run(item.provider, item.model, item.input, item.output, item.cached ?? null);
    })();
};

export const addCustomPricing = (record: PricingRecord) => {
    validatePricing([record]);
    getDb().prepare(`INSERT INTO model_pricing
        (provider, model, input_cost_per_1m, output_cost_per_1m, cached_input_cost_per_1m, is_custom)
        VALUES (?, ?, ?, ?, ?, 1)
        ON CONFLICT(provider, model) DO UPDATE SET
        input_cost_per_1m = excluded.input_cost_per_1m,
        output_cost_per_1m = excluded.output_cost_per_1m,
        cached_input_cost_per_1m = excluded.cached_input_cost_per_1m,
        is_custom = 1, updated_at = datetime('now')
    `).run(record.provider, record.model, record.input, record.output, record.cached ?? null);
};

export const getPricingHistory = (provider: string, model: string) => getDb().prepare(
    'SELECT * FROM pricing_history WHERE provider = ? AND model = ? ORDER BY revision DESC LIMIT 100'
).all(provider, model);

export const getPricingForModel = (provider: string, model: string): PricingRecord | undefined => {
    const db = getDb();
    const row = db.prepare('SELECT * FROM model_pricing WHERE provider = ? AND model = ?').get(provider, model) as any;
    if (!row) return undefined;
    return {
        provider: row.provider,
        model: row.model,
        input: row.input_cost_per_1m,
        output: row.output_cost_per_1m,
        cached: row.cached_input_cost_per_1m
    };
};

export const fetchPricingFromDb = (): any[] => {
    const db = getDb();
    return db.prepare('SELECT * FROM model_pricing').all();
};
