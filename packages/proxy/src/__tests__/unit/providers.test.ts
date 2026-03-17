import { OpenAIProvider } from '../../providers/openai';
import { AnthropicProvider } from '../../providers/anthropic';
import { GoogleProvider } from '../../providers/google';

describe('Provider Payload Parsers Unit Tests', () => {
    describe('OpenAIProvider', () => {
        const provider = new OpenAIProvider();

        it('should correctly parse standard chat request', () => {
            const req = { path: '/v1/chat/completions' } as any;
            const body = { model: 'gpt-4', messages: [{ role: 'user', content: 'hello' }] };
            const info = provider.parseRequest(req, body);

            expect(info.model).toBe('gpt-4');
            // The provider doesn't actually return the endpoint from parseRequest, the central logger does.
            // But we test the parseRequest internal properties.
            expect(info.isStreaming).toBe(false);
        });

        it('should correctly extract tokens from standard response', () => {
            const resBody = {
                usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }
            };
            const reqInfo = { model: 'gpt-4', endpoint: '/v1/chat/completions', isStreaming: false } as any;
            
            const usage = provider.parseResponse(resBody, reqInfo);
            expect(usage?.promptTokens).toBe(10);
            expect(usage?.completionTokens).toBe(5);
            expect(usage?.totalTokens).toBe(15);
        });
    });

    describe('AnthropicProvider', () => {
        const provider = new AnthropicProvider();

        it('should correctly parse messages request', () => {
            const req = { path: '/v1/messages' } as any;
            const body = { model: 'claude-3-opus-20240229', messages: [{ role: 'user', content: 'hi' }] };
            const info = provider.parseRequest(req, body);

            expect(info.model).toBe('claude-3-opus-20240229');
            expect(info.isStreaming).toBe(false);
        });

        it('should correctly extract tokens from messages response', () => {
            const resBody = {
                usage: { input_tokens: 50, output_tokens: 25 }
            };
            const reqInfo = { model: 'claude-3-opus-20240229', endpoint: '/v1/messages', isStreaming: false } as any;
            
            const usage = provider.parseResponse(resBody, reqInfo);
            expect(usage?.promptTokens).toBe(50);
            expect(usage?.completionTokens).toBe(25);
            expect(usage?.totalTokens).toBe(75);
        });
    });

    describe('GoogleProvider (Gemini)', () => {
        const provider = new GoogleProvider();

        it('should correctly parse generateContent request', () => {
            const req = { path: '/v1beta/models/gemini-pro:generateContent' } as any;
            const body = { contents: [{ parts: [{ text: 'hey' }] }] };
            const info = provider.parseRequest(req, body);

            expect(info.model).toBe('gemini-pro');
            expect(info.isStreaming).toBe(false);
        });

        it('should correctly extract tokens from generic object', () => {
            const resBody = {
                usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 50, totalTokenCount: 150 }
            };
            const reqInfo = { model: 'gemini-pro', endpoint: '/generateContent', isStreaming: false } as any;
            
            const usage = provider.parseResponse(resBody, reqInfo);
            expect(usage?.promptTokens).toBe(100);
            expect(usage?.completionTokens).toBe(50);
            expect(usage?.totalTokens).toBe(150);
        });
    });
});
