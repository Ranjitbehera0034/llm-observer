import { fetchPricingFromDb, syncPricingToDb } from '@llm-observer/database';
import fetch from 'node-fetch';

let pricingCache = new Map<string, any>();

export const refreshPricingCache = () => {
    try {
        const list = fetchPricingFromDb();
        pricingCache.clear();
        for (const item of list) {
            pricingCache.set(`${item.provider}:${item.model}`, item);
        }
    } catch (err) {
        console.error('Failed to refresh local pricing cache from DB', err);
    }
};

export const initPricingCache = async () => {
    try {
        await syncRemotePricing();
        refreshPricingCache();
        
        // Auto-refresh cache periodically in case CLI modifies DB
        setInterval(refreshPricingCache, 1000 * 60 * 5); // 5 mins
    } catch (err) {
        console.error('Failed to init pricing cache', err);
    }
};

const REMOTE_PRICING_URL = 'https://raw.githubusercontent.com/Ranjitbehera0034/llm-observer/main/pricing.json';

const syncRemotePricing = async () => {
    try {
        const res = await fetch(REMOTE_PRICING_URL, { signal: AbortSignal.timeout(3000) as any });
        if (res.ok) {
            const rawData = await res.json() as any[];
            // Fix schema mismatch: Remote JSON uses *_cost_per_1m, DB repo expects input/output/cached keys
            const mappedData = rawData.map(item => ({
                provider: item.provider,
                model: item.model,
                input: item.input ?? item.input_cost_per_1m ?? 0,
                output: item.output ?? item.output_cost_per_1m ?? 0,
                cached: item.cached ?? item.cached_input_cost_per_1m ?? null
            }));
            syncPricingToDb(mappedData);
            console.log(`Synced ${mappedData.length} pricing entries from remote registry.`);
        }
    } catch (e: any) {
        console.warn('Could not sync remote pricing, falling back to local DB cache.', e.message);
    }
};

export const calculateSharedCost = (provider: string, model: string, promptTokens: number, completionTokens: number): { costUsd: number, unknown: boolean } => {
    let pricing = pricingCache.get(`${provider}:${model}`);

    // Fallback: Fuzzy matching for models like gpt-4o-2024-08-06 -> gpt-4o
    if (!pricing) {
        for (const [key, val] of pricingCache.entries()) {
            if (val.provider === provider && model.startsWith(val.model)) {
                if (!pricing || val.model.length > pricing.model.length) {
                    pricing = val;
                }
            }
        }
    }

    if (!pricing) return { costUsd: 0, unknown: true };

    const inputCost = (promptTokens / 1_000_000) * (pricing.input_cost_per_1m || pricing.input || 0);
    const outputCost = (completionTokens / 1_000_000) * (pricing.output_cost_per_1m || pricing.output || 0);

    return { costUsd: inputCost + outputCost, unknown: false };
};
