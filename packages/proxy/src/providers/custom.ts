import { Request } from 'express';
import { IProvider, ProviderResponse } from './base';
import { calculateSharedCost } from '../utils/pricing';

export class CustomProvider implements IProvider {
    private baseUrl: string = '';

    setBaseUrl(url: string) {
        this.baseUrl = url;
    }

    getBaseUrl() {
        return this.baseUrl || 'http://localhost:11434'; // Default to Ollama
    }

    getAuthHeader(req: Request): Record<string, string> {
        const auth = req.headers['authorization'];
        const headers: Record<string, string> = {};
        if (auth) headers['Authorization'] = auth as string;
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

        if (responseBody && responseBody.usage) {
            promptTokens = responseBody.usage.prompt_tokens || 0;
            completionTokens = responseBody.usage.completion_tokens || 0;
            totalTokens = responseBody.usage.total_tokens || 0;
        }

        const costResult = this.calculateCost(requestData.model, promptTokens, completionTokens);

        return {
            provider: 'custom',
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
        // Custom providers usually follow OpenAI format
        let promptTokens = 0;
        let completionTokens = 0;

        const lines = responseData.split('\n');
        for (const line of lines) {
            if (line.startsWith('data: ') && line !== 'data: [DONE]') {
                try {
                    const parsed = JSON.parse(line.substring(6));
                    if (parsed.usage) {
                        promptTokens = parsed.usage.prompt_tokens || promptTokens;
                        completionTokens = parsed.usage.completion_tokens || completionTokens;
                    }
                } catch (e) { }
            }
        }

        const costResult = this.calculateCost(requestData.model, promptTokens, completionTokens);

        return {
            provider: 'custom',
            model: requestData.model,
            isStreaming: true,
            promptTokens,
            completionTokens,
            totalTokens: promptTokens + completionTokens,
            costUsd: costResult.costUsd,
            pricing_unknown: costResult.unknown,
            hasTools: requestData.hasTools,
        };
    }

    calculateCost(model: string, promptTokens: number, completionTokens: number): { costUsd: number, unknown: boolean } {
        // For custom/local, cost is usually 0, but we check if we have pricing for it anyway
        return calculateSharedCost('custom', model, promptTokens, completionTokens);
    }
}
