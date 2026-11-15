import { Request } from 'express';
import { IProvider, ProviderResponse } from './base';
import { calculateSharedCost } from '../utils/pricing';
import { getSetting } from '@llm-observer/database';

export class OpenAIProvider implements IProvider {
    getBaseUrl() {
        return 'https://api.openai.com';
    }

    getAuthHeader(req: Request): Record<string, string> {
        let auth = [req.headers['authorization']].flat().filter(Boolean)[0] as string | undefined;

        // Fallback to global setting if no header provided or if it's an observer key
        const isObserverKey = auth?.includes('llmo_');
        if (!auth || isObserverKey) {
            const globalKey = getSetting('openai_api_key');
            if (globalKey) {
                auth = `Bearer ${globalKey}`;
            } else if (isObserverKey) {
                auth = undefined; // Don't forward llmo_ key
            }
        }

        const headers: Record<string, string> = {};
        if (auth) headers['Authorization'] = auth;
        return headers;
    }

    parseRequest(req: Request, body: any) {
        let model = 'unknown';
        let isStreaming = false;
        let hasTools = false;

        if (body) {
            if (body.model) model = body.model;
            if (body.stream === true) isStreaming = true;
            if (body.tools && Array.isArray(body.tools) && body.tools.length > 0) hasTools = true;
            if (body.functions && Array.isArray(body.functions) && body.functions.length > 0) hasTools = true;
        }

        return { model, isStreaming, hasTools };
    }

    parseResponse(responseBody: any, requestData: any): ProviderResponse {
        let promptTokens = 0;
        let completionTokens = 0;
        let totalTokens = 0;

        if (responseBody && responseBody.usage) {
            promptTokens = responseBody.usage.prompt_tokens ?? responseBody.usage.input_tokens ?? 0;
            completionTokens = responseBody.usage.completion_tokens ?? responseBody.usage.output_tokens ?? 0;
            totalTokens = promptTokens + completionTokens;
        }

        const model = typeof responseBody?.model === 'string' && responseBody.model ? responseBody.model : requestData.model;
        const cached = responseBody?.usage?.prompt_tokens_details?.cached_tokens ?? responseBody?.usage?.input_tokens_details?.cached_tokens ?? 0;
        const validUsage = [responseBody?.usage?.prompt_tokens ?? responseBody?.usage?.input_tokens, responseBody?.usage?.completion_tokens ?? responseBody?.usage?.output_tokens].every(n => Number.isSafeInteger(n) && n >= 0);
        const costResult = this.calculateCost(model, promptTokens, completionTokens, cached);

        return {
            provider: 'openai',
            model,
            isStreaming: requestData.isStreaming,
            promptTokens,
            completionTokens,
            totalTokens,
            costUsd: costResult.costUsd,
            pricing_unknown: costResult.unknown || !validUsage,
            hasTools: requestData.hasTools,
        };
    }


    calculateCost(model: string, promptTokens: number, completionTokens: number, cachedTokens = 0): { costUsd: number, unknown: boolean } {
        return calculateSharedCost('openai', model, promptTokens, completionTokens, cachedTokens);
    }
}
