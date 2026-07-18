import { getDb } from './db';
import { syncPricingToDb, PricingRecord } from './repositories/pricing.repo';

/**
 * LLM Model Pricing Data
 * All prices in USD per 1 Million tokens
 * Last verified: July 2026
 * 
 * Sources:
 *   - OpenAI: https://platform.openai.com/docs/pricing
 *   - Anthropic: https://docs.anthropic.com/en/docs/about-claude/pricing
 *   - Google: https://ai.google.dev/gemini-api/docs/pricing
 *   - Mistral: https://docs.mistral.ai/getting-started/pricing
 *   - Groq: https://groq.com/pricing
 *   - xAI: https://docs.x.ai/docs/models
 *   - DeepSeek: https://platform.deepseek.com/api-docs/pricing
 *   - Meta (via Together/Groq): https://together.ai/pricing
 *   - Cohere: https://cohere.com/pricing
 * 
 * IMPORTANT: Pricing changes frequently. Run `llm-observer pricing update`
 * or check provider docs for latest rates.
 */

export interface PricingEntry {
    provider: string;
    model: string;
    input: number;       // USD per 1M input tokens
    output: number;      // USD per 1M output tokens
    cached: number | null; // USD per 1M cached input tokens (null if not supported)
}

const initialPricing: PricingEntry[] = [

    // ═══════════════════════════════════════
    // OpenAI
    // ═══════════════════════════════════════

    // GPT-5 Series (Aug 2025+)
    { provider: 'openai', model: 'gpt-5', input: 1.25, output: 10.00, cached: 0.625 },
    { provider: 'openai', model: 'gpt-5-mini', input: 0.25, output: 2.00, cached: 0.125 },
    { provider: 'openai', model: 'gpt-5-nano', input: 0.05, output: 0.40, cached: 0.025 },

    // GPT-5.1 Series (Nov 2025+)
    // GPT-5.6 / 5.5 / 5.4 / 5.3 Series (2026)
    { provider: 'openai', model: 'gpt-5.6-sol', input: 5.00, output: 30.00, cached: 0.50 },
    { provider: 'openai', model: 'gpt-5.6-terra', input: 2.50, output: 15.00, cached: 0.25 },
    { provider: 'openai', model: 'gpt-5.6-luna', input: 1.00, output: 6.00, cached: 0.10 },
    { provider: 'openai', model: 'gpt-5.5', input: 5.00, output: 30.00, cached: 0.50 },
    { provider: 'openai', model: 'gpt-5.5-pro', input: 30.00, output: 180.00, cached: null },
    { provider: 'openai', model: 'gpt-5.4', input: 2.50, output: 15.00, cached: 0.25 },
    { provider: 'openai', model: 'gpt-5.4-mini', input: 0.75, output: 4.50, cached: 0.075 },
    { provider: 'openai', model: 'gpt-5.4-nano', input: 0.20, output: 1.25, cached: 0.02 },
    { provider: 'openai', model: 'gpt-5.4-pro', input: 30.00, output: 180.00, cached: null },
    { provider: 'openai', model: 'gpt-5.3-codex', input: 1.75, output: 14.00, cached: 0.175 },

    { provider: 'openai', model: 'gpt-5.1', input: 1.25, output: 10.00, cached: 0.625 },
    { provider: 'openai', model: 'gpt-5.1-mini', input: 0.25, output: 2.00, cached: 0.125 },

    // GPT-5.2 Series (Dec 2025+)
    { provider: 'openai', model: 'gpt-5.2', input: 1.75, output: 14.00, cached: 0.875 },

    // GPT-4.1 Series (Apr 2025)
    { provider: 'openai', model: 'gpt-4.1', input: 2.00, output: 8.00, cached: 0.50 },
    { provider: 'openai', model: 'gpt-4.1-mini', input: 0.40, output: 1.60, cached: 0.10 },
    { provider: 'openai', model: 'gpt-4.1-nano', input: 0.10, output: 0.40, cached: 0.025 },

    // GPT-4o Series
    { provider: 'openai', model: 'gpt-4o', input: 2.50, output: 10.00, cached: 1.25 },
    { provider: 'openai', model: 'gpt-4o-mini', input: 0.15, output: 0.60, cached: 0.075 },

    // o-Series (Reasoning)
    { provider: 'openai', model: 'o4-mini', input: 1.10, output: 4.40, cached: 0.275 },
    { provider: 'openai', model: 'o3', input: 10.00, output: 40.00, cached: 2.50 },
    { provider: 'openai', model: 'o3-mini', input: 1.10, output: 4.40, cached: 0.55 },
    { provider: 'openai', model: 'o1', input: 15.00, output: 60.00, cached: 7.50 },
    { provider: 'openai', model: 'o1-mini', input: 3.00, output: 12.00, cached: 1.50 },

    // Open Source from OpenAI
    { provider: 'openai', model: 'gpt-oss-20b', input: 0.03, output: 0.14, cached: null },
    { provider: 'openai', model: 'gpt-oss-120b', input: 0.039, output: 0.19, cached: null },

    // ═══════════════════════════════════════
    // Anthropic (Claude)
    // ═══════════════════════════════════════

    // Claude 5 / 4.8 Series (Current generation)
    { provider: 'anthropic', model: 'claude-fable-5', input: 10.00, output: 50.00, cached: 1.00 },
    { provider: 'anthropic', model: 'claude-opus-4-8', input: 5.00, output: 25.00, cached: 0.50 },
    { provider: 'anthropic', model: 'claude-opus-4-7', input: 5.00, output: 25.00, cached: 0.50 },
    { provider: 'anthropic', model: 'claude-sonnet-5', input: 3.00, output: 15.00, cached: 0.30 },
    { provider: 'anthropic', model: 'claude-haiku-4-5', input: 1.00, output: 5.00, cached: 0.10 },

    // Claude 4.6 Series
    { provider: 'anthropic', model: 'claude-opus-4-6', input: 5.00, output: 25.00, cached: 0.50 },
    { provider: 'anthropic', model: 'claude-sonnet-4-6', input: 3.00, output: 15.00, cached: 0.30 },
    { provider: 'anthropic', model: 'claude-haiku-4-6', input: 1.00, output: 5.00, cached: 0.10 },

    // Claude 4.5 Series
    { provider: 'anthropic', model: 'claude-opus-4-5-20251101', input: 5.00, output: 25.00, cached: 0.50 },
    { provider: 'anthropic', model: 'claude-sonnet-4-5-20241022', input: 3.00, output: 15.00, cached: 0.30 },
    { provider: 'anthropic', model: 'claude-haiku-4-5-20251001', input: 1.00, output: 5.00, cached: 0.10 },

    // Claude 4 Series
    { provider: 'anthropic', model: 'claude-opus-4-20250514', input: 15.00, output: 75.00, cached: 1.50 },
    { provider: 'anthropic', model: 'claude-sonnet-4-20250514', input: 3.00, output: 15.00, cached: 0.30 },

    // Claude 3.7 Series
    { provider: 'anthropic', model: 'claude-3-7-sonnet-20250219', input: 3.00, output: 15.00, cached: 0.30 },

    // Claude 3.5 Series (Legacy but still used)
    { provider: 'anthropic', model: 'claude-3-5-sonnet-20241022', input: 3.00, output: 15.00, cached: 0.30 },
    { provider: 'anthropic', model: 'claude-3-5-haiku-20241022', input: 0.80, output: 4.00, cached: 0.08 },

    // Claude 3 Series (Legacy)
    { provider: 'anthropic', model: 'claude-3-opus-20240229', input: 15.00, output: 75.00, cached: null },
    { provider: 'anthropic', model: 'claude-3-haiku-20240307', input: 0.25, output: 1.25, cached: 0.03 },

    // ═══════════════════════════════════════
    // Google (Gemini)
    // ═══════════════════════════════════════

    // Gemini 3.5 / 3.1 Series (2026)
    { provider: 'google', model: 'gemini-3.5-flash', input: 1.50, output: 9.00, cached: 0.15 },
    { provider: 'google', model: 'gemini-3.1-flash-lite', input: 0.25, output: 1.50, cached: 0.025 },
    { provider: 'google', model: 'gemini-3.1-pro-preview', input: 2.00, output: 12.00, cached: 0.20 },
    { provider: 'google', model: 'gemini-3-flash-preview', input: 0.50, output: 3.00, cached: 0.05 },

    // Gemini 3 Series (Nov 2025+)
    { provider: 'google', model: 'gemini-3-pro', input: 2.00, output: 12.00, cached: 0.20 },
    { provider: 'google', model: 'gemini-3-flash', input: 0.50, output: 3.00, cached: 0.05 },
    { provider: 'google', model: 'gemini-3.1-pro', input: 2.00, output: 12.00, cached: 0.20 },
    { provider: 'google', model: 'gemini-3.1-flash', input: 0.50, output: 3.00, cached: 0.05 },

    // Gemini 2.5 Series
    { provider: 'google', model: 'gemini-2.5-pro', input: 1.25, output: 10.00, cached: 0.125 },
    { provider: 'google', model: 'gemini-2.5-flash', input: 0.30, output: 2.50, cached: 0.03 },
    { provider: 'google', model: 'gemini-2.5-flash-lite', input: 0.10, output: 0.40, cached: 0.01 },

    // Gemini 2.0 Series
    { provider: 'google', model: 'gemini-2.0-flash', input: 0.10, output: 0.40, cached: 0.025 },
    { provider: 'google', model: 'gemini-2.0-flash-lite', input: 0.075, output: 0.30, cached: null },

    // Gemini 1.5 Series (Legacy)
    { provider: 'google', model: 'gemini-1.5-pro', input: 1.25, output: 5.00, cached: 0.3125 },
    { provider: 'google', model: 'gemini-1.5-flash', input: 0.075, output: 0.30, cached: 0.01875 },

    // ═══════════════════════════════════════
    // Mistral AI
    // ═══════════════════════════════════════

    { provider: 'mistral', model: 'mistral-large-latest', input: 2.00, output: 6.00, cached: null },
    { provider: 'mistral', model: 'mistral-medium-latest', input: 0.40, output: 2.00, cached: null },
    { provider: 'mistral', model: 'mistral-small-latest', input: 0.10, output: 0.30, cached: null },
    { provider: 'mistral', model: 'mistral-small-24b-instruct-2501', input: 0.05, output: 0.08, cached: null },
    { provider: 'mistral', model: 'open-mistral-nemo', input: 0.15, output: 0.15, cached: null },
    { provider: 'mistral', model: 'codestral-latest', input: 0.30, output: 0.90, cached: null },
    { provider: 'mistral', model: 'devstral-small', input: 0.10, output: 0.30, cached: null },
    { provider: 'mistral', model: 'ministral-3b-latest', input: 0.04, output: 0.04, cached: null },
    { provider: 'mistral', model: 'ministral-8b-latest', input: 0.10, output: 0.10, cached: null },
    { provider: 'mistral', model: 'pixtral-large-latest', input: 2.00, output: 6.00, cached: null },
    { provider: 'mistral', model: 'pixtral-12b-2409', input: 0.15, output: 0.15, cached: null },

    // ═══════════════════════════════════════
    // Groq (Fast inference)
    // ═══════════════════════════════════════

    { provider: 'groq', model: 'llama-3.3-70b-versatile', input: 0.59, output: 0.79, cached: null },
    { provider: 'groq', model: 'llama-3.1-70b-versatile', input: 0.59, output: 0.79, cached: null },
    { provider: 'groq', model: 'llama-3.1-8b-instant', input: 0.05, output: 0.08, cached: null },
    { provider: 'groq', model: 'llama3-70b-8192', input: 0.59, output: 0.79, cached: null },
    { provider: 'groq', model: 'llama3-8b-8192', input: 0.05, output: 0.08, cached: null },
    { provider: 'groq', model: 'gemma2-9b-it', input: 0.20, output: 0.20, cached: null },
    { provider: 'groq', model: 'mixtral-8x7b-32768', input: 0.24, output: 0.24, cached: null },
    { provider: 'groq', model: 'qwen-qwq-32b', input: 0.29, output: 0.39, cached: null },

    // ═══════════════════════════════════════
    // xAI (Grok)
    // ═══════════════════════════════════════

    { provider: 'xai', model: 'grok-4.5', input: 2.00, output: 6.00, cached: 0.50 },
    { provider: 'xai', model: 'grok-4.3', input: 1.25, output: 2.50, cached: null },
    { provider: 'xai', model: 'grok-4.1-fast', input: 0.20, output: 0.50, cached: null },
    { provider: 'xai', model: 'grok-4', input: 3.00, output: 15.00, cached: null },
    { provider: 'xai', model: 'grok-4-mini', input: 0.30, output: 1.50, cached: null },
    { provider: 'xai', model: 'grok-3', input: 3.00, output: 15.00, cached: null },
    { provider: 'xai', model: 'grok-3-mini', input: 0.30, output: 0.50, cached: null },
    { provider: 'xai', model: 'grok-3-fast', input: 5.00, output: 25.00, cached: null },
    { provider: 'xai', model: 'grok-2', input: 2.00, output: 10.00, cached: null },

    // ═══════════════════════════════════════
    // DeepSeek
    // ═══════════════════════════════════════

    { provider: 'deepseek', model: 'deepseek-v4', input: 0.30, output: 0.50, cached: null },
    { provider: 'deepseek', model: 'deepseek-v4-flash', input: 0.14, output: 0.28, cached: 0.0028 },
    { provider: 'deepseek', model: 'deepseek-chat', input: 0.28, output: 0.42, cached: 0.07 },
    { provider: 'deepseek', model: 'deepseek-reasoner', input: 0.55, output: 2.19, cached: 0.14 },
    { provider: 'deepseek', model: 'deepseek-coder', input: 0.14, output: 0.28, cached: null },

    // ═══════════════════════════════════════
    // Meta Llama (via Together AI / Fireworks)
    // Pricing varies by hosting provider
    // These are typical rates via Together AI
    // ═══════════════════════════════════════

    { provider: 'meta', model: 'llama-4-scout', input: 0.08, output: 0.30, cached: null },
    { provider: 'meta', model: 'llama-4-maverick', input: 0.20, output: 0.60, cached: null },
    { provider: 'meta', model: 'llama-3.3-70b-instruct', input: 0.10, output: 0.32, cached: null },
    { provider: 'meta', model: 'llama-3.1-405b-instruct', input: 0.80, output: 0.80, cached: null },
    { provider: 'meta', model: 'llama-3.1-70b-instruct', input: 0.02, output: 0.05, cached: null },
    { provider: 'meta', model: 'llama-3.1-8b-instruct', input: 0.02, output: 0.05, cached: null },

    // ═══════════════════════════════════════
    // Cohere
    // ═══════════════════════════════════════

    { provider: 'cohere', model: 'command-r-plus', input: 2.50, output: 10.00, cached: null },
    { provider: 'cohere', model: 'command-r', input: 0.15, output: 0.60, cached: null },
    { provider: 'cohere', model: 'command-r7b', input: 0.037, output: 0.15, cached: null },

    // ═══════════════════════════════════════
    // Amazon Bedrock (Nova)
    // ═══════════════════════════════════════

    { provider: 'amazon', model: 'nova-pro', input: 0.80, output: 3.20, cached: null },
    { provider: 'amazon', model: 'nova-lite', input: 0.06, output: 0.24, cached: null },
    { provider: 'amazon', model: 'nova-micro', input: 0.035, output: 0.14, cached: null },

    // ═══════════════════════════════════════
    // Qwen (Alibaba)
    // Pricing via Together AI / direct API
    // ═══════════════════════════════════════

    { provider: 'qwen', model: 'qwen3-235b-a22b', input: 0.07, output: 0.10, cached: null },
    { provider: 'qwen', model: 'qwen3-32b', input: 0.08, output: 0.24, cached: null },
    { provider: 'qwen', model: 'qwen3-14b', input: 0.06, output: 0.24, cached: null },
    { provider: 'qwen', model: 'qwen3-8b', input: 0.05, output: 0.40, cached: null },
    { provider: 'qwen', model: 'qwen3-30b-a3b', input: 0.08, output: 0.28, cached: null },

    // ═══════════════════════════════════════
    // Zhipu (GLM) & Moonshot (Kimi) — added Jul 2026
    // ═══════════════════════════════════════

    { provider: 'zhipu', model: 'glm-5.2', input: 1.40, output: 4.40, cached: null },
    { provider: 'moonshot', model: 'kimi-k2.6', input: 0.95, output: 4.00, cached: null },

];

