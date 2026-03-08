import { PricingRecord } from './repositories/pricing.repo';
export interface PricingEntry extends PricingRecord {
}
/**
 * LLM Model Pricing Data
 * All prices in USD per 1 Million tokens
 * Last verified: March 2026
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
    input: number;
    output: number;
    cached: number | null;
}
export declare const getInitialPricing: () => PricingEntry[];
export declare const seedPricing: () => void;
/**
 * Upsert pricing — inserts new models and updates existing ones.
 * Call this to refresh pricing without wiping the table.
 */
export declare const refreshPricing: (pricingData?: PricingEntry[]) => void;
/**
 * Get all pricing data from the database
 */
export declare const getAllPricing: () => unknown[];
/**
 * Get pricing for a specific model
 */
export declare const getModelPricing: (provider: string, model: string) => unknown;
//# sourceMappingURL=seed.d.ts.map