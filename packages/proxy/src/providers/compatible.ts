import { Request } from 'express';
import { OpenAIProvider } from './openai';
import { getSetting } from '@llm-observer/database';
import { calculateSharedCost } from '../utils/pricing';

// No model allowlist: future model IDs are recorded as returned by the provider.
// An unknown price remains unpriced until the catalog or a custom rate is added.
export const COMPATIBLE_PROVIDERS: Record<string, string> = {
    moonshot: 'https://api.moonshot.ai',
    deepseek: 'https://api.deepseek.com',
    openrouter: 'https://openrouter.ai/api',
    xai: 'https://api.x.ai',
};
export class CompatibleProvider extends OpenAIProvider {
    constructor(private readonly name: string, private readonly baseUrl: string) { super(); }
    getBaseUrl() { return this.baseUrl; }
    getAuthHeader(req: Request): Record<string,string> {
        const key = getSetting(`${this.name}_api_key`);
        // Observer project keys are never forwarded to upstream providers.
        const supplied = typeof req.headers.authorization === 'string' ? req.headers.authorization : '';
        const auth = supplied && !supplied.includes('llmo_') ? supplied : key ? `Bearer ${key}` : '';
        return auth ? { Authorization: auth } : {};
    }
    parseResponse(body: any, requestData: any) {
        const rawUsage = body?.usage;
        const usage = rawUsage ? { ...rawUsage, prompt_tokens: rawUsage.prompt_tokens ?? rawUsage.input_tokens, completion_tokens: rawUsage.completion_tokens ?? rawUsage.output_tokens } : undefined;
        const cached = rawUsage?.prompt_tokens_details?.cached_tokens ?? rawUsage?.input_tokens_details?.cached_tokens ?? rawUsage?.prompt_cache_hit_tokens ?? 0;
        const valid = [usage?.prompt_tokens,usage?.completion_tokens].every(n => Number.isSafeInteger(n) && n >= 0);
        const model = typeof body?.model === 'string' && body.model ? body.model : requestData.model;
        const result = super.parseResponse({...body,usage}, {...requestData,model});
        const cost = this.calculateCost(model, result.promptTokens, result.completionTokens, cached);
        return { ...result, totalTokens: result.promptTokens + result.completionTokens, costUsd: cost.costUsd, provider: this.name, pricing_unknown: cost.unknown || !valid };
    }
    calculateCost(model: string, input: number, output: number, cached = 0) { return calculateSharedCost(this.name, model, input, output, cached); }
}
