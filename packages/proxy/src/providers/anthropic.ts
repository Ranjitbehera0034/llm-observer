import { Request } from 'express';
import { IProvider, ProviderResponse } from './base';
import { getDb } from '@llm-observer/database';

export class AnthropicProvider implements IProvider {
    getBaseUrl() {
        return 'https://api.anthropic.com';
    }

    getAuthHeader(req: Request) {
        const apiKeyList = [req.headers['x-api-key']].flat().filter(Boolean) as string[];
        const apiKey = apiKeyList[0];
        const headers: Record<string, string> = {};
        if (apiKey) headers['x-api-key'] = apiKey;

        const versionList = [req.headers['anthropic-version']].flat().filter(Boolean) as string[];
        const version = versionList[0];
        if (version) headers['anthropic-version'] = version;

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
            promptTokens = responseBody.usage.input_tokens || 0;
            completionTokens = responseBody.usage.output_tokens || 0;
            totalTokens = promptTokens + completionTokens;
        }

        const costUsd = this.calculateCost(requestData.model, promptTokens, completionTokens);

        return {
            provider: 'anthropic',
            model: requestData.model,
            isStreaming: requestData.isStreaming,
            promptTokens,
            completionTokens,
            totalTokens,
            costUsd,
            hasTools: requestData.hasTools,
        };
    }

    parseStreamResponse(responseData: string, requestData: any): ProviderResponse {
        let promptTokens = 0;
        let completionTokens = 0;

        const lines = responseData.split('\n');
        for (const line of lines) {
            if (line.startsWith('data: ')) {
                const dataStr = line.replace('data: ', '').trim();
                try {
                    const parsed = JSON.parse(dataStr);
                    if (parsed.type === 'message_start' && parsed.message && parsed.message.usage) {
                        promptTokens += (parsed.message.usage.input_tokens || 0);
                        completionTokens += (parsed.message.usage.output_tokens || 0);
                    } else if (parsed.type === 'message_delta' && parsed.usage) {
                        completionTokens += (parsed.usage.output_tokens || 0);
                    }
                } catch (e) {
                    // Ignore parsing errors for partial chunks
                }
            }
        }

        const totalTokens = promptTokens + completionTokens;
        const costUsd = this.calculateCost(requestData.model, promptTokens, completionTokens);

        return {
            provider: 'anthropic',
            model: requestData.model,
            isStreaming: true,
            promptTokens,
            completionTokens,
            totalTokens,
            costUsd,
            hasTools: requestData.hasTools,
        };
    }


    calculateCost(model: string, promptTokens: number, completionTokens: number): number {
        const db = getDb();
        const stmt = db.prepare('SELECT input_cost_per_1m, output_cost_per_1m FROM model_pricing WHERE provider = ? AND model = ? ORDER BY id DESC LIMIT 1');
        const pricing = stmt.get('anthropic', model) as any;

        if (!pricing) return 0;

        const inputCost = (promptTokens / 1_000_000) * pricing.input_cost_per_1m;
        const outputCost = (completionTokens / 1_000_000) * pricing.output_cost_per_1m;

        return inputCost + outputCost;
    }
}
