import { getDb } from '../db';

export interface PricingRecord {
    provider: string;
    model: string;
    input: number;
    output: number;
    cached: number | null;
}

export const syncPricingToDb = (pricingData: PricingRecord[]) => {
    const db = getDb();

    const deleteStmt = db.prepare('DELETE FROM model_pricing WHERE is_custom = 0');
    const insertStmt = db.prepare(`
        INSERT INTO model_pricing 
        (provider, model, input_cost_per_1m, output_cost_per_1m, cached_input_cost_per_1m)
        VALUES (?, ?, ?, ?, ?)
    `);

    const performSync = db.transaction((items) => {
        deleteStmt.run();
        for (const item of items) {
            insertStmt.run(item.provider, item.model, item.input, item.output, item.cached);
        }
    });

    performSync(pricingData);
};

export const addCustomPricing = (record: PricingRecord) => {
    const db = getDb();

    // Upsert logic for custom pricing
    const stmt = db.prepare(`
        INSERT INTO model_pricing 
        (provider, model, input_cost_per_1m, output_cost_per_1m, cached_input_cost_per_1m, is_custom)
        VALUES (?, ?, ?, ?, ?, 1)
    `);

    // SQLite by default doesn't have a unique constraint on provider+model out of the box unless we added it.
    // Let's just delete the existing custom one if it exists to be safe, then insert.
    db.transaction(() => {
        db.prepare('DELETE FROM model_pricing WHERE provider = ? AND model = ?').run(record.provider, record.model);
        stmt.run(record.provider, record.model, record.input, record.output, record.cached);
    })();
};

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