export const getInitialPricing = () => initialPricing;

export const seedPricing = () => {
    // Rely on syncPricingToDb to handle wiping stale default data while safely protecting user-injected is_custom overrides.
    syncPricingToDb(initialPricing);
    console.log(`Pricing data seeded: ${initialPricing.length} defaults synced.`);
};

export const seedSyncProviders = () => {
    const db = getDb();
    db.prepare(`
        INSERT OR IGNORE INTO usage_sync_configs (id, display_name, status) VALUES ('openai', 'OpenAI', 'inactive')
    `).run();
    db.prepare(`
        INSERT OR IGNORE INTO usage_sync_configs (id, display_name, status) VALUES ('anthropic', 'Anthropic', 'inactive')
    `).run();
    console.log('Sync providers seeded (OpenAI, Anthropic).');
};

/**
 * Upsert pricing — inserts new models and updates existing ones.
 * Call this to refresh pricing without wiping the table.
 */
export const refreshPricing = (pricingData?: PricingEntry[]) => {
    const db = getDb();
    const data = pricingData || initialPricing;

    const upsertStmt = db.prepare(`
        INSERT INTO model_pricing 
            (provider, model, input_cost_per_1m, output_cost_per_1m, cached_input_cost_per_1m, updated_at)
        VALUES (?, ?, ?, ?, ?, datetime('now'))
        ON CONFLICT(provider, model) DO UPDATE SET
            input_cost_per_1m = excluded.input_cost_per_1m,
            output_cost_per_1m = excluded.output_cost_per_1m,
            cached_input_cost_per_1m = excluded.cached_input_cost_per_1m,
            updated_at = datetime('now')
    `);

    const upsertMany = db.transaction((items: PricingEntry[]) => {
        for (const item of items) {
            upsertStmt.run(item.provider, item.model, item.input, item.output, item.cached);
        }
    });

    upsertMany(data);
    console.log(`Pricing refreshed: ${data.length} models updated.`);
};

