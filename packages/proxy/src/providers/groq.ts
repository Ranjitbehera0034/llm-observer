import { Request } from 'express';
import { IProvider, ProviderResponse } from './base';
import { calculateSharedCost } from '../utils/pricing';
import { getSetting } from '@llm-observer/database';

/**
 * Groq Provider
 * Uses Bearer token auth, fully OpenAI-compatible request/response format.
 * Base URL: https://api.groq.com/openai
 * Models: llama-3.3-70b-versatile, llama-3.1-8b-instant, mixtral-8x7b-32768,
 *         gemma2-9b-it, llama-guard-3-8b, whisper-large-v3-turbo
 *
 * Groq delivers ultra-fast inference via LPU hardware, so latency tracking
 * is especially valuable here.
 */
export class GroqProvider implements IProvider {
    getBaseUrl() {
        // Groq's OpenAI-compatible endpoint lives under /openai prefix
        return 'https://api.groq.com/openai';
    }

    getAuthHeader(req: Request): Record<string, string> {
        let auth = [req.headers['authorization']].flat().filter(Boolean)[0] as string | undefined;

        // Fallback to global setting if no header provided
        if (!auth) {
            const globalKey = getSetting('groq_api_key');
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

        // Groq uses OpenAI-compatible usage format
        // Also surfaces x_groq.usage in some responses
        if (responseBody && responseBody.usage) {
            promptTokens = responseBody.usage.prompt_tokens || 0;
            completionTokens = responseBody.usage.completion_tokens || 0;
            totalTokens = responseBody.usage.total_tokens || 0;
        }

        const costResult = this.calculateCost(requestData.model, promptTokens, completionTokens);

        return {
            provider: 'groq',
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

        // Groq streams in OpenAI SSE format: usage appears on the final chunk
        const lines = responseData.split('\n');
        for (const line of lines) {
            if (line.startsWith('data: ') && line !== 'data: [DONE]') {
                const dataStr = line.replace('data: ', '').trim();
                try {
                    const parsed = JSON.parse(dataStr);
                    // Usage is included in the last streamed chunk by Groq
                    if (parsed.usage) {
                        promptTokens = parsed.usage.prompt_tokens || 0;
                        completionTokens = parsed.usage.completion_tokens || 0;
                        totalTokens = parsed.usage.total_tokens || 0;
                    }
                    // Groq may also surface usage inside x_groq object
                    if (parsed.x_groq?.usage) {
                        promptTokens = parsed.x_groq.usage.prompt_tokens || promptTokens;
                        completionTokens = parsed.x_groq.usage.completion_tokens || completionTokens;
                        totalTokens = parsed.x_groq.usage.total_tokens || totalTokens;
                    }
                } catch (e) {
                    // Ignore parse errors on partial chunks
                }
            }
        }

        const costResult = this.calculateCost(requestData.model, promptTokens, completionTokens);

        return {
            provider: 'groq',
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
        return calculateSharedCost('groq', model, promptTokens, completionTokens);
    }
}
