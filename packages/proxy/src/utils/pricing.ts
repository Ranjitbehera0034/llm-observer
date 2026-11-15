import { fetchPricingFromDb, refreshPricing } from '@llm-observer/database';
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
        setInterval(refreshPricingCache, 1000 * 60 * 5).unref();
        setInterval(() => { void syncRemotePricing().then(refreshPricingCache); }, 24 * 60 * 60 * 1000).unref(); // 5 mins
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
                input: item.input ?? item.input_cost_per_1m,
                output: item.output ?? item.output_cost_per_1m,
                cached: item.cached ?? item.cached_input_cost_per_1m ?? null
            }));
            // Upsert instead of wipe-and-replace: models seeded locally but absent
            // from the remote registry (e.g. newly released) must survive the sync
            refreshPricing(mappedData);
            console.log(`Synced ${mappedData.length} pricing entries from remote registry.`);
        }
    } catch (e: any) {
        console.warn('Could not sync remote pricing, falling back to local DB cache.', e.message);
    }
};

export const getPricingWithFuzzy = (provider: string, model: string): any | undefined => {
    let pricing = pricingCache.get(`${provider}:${model}`);

    if (!pricing) {
        for (const [key, val] of pricingCache.entries()) {
            if (val.provider === provider && /^-(?:\d{8}|\d{4}-\d{2}-\d{2})$/.test(model.slice(val.model.length)) && model.startsWith(val.model)) {
                if (!pricing || val.model.length > pricing.model.length) {
                    pricing = val;
                }
            }
        }
    }
    return pricing;
};

export const calculateSharedCost = (provider: string, model: string, promptTokens: number, completionTokens: number, cachedTokens = 0): { costUsd: number, unknown: boolean } => {
    let pricing = getPricingWithFuzzy(provider, model);

    if (!pricing) return { costUsd: 0, unknown: true };
    const inputRate = pricing.input_cost_per_1m ?? pricing.input;
    const outputRate = pricing.output_cost_per_1m ?? pricing.output;
    if (![promptTokens, completionTokens, cachedTokens, inputRate, outputRate].every(n => typeof n === 'number' && Number.isFinite(n) && n >= 0)) return { costUsd: 0, unknown: true };

    const cachedRate = pricing.cached_input_cost_per_1m ?? pricing.cached;
    if (cachedTokens > promptTokens || (cachedTokens > 0 && (typeof cachedRate !== 'number' || !Number.isFinite(cachedRate) || cachedRate < 0))) return { costUsd: 0, unknown: true };
    const inputCost = ((promptTokens - cachedTokens) * inputRate + cachedTokens * (cachedRate ?? 0)) / 1_000_000;
    const outputCost = (completionTokens / 1_000_000) * outputRate;

    return { costUsd: inputCost + outputCost, unknown: false };
};
