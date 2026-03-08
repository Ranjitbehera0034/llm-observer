import { Request, Response } from 'express';
import httpProxy from 'http-proxy';
import { IProvider } from './providers/base';
import { OpenAIProvider } from './providers/openai';
import { AnthropicProvider } from './providers/anthropic';
import { insertRequest } from '@llm-observer/database';

export const proxy = httpProxy.createProxyServer({
    changeOrigin: true,
    // We will handle errors ourselves
});

const providers: Record<string, IProvider> = {
    openai: new OpenAIProvider(),
    anthropic: new AnthropicProvider(),
    // others can be added here
};

export const handleProxyRequest = async (req: Request, res: Response, providerName: string) => {
    const provider = providers[providerName];
    if (!provider) {
        return res.status(400).json({ error: `Unsupported provider: ${providerName}` });
    }

    const targetUrl = provider.getBaseUrl();
    const authHeaders = provider.getAuthHeader(req);

    // Parse request to get model details
    const requestInfo = provider.parseRequest(req, req.body);
    const requestStartTime = Date.now();

    // We need to capture the response body
    const _write = res.write;
    const _end = res.end;
    let responseData = '';

    // Store original request body to log later
    const requestBodyStr = JSON.stringify(req.body);

    res.write = function (this: any, chunk: any, encoding?: any, cb?: any) {
        if (chunk) {
            responseData += chunk.toString();
        }
        return _write.call(this, chunk, encoding, cb);
    } as any;

    res.end = function (this: any, chunk: any, encoding?: any, cb?: any) {
        if (chunk) {
            responseData += chunk.toString();
        }

        const latency = Date.now() - requestStartTime;
        const statusCode = res.statusCode;

        // After response is done, calculate cost and log
        try {
            let usage = null;

            if (requestInfo.isStreaming && responseData) {
                usage = provider.parseStreamResponse(responseData, requestInfo);
            } else if (!requestInfo.isStreaming && responseData) {
                try {
                    const parsedResponse = JSON.parse(responseData);
                    usage = provider.parseResponse(parsedResponse, requestInfo);
                } catch (e) {
                    // not JSON
                }
            }

            // Log to database asynchronously
            insertRequest({
                project_id: 'default', // TODO: Get from auth/headers
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
                is_streaming: requestInfo.isStreaming,
                has_tools: requestInfo.hasTools,
                request_body: requestBodyStr,
                response_body: responseData
            });
        } catch (err) {
            console.error('Error logging request:', err);
        }

        return _end.call(this, chunk, encoding, cb);
    } as any;

    // We must re-stream the JSON body since body-parser already read it
    // http-proxy gets confused if body is already consumed
    proxy.web(req, res, {
        target: targetUrl,
        headers: {
            ...authHeaders
        },
        buffer: require('stream').Readable.from([JSON.stringify(req.body)])
    }, (err) => {
        console.error('Proxy Error:', err);
        if (!res.headersSent) {
            res.status(502).json({ error: 'Bad Gateway', details: err.message });
        }
    });
};
