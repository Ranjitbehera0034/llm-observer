import { Request, Response } from 'express';
import httpProxy from 'http-proxy';
import { Readable } from 'stream';
import { IProvider } from './providers/base';
import { OpenAIProvider } from './providers/openai';
import { AnthropicProvider } from './providers/anthropic';
import { MistralProvider } from './providers/mistral';
import { GroqProvider } from './providers/groq';
import { CustomProvider } from './providers/custom';
import chalk from 'chalk';
import { incrementSpendCache } from './budgetGuard';
import { requestEventEmitter } from './dashboardApi';
import { internalLogger } from './internalLogger';
import crypto from 'crypto';
import { StreamHandler } from './utils/streamHandler';

// Simple in-memory tracker for requests (project_id -> timestamps[])
const requestWindow: Record<string, number[]> = {};

export const proxy = httpProxy.createProxyServer({
    changeOrigin: true,
    // We will handle errors ourselves
});

import { GoogleProvider } from './providers/google';

const providers: Record<string, IProvider> = {
    openai: new OpenAIProvider(),
    anthropic: new AnthropicProvider(),
    google: new GoogleProvider(),
    mistral: new MistralProvider(),
    groq: new GroqProvider(),
    custom: new CustomProvider(),
};

export const handleProxyRequest = async (req: Request, res: Response, providerName: string) => {
    const provider = providers[providerName];
    if (!provider) {
        return res.status(400).json({ error: `Unsupported provider: ${providerName}` });
    }

    const targetUrl = (req as any).customTargetUrl || provider.getBaseUrl();
    const authHeaders = provider.getAuthHeader(req);

    const projectId = (req as any).projectId || 'default';
    const cacheKey = (req as any).cacheKey || 'default';

    // Inject stream_options for OpenAI-compatible providers to get usage metrics in stream
    if ((providerName === 'openai' || providerName === 'groq') && req.body?.stream) {
        req.body.stream_options = { include_usage: true };
    }

    // Parse request to get model details
    const requestInfo = provider.parseRequest(req, req.body);
    const requestStartTime = Date.now();

    const _write = res.write;
    const _end = res.end;

    // DB Logging payload (Strictly truncated to 50KB)
    let dbResponseBody = '';
    let dbResponseTruncated = false;
    const MAX_DB_SIZE = 50 * 1024;

    let requestBodyStr = JSON.stringify(req.body);
    if (requestBodyStr.length > MAX_DB_SIZE) {
        requestBodyStr = requestBodyStr.substring(0, MAX_DB_SIZE) + '... [TRUNCATED]';
    }

    const streamHandler = new StreamHandler(providerName);
    let fullBufferForJson = ''; // Only used if non-streaming

    const processChunk = (chunkStr: string) => {
        // 1. Accumulate for DB (with limits)
        if (!dbResponseTruncated) {
            if (dbResponseBody.length + chunkStr.length > MAX_DB_SIZE) {
                dbResponseBody += chunkStr.substring(0, MAX_DB_SIZE - dbResponseBody.length) + '\n... [TRUNCATED]';
                dbResponseTruncated = true;
            } else {
                dbResponseBody += chunkStr;
            }
        }

        // 2. Extract usage
        if (requestInfo.isStreaming) {
            streamHandler.processChunk(chunkStr);
        } else {
            // Non-streaming: accumulate safely up to 5MB
            if (fullBufferForJson.length < 5 * 1024 * 1024) {
                fullBufferForJson += chunkStr;
            }
        }
    };

    res.write = function (this: any, chunk: any, encoding?: any, cb?: any) {
        if (chunk) processChunk(chunk.toString());
        return _write.call(this, chunk, encoding, cb);
    } as any;

    res.end = function (this: any, chunk: any, encoding?: any, cb?: any) {
        if (chunk) processChunk(chunk.toString());

        const latency = Date.now() - requestStartTime;
        const statusCode = res.statusCode;

        try {
            let usage = null;
            const extractedUsage = streamHandler.getUsage();

            if (requestInfo.isStreaming && extractedUsage) {
                let p = extractedUsage.prompt_tokens || 0;
                let c = extractedUsage.completion_tokens || 0;
                // Use generic provider interface for calculating costs locally
                const costResult = provider.calculateCost(requestInfo.model, p, c);
                usage = {
                    promptTokens: p,
                    completionTokens: c,
                    totalTokens: p + c,
                    costUsd: costResult.costUsd,
                    pricing_unknown: costResult.unknown
                };
            } else if (!requestInfo.isStreaming && fullBufferForJson) {
                try {
                    const parsedResponse = JSON.parse(fullBufferForJson);
                    usage = provider.parseResponse(parsedResponse, requestInfo);
                } catch (e) { }
            }

            let promptHash = null;
            if (req.body && (req.body.messages || req.body.prompt)) {
                const hashPayload = {
                    model: req.body.model,
                    messages: req.body.messages,
                    prompt: req.body.prompt
                };
                promptHash = crypto.createHash('sha256').update(JSON.stringify(hashPayload)).digest('hex');
            }

            const reqRecord = {
                project_id: projectId,
                provider: providerName,
                model: requestInfo.model,
                endpoint: req.path,
                prompt_tokens: usage?.promptTokens || 0,
                completion_tokens: usage?.completionTokens || 0,
                total_tokens: usage?.totalTokens || 0,
                cost_usd: usage?.costUsd || 0,
                latency_ms: latency,
                status_code: statusCode,
                status: statusCode >= 400 ? 'error' : 'success',
                is_streaming: requestInfo.isStreaming ? 1 : 0,
                has_tools: requestInfo.hasTools ? 1 : 0,
                pricing_unknown: usage?.pricing_unknown ? 1 : 0,
                tags: (req.headers['x-tags'] || req.headers['x-llm-observer-tags']) as string || undefined,
                request_body: requestBodyStr,
                response_body: dbResponseBody,
                prompt_hash: promptHash || undefined,
                created_at: new Date().toISOString()
            };

            // ✅ FIX BUG-02: Immediately update in-memory spend cache so burst requests are blocked
            if (usage?.costUsd && usage.costUsd > 0) {
                incrementSpendCache((req as any).cacheKey || 'default', usage.costUsd);
            }

            // ✅ Emit SSE Event (real-time dashboard)
            requestEventEmitter.emit('new_request', reqRecord);

            // ✅ Fire-and-forget background SQLite log via internal batch logger
            internalLogger.add({
                ...reqRecord,
                is_streaming: !!reqRecord.is_streaming,
                has_tools: !!reqRecord.has_tools,
                pricing_unknown: !!reqRecord.pricing_unknown,
                tags: reqRecord.tags || undefined,
                prompt_hash: reqRecord.prompt_hash || undefined
            })
                .catch((err: any) => console.error('Failed to enqueue request log:', err));

            // Log output securely
            console.log(chalk.green(`✓ [${providerName}] ${requestInfo.model} | ${usage?.totalTokens || 0} tokens | ${latency}ms | $${(usage?.costUsd || 0).toFixed(6)}`));

            const now = Date.now();
            const windowStart = now - 60000;

            if (!requestWindow[projectId]) requestWindow[projectId] = [];
            requestWindow[projectId] = requestWindow[projectId].filter(t => t > windowStart);
            requestWindow[projectId].push(now);

            if (requestWindow[projectId].length > 10) {
                console.log(chalk.yellow(`\n[ANOMALY DETECTED] High volume of requests (${requestWindow[projectId].length}/min) for project '${projectId}'!`));
            }

        } catch (err) {
            console.error('Error logging request:', err);
        }

        return _end.call(this, chunk, encoding, cb);
    } as any;

    proxy.web(req, res, {
        target: targetUrl,
        headers: { ...authHeaders },
        buffer: Readable.from([JSON.stringify(req.body)])
    }, (err) => {
        console.error('Proxy Error:', err);
        const errorRecord = {
            project_id: projectId,
            provider: providerName,
            model: requestInfo.model || 'unknown',
            endpoint: req.path,
            prompt_tokens: 0,
            completion_tokens: 0,
            total_tokens: 0,
            cost_usd: 0,
            latency_ms: Date.now() - requestStartTime,
            status_code: 502,
            status: 'error',
            error_message: err.message,
            request_body: requestBodyStr,
            created_at: new Date().toISOString()
        };
        internalLogger.add(errorRecord).catch(e => console.error('Failed to log proxy error:', e));

        if (!res.headersSent) res.status(502).json({ error: 'Bad Gateway', details: err.message });
    });
};
