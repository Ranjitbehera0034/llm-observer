import { getDb } from './db';

const initialPricing = [
    // OpenAI
    { provider: 'openai', model: 'gpt-4o', input: 5.00, output: 15.00, cached: 2.50 },
    { provider: 'openai', model: 'gpt-4o-mini', input: 0.15, output: 0.60, cached: 0.075 },
    { provider: 'openai', model: 'o1', input: 15.00, output: 60.00, cached: 7.50 },
    { provider: 'openai', model: 'o1-mini', input: 3.00, output: 12.00, cached: 1.50 },
    { provider: 'openai', model: 'o3-mini', input: 1.10, output: 4.40, cached: 0.55 },
    // Anthropic
    { provider: 'anthropic', model: 'claude-3-opus-20240229', input: 15.00, output: 75.00, cached: null },
    { provider: 'anthropic', model: 'claude-3-5-sonnet-20241022', input: 3.00, output: 15.00, cached: 0.30 },
    { provider: 'anthropic', model: 'claude-3-5-haiku-20241022', input: 0.80, output: 4.00, cached: 0.08 },
    // Google
    { provider: 'google', model: 'gemini-1.5-pro', input: 3.50, output: 10.50, cached: null },
    { provider: 'google', model: 'gemini-1.5-flash', input: 0.075, output: 0.30, cached: null },
    // Mistral
    { provider: 'mistral', model: 'mistral-large-latest', input: 2.00, output: 6.00, cached: null },
    { provider: 'mistral', model: 'open-mistral-nemo', input: 0.15, output: 0.15, cached: null },
    // Groq
    { provider: 'groq', model: 'llama-3.1-70b-versatile', input: 0.59, output: 0.79, cached: null },
    { provider: 'groq', model: 'llama3-8b-8192', input: 0.05, output: 0.08, cached: null },
];

export const seedPricing = () => {
    const db = getDb();

    const checkStmt = db.prepare(`SELECT count(*) as count FROM model_pricing`);
    const row = checkStmt.get() as { count: number };

    if (row.count > 0) {
        console.log('Pricing data already seeded.');
        return;
    }

    const insertStmt = db.prepare(`
    INSERT INTO model_pricing 
    (provider, model, input_cost_per_1m, output_cost_per_1m, cached_input_cost_per_1m)
    VALUES (?, ?, ?, ?, ?)
  `);

    const insertMany = db.transaction((pricingItems) => {
        for (const item of pricingItems) {
            insertStmt.run(item.provider, item.model, item.input, item.output, item.cached);
        }
    });

    insertMany(initialPricing);
    console.log('Pricing data seeded.');
};
