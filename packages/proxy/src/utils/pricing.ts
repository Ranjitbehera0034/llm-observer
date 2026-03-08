import { fetchPricingFromDb, syncPricingToDb } from '@llm-observer/database';
import fetch from 'node-fetch';

let pricingCache = new Map<string, any>();

export const initPricingCache = async () => {
    try {
        await syncRemotePricing();
        const list = fetchPricingFromDb();
        pricingCache.clear();
        for (const item of list) {
            pricingCache.set(`${item.provider}:${item.model}`, item);
        }
    } catch (err) {
        console.error('Failed to init pricing cache', err);
    }
};

const REMOTE_PRICING_URL = 'https://raw.githubusercontent.com/run-llama/llm-observer/main/pricing.json';

const syncRemotePricing = async () => {
    try {
        const res = await fetch(REMOTE_PRICING_URL, { timeout: 3000 });
        if (res.ok) {
            const data = await res.json() as any[];
            syncPricingToDb(data);
            console.log(`Synced ${data.length} pricing entries from remote registry.`);
        }
    } catch (e: any) {
        console.warn('Could not sync remote pricing, falling back to local DB cache.', e.message);
    }
};

export const calculateSharedCost = (provider: string, model: string, promptTokens: number, completionTokens: number): { costUsd: number, unknown: boolean } => {
    const pricing = pricingCache.get(`${provider}:${model}`);

    if (!pricing) return { costUsd: 0, unknown: true };

    const inputCost = (promptTokens / 1_000_000) * pricing.input_cost_per_1m;
    const outputCost = (completionTokens / 1_000_000) * pricing.output_cost_per_1m;

    return { costUsd: inputCost + outputCost, unknown: false };
};
