import { Request } from 'express';
import { IProvider, ProviderResponse } from './base';
import { calculateSharedCost } from '../utils/pricing';

export class GoogleProvider implements IProvider {
    getBaseUrl() {
        return 'https://generativelanguage.googleapis.com';
    }

    getAuthHeader(req: Request): Record<string, string> {
        const apiKeyList = [req.headers['x-goog-api-key']].flat().filter(Boolean) as string[];
        const apiKey = apiKeyList[0];
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

    parseStreamResponse(responseData: string, requestData: any): ProviderResponse {
        let promptTokens = 0;
        let completionTokens = 0;
        let totalTokens = 0;

        // Gemini streams are typically SSE (data: {...}) or JSON arrays representing SSE
        const lines = responseData.split('\n');
        for (const line of lines) {
            let dataStr = line.trim();
            if (dataStr.startsWith('data: ')) {
                dataStr = dataStr.replace('data: ', '').trim();
            }

            // Also handle raw JSON parsing if Google sends array format like `[\n{...},\n{...}\n]`
            if (dataStr.startsWith('[') || dataStr.startsWith(',')) {
                dataStr = dataStr.replace(/^\[/, '').replace(/^,/, '').trim();
            }
            if (dataStr.endsWith(']')) {
                dataStr = dataStr.substring(0, dataStr.length - 1).trim();
            }

            if (!dataStr) continue;

            try {
                const parsed = JSON.parse(dataStr);
                if (parsed.usageMetadata) {
                    // Usually we take the last reported usage metadata as total
                    promptTokens = parsed.usageMetadata.promptTokenCount || promptTokens;
                    completionTokens = parsed.usageMetadata.candidatesTokenCount || completionTokens;
                    totalTokens = parsed.usageMetadata.totalTokenCount || totalTokens;
                }
            } catch (e) {
                // Ignore parse errors on partial chunks
            }
        }

        if (totalTokens === 0) {
            totalTokens = promptTokens + completionTokens;
        }

        const costResult = this.calculateCost(requestData.model, promptTokens, completionTokens);

        return {
            provider: 'google',
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
        return calculateSharedCost('google', model, promptTokens, completionTokens);
    }
}
