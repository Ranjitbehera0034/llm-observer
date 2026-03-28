import { Request, Response } from 'express';
import httpProxy from 'http-proxy';
import { Readable } from 'stream';
import { IProvider } from './providers/base';
import { OpenAIProvider } from './providers/openai';
import { AnthropicProvider } from './providers/anthropic';
import { GoogleProvider } from './providers/google';
import { MistralProvider } from './providers/mistral';
import { GroqProvider } from './providers/groq';
import { CustomProvider } from './providers/custom';
import chalk from 'chalk';
import { incrementSpendCache } from './budgetGuard';
import { requestEventEmitter } from './dashboardApi';
import { internalLogger } from './internalLogger';
import crypto from 'crypto';
import { StreamHandler } from './utils/streamHandler';
import './types';

export const proxy = httpProxy.createProxyServer({
    changeOrigin: true,
    selfHandleResponse: true
});


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

    const targetUrl = req.customTargetUrl || provider.getBaseUrl();
    const authHeaders = provider.getAuthHeader(req);

    // Strip original auth headers from incoming request to avoid pass-through of Observer Keys
    delete req.headers['authorization'];
    delete req.headers['x-api-key'];

    const projectId = req.projectId || 'default';
    const cacheKey = req.cacheKey || 'default';

    // Inject stream_options for OpenAI-compatible providers to get usage metrics in stream
    if ((providerName === 'openai' || providerName === 'groq') && req.body?.stream) {
        req.body.stream_options = { include_usage: true };
    }
    
    // Always delete content-length because we are re-streaming the stringified body
    delete req.headers['content-length'];

    // Parse request to get model details
    const requestInfo = provider.parseRequest(req, req.body);
    const requestStartTime = Date.now();

    const MAX_DB_SIZE = 50 * 1024;
    let requestBodyStr = JSON.stringify(req.body || {});
    if (requestBodyStr.length > MAX_DB_SIZE) {
        requestBodyStr = requestBodyStr.substring(0, MAX_DB_SIZE) + '... [TRUNCATED]';
    }
    const streamHandler = new StreamHandler(providerName);

    (req as any).observerMeta = {
        providerName,
        requestInfo,
        requestStartTime,
        projectId,
        cacheKey,
        requestBodyStr,
        streamHandler
    };

    proxy.web(req, res, {
        target: targetUrl,
        headers: { ...authHeaders },
        buffer: Readable.from([JSON.stringify(req.body || {})])
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

proxy.on('proxyRes', function (proxyRes, req: any, res: any) {
    const meta = req.observerMeta;
    if (!meta) {
        // Fallback for non-LLM requests
        res.writeHead(proxyRes.statusCode || 200, proxyRes.headers);
        proxyRes.pipe(res);
        return;
    }

    const { providerName, requestInfo, requestStartTime, projectId, cacheKey, requestBodyStr, streamHandler } = meta;
    const isError = (proxyRes.statusCode || 200) >= 400;

    let dbResponseBody = '';
    let dbResponseTruncated = false;
    const MAX_DB_SIZE = 50 * 1024;
    let fullBufferForJson = '';

    const processChunkForLogs = (chunkStr: string) => {
        if (!dbResponseTruncated) {
            if (dbResponseBody.length + chunkStr.length > MAX_DB_SIZE) {
                dbResponseBody += chunkStr.substring(0, MAX_DB_SIZE - dbResponseBody.length) + '\n... [TRUNCATED]';
                dbResponseTruncated = true;
            } else {
                dbResponseBody += chunkStr;
            }
        }
        if (requestInfo.isStreaming) {
            streamHandler.processChunk(chunkStr);
        } else {
            if (fullBufferForJson.length < 5 * 1024 * 1024) {
                fullBufferForJson += chunkStr;
            }
        }
    };

    // We MUST capture headers before streaming starts
    const copiedHeaders = { ...proxyRes.headers };

    if (isError && !requestInfo.isStreaming) {
        // BUFFER THE ERROR
        proxyRes.on('data', (chunk: any) => {
            fullBufferForJson += chunk.toString('utf8');
        });

        proxyRes.on('end', () => {
            let enrichedBody = fullBufferForJson;
            try {
                const parsed = JSON.parse(fullBufferForJson);
                let observerNote = 'Unknown error';
                const sc = proxyRes.statusCode || 200;
                if (sc === 402) observerNote = `${providerName} returned 402: insufficient credits or payment required.`;
                else if (sc === 429) observerNote = `${providerName} returned 429: rate limited. Check your usage limits.`;
                else if (sc === 401) observerNote = `${providerName} returned 401: unauthorized. Check your API key.`;
                else if (sc === 500) observerNote = `${providerName} returned 500: internal server error.`;
                else if (sc >= 500) observerNote = `${providerName} returned ${sc}: provider gateway error.`;
                else observerNote = `${providerName} returned ${sc} error.`;

                if (typeof parsed === 'object' && parsed !== null) {
                    if (parsed.error && typeof parsed.error === 'object') {
                        parsed.error._source = providerName;
                        parsed.error._observer_note = observerNote;
                    } else {
                        parsed._source = providerName;
                        parsed._observer_note = observerNote;
                    }
                    enrichedBody = JSON.stringify(parsed);
                }
            } catch (e) {}

            dbResponseBody = enrichedBody;
            res.status(proxyRes.statusCode || 200);
            
            // Set headers except chunking
            for (const k of Object.keys(copiedHeaders)) {
                if (k.toLowerCase() !== 'transfer-encoding' && k.toLowerCase() !== 'content-length') {
                    res.setHeader(k, copiedHeaders[k]);
                }
            }
            res.send(enrichedBody);
            finishLogging();
        });
    } else {
        // STREAM OR NORMAL SUCCESS RESPONSE
        res.status(proxyRes.statusCode || 200);

        // FIX S1-1.7: Explicitly set SSE headers and disable compression/buffering
        const isSSE = proxyRes.headers['content-type'] === 'text/event-stream';
        if (isSSE) {
            res.setHeader('Cache-Control', 'no-cache');
            res.setHeader('Connection', 'keep-alive');
            res.setHeader('X-Accel-Buffering', 'no'); // Disable Nginx buffering
        }

        for (const k of Object.keys(copiedHeaders)) {
            res.setHeader(k, copiedHeaders[k]);
        }

        proxyRes.on('data', (chunk: any) => {
            processChunkForLogs(chunk.toString('utf8'));
            res.write(chunk);
            
            // If it's a stream, we want to ensure it's sent immediately
            if ((res as any).flush) (res as any).flush();
        });

        proxyRes.on('end', () => {
            res.end();
            finishLogging();
        });
    }

    function finishLogging() {
        const latency = Date.now() - requestStartTime;
        const statusCode = proxyRes.statusCode || 200;

        try {
            let usage = null;
            const extractedUsage = streamHandler.getUsage();

            if (requestInfo.isStreaming && extractedUsage) {
                let p = extractedUsage.prompt_tokens || 0;
                let c = extractedUsage.completion_tokens || 0;
                const costResult = providers[providerName].calculateCost(requestInfo.model, p, c);
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
                    usage = providers[providerName].parseResponse(parsedResponse, requestInfo);
                } catch (e) {}
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

            const metadataHeader = req.headers['x-llm-observer-metadata'] as string;
            let metadata = "{}";
            if (metadataHeader) {
                try {
                    JSON.parse(metadataHeader);
                    metadata = metadataHeader;
                } catch {}
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
                metadata,
                created_at: new Date().toISOString()
            };

            if (usage?.costUsd && usage.costUsd > 0) {
                incrementSpendCache(cacheKey, usage.costUsd);
            }

            requestEventEmitter.emit('new_request', reqRecord);

            internalLogger.add({
                ...reqRecord,
                is_streaming: !!reqRecord.is_streaming,
                has_tools: !!reqRecord.has_tools,
                pricing_unknown: !!reqRecord.pricing_unknown,
                tags: reqRecord.tags || undefined,
                prompt_hash: reqRecord.prompt_hash || undefined,
                metadata: reqRecord.metadata
            }).catch((err: any) => console.error('Failed to enqueue request log:', err));

            console.log(chalk.green(`✓ [${providerName}] ${requestInfo.model} | ${usage?.totalTokens || 0} tokens | ${latency}ms | $${(usage?.costUsd || 0).toFixed(6)}`));

        } catch (err) {
            console.error('Error logging request:', err);
        }
    }
});

