import { Request } from 'express';
import { IProvider, ProviderResponse } from './base';
import { calculateSharedCost } from '../utils/pricing';
import { getSetting } from '@llm-observer/database';

/**
 * Mistral AI Provider
 * Uses Bearer token auth, OpenAI-compatible request/response format.
 * Base URL: https://api.mistral.ai
 * Models: mistral-large-latest, mistral-medium-latest, mistral-small-latest,
 *         codestral-latest, open-mistral-nemo, open-codestral-mamba
 */
export class MistralProvider implements IProvider {
    getBaseUrl() {
        return 'https://api.mistral.ai';
    }

    getAuthHeader(req: Request): Record<string, string> {
        let auth = [req.headers['authorization']].flat().filter(Boolean)[0] as string | undefined;

        // Fallback to global setting if no header provided
        if (!auth) {
            const globalKey = getSetting('mistral_api_key');
            if (globalKey) {
                auth = `Bearer ${globalKey}`;
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
        }

        return { model, isStreaming, hasTools };
    }

    parseResponse(responseBody: any, requestData: any): ProviderResponse {
        let promptTokens = 0;
        let completionTokens = 0;
        let totalTokens = 0;

        // Mistral uses OpenAI-compatible usage format
        if (responseBody && responseBody.usage) {
            promptTokens = responseBody.usage.prompt_tokens || 0;
            completionTokens = responseBody.usage.completion_tokens || 0;
            totalTokens = responseBody.usage.total_tokens || 0;
        }

        const costResult = this.calculateCost(requestData.model, promptTokens, completionTokens);

        return {
            provider: 'mistral',
            model: requestData.model,
            isStreaming: requestData.isStreaming,
            promptTokens,
            completionTokens,
            totalTokens,
            costUsd: costResult.costUsd,
            pricing_unknown: costResult.unknown,
            hasTools: requestData.hasTools,
        };
    }

    parseStreamResponse(responseData: string, requestData: any): ProviderResponse {
        let promptTokens = 0;
        let completionTokens = 0;
        let totalTokens = 0;

        // Mistral streams data: SSE in OpenAI-compatible format
        const lines = responseData.split('\n');
        for (const line of lines) {
            if (line.startsWith('data: ') && line !== 'data: [DONE]') {
                const dataStr = line.replace('data: ', '').trim();
                try {
                    const parsed = JSON.parse(dataStr);
                    if (parsed.usage) {
                        promptTokens = parsed.usage.prompt_tokens || 0;
                        completionTokens = parsed.usage.completion_tokens || 0;
                        totalTokens = parsed.usage.total_tokens || 0;
                    }
                } catch (e) {
                    // Ignore parse errors on partial chunks
                }
            }
        }

        const costResult = this.calculateCost(requestData.model, promptTokens, completionTokens);

        return {
            provider: 'mistral',
            model: requestData.model,
            isStreaming: true,
            promptTokens,
            completionTokens,
            totalTokens,
            costUsd: costResult.costUsd,
            pricing_unknown: costResult.unknown,
            hasTools: requestData.hasTools,
        };
    }

    calculateCost(model: string, promptTokens: number, completionTokens: number): { costUsd: number, unknown: boolean } {
        return calculateSharedCost('mistral', model, promptTokens, completionTokens);
    }
}