/**
 * Internal helper used by seedPricing
 */
const upsertPricing = (data: PricingEntry[]) => {
    const db = getDb();

    const insertStmt = db.prepare(`
        INSERT INTO model_pricing 
            (provider, model, input_cost_per_1m, output_cost_per_1m, cached_input_cost_per_1m)
        VALUES (?, ?, ?, ?, ?)
    `);

    const insertMany = db.transaction((items: PricingEntry[]) => {
        for (const item of items) {
            insertStmt.run(item.provider, item.model, item.input, item.output, item.cached);
        }
    });

    insertMany(data);
};

/**
 * Get all pricing data from the database
 */
export const getAllPricing = () => {
    const db = getDb();
    return db.prepare('SELECT * FROM model_pricing ORDER BY provider, model').all();
};

/**
 * Get pricing for a specific model
 */
export const getModelPricing = (provider: string, model: string) => {
    const db = getDb();

    // Try exact match first
    let pricing = db.prepare(
        'SELECT * FROM model_pricing WHERE provider = ? AND model = ? ORDER BY id DESC LIMIT 1'
    ).get(provider, model);

    // If no exact match, try fuzzy match (e.g., "gpt-4o-2024-08-06" → "gpt-4o")
    if (!pricing) {
        pricing = db.prepare(
            'SELECT * FROM model_pricing WHERE provider = ? AND ? LIKE model || \'%\' ORDER BY length(model) DESC LIMIT 1'
        ).get(provider, model);
    }

    return pricing;
};