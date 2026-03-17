import { Request } from 'express';
import { IProvider, ProviderResponse } from './base';
import { calculateSharedCost } from '../utils/pricing';
import { getSetting } from '@llm-observer/database';

export class GoogleProvider implements IProvider {
    getBaseUrl() {
        return 'https://generativelanguage.googleapis.com';
    }

    getAuthHeader(req: Request): Record<string, string> {
        let apiKey = [req.headers['x-goog-api-key'], req.query.key].flat().filter(Boolean)[0] as string | undefined;

        // Fallback to global setting
        if (!apiKey) {
            apiKey = getSetting('google_api_key') || undefined;
        }

        const headers: Record<string, string> = {};
        if (apiKey) headers['x-goog-api-key'] = apiKey;
        return headers;
    }

    parseRequest(req: Request, body: any) {
        // Google Gemini usually has the model in the URL: /v1beta/models/gemini-1.5-flash:generateContent
        let model = 'unknown';
        const match = req.path.match(/models\/([a-zA-Z0-9.-]+):/);
        if (match && match[1]) {
            model = match[1];
        } else if (body && body.model) {
            model = body.model;
        }

        let isStreaming = req.path.includes('streamGenerateContent');
        let hasTools = false;

        if (body && body.tools && Array.isArray(body.tools) && body.tools.length > 0) {
            hasTools = true;
        }

        return { model, isStreaming, hasTools };
    }

    parseResponse(responseBody: any, requestData: any): ProviderResponse {
        let promptTokens = 0;
        let completionTokens = 0;
        let totalTokens = 0;

        if (responseBody && responseBody.usageMetadata) {
            promptTokens = responseBody.usageMetadata.promptTokenCount || 0;
            completionTokens = responseBody.usageMetadata.candidatesTokenCount || 0;
            totalTokens = responseBody.usageMetadata.totalTokenCount || (promptTokens + completionTokens);
        }

        const costResult = this.calculateCost(requestData.model, promptTokens, completionTokens);

        return {
            provider: 'google',
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


    calculateCost(model: string, promptTokens: number, completionTokens: number): { costUsd: number, unknown: boolean } {
        return calculateSharedCost('google', model, promptTokens, completionTokens);
    }
}
