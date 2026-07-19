import { Request } from 'express';
import { IProvider, ProviderResponse } from './base';
import { getSetting } from '@llm-observer/database';

/**
 * Ollama Provider (first-class, not the generic custom/local fallback)
 *
 * Ollama has two response shapes depending on which endpoint the client hits:
 *  - Native  (/api/chat, /api/generate): usage lives at top level as
 *    `prompt_eval_count` / `eval_count`, no `usage` object.
 *  - OpenAI-compat (/v1/chat/completions, supported since Ollama 0.x):
 *    standard `usage.prompt_tokens` / `usage.completion_tokens`.
 *
 * Local inference has no per-token price — cost is always $0, and unlike an
 * unrecognized cloud model this is a known fact, not missing pricing data.
 */
export class OllamaProvider implements IProvider {
    getBaseUrl() {
        return getSetting('ollama_base_url') || 'http://localhost:11434';
    }

    getAuthHeader(_req: Request): Record<string, string> {
        // Ollama has no auth by default; pass through only if the user set one
        // up behind a reverse proxy.
        const token = getSetting('ollama_api_key');
        return token ? { Authorization: `Bearer ${token}` } : {};
    }

    parseRequest(req: Request, body: any) {
        let model = 'unknown';
        let isStreaming = false;
        let hasTools = false;

        if (body) {
            if (body.model) model = body.model;
            // Ollama defaults `stream` to true unless explicitly disabled
            isStreaming = body.stream !== false;
            if (body.tools && Array.isArray(body.tools) && body.tools.length > 0) hasTools = true;
        }

        return { model, isStreaming, hasTools };
    }

    parseResponse(responseBody: any, requestData: any): ProviderResponse {
        let promptTokens = 0;
        let completionTokens = 0;

        if (responseBody?.usage) {
            // OpenAI-compat endpoint
            promptTokens = responseBody.usage.prompt_tokens || 0;
            completionTokens = responseBody.usage.completion_tokens || 0;
        } else {
            // Native Ollama endpoint — counts appear on the final streamed
            // chunk (done: true) or the whole body for non-streaming calls
            promptTokens = responseBody?.prompt_eval_count || 0;
            completionTokens = responseBody?.eval_count || 0;
        }

        const totalTokens = promptTokens + completionTokens;
        const costResult = this.calculateCost(requestData.model, promptTokens, completionTokens);

        return {
            provider: 'ollama',
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

    calculateCost(_model: string, _promptTokens: number, _completionTokens: number): { costUsd: number, unknown: boolean } {
        // Self-hosted inference: the price is known to be zero, not unknown.
        return { costUsd: 0, unknown: false };
    }
}
