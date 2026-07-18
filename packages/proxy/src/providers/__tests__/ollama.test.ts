jest.mock('@llm-observer/database', () => ({
    getSetting: jest.fn(() => null)
}));

import { OllamaProvider } from '../ollama';
import { getSetting } from '@llm-observer/database';

describe('OllamaProvider', () => {
    let provider: OllamaProvider;

    beforeEach(() => {
        jest.clearAllMocks();
        (getSetting as jest.Mock).mockReturnValue(null);
        provider = new OllamaProvider();
    });

    it('defaults to localhost:11434 when no base URL is configured', () => {
        expect(provider.getBaseUrl()).toBe('http://localhost:11434');
    });

    it('honors a configured ollama_base_url setting', () => {
        (getSetting as jest.Mock).mockReturnValue('http://192.168.1.50:11434');
        expect(provider.getBaseUrl()).toBe('http://192.168.1.50:11434');
    });

    it('sends no Authorization header by default (Ollama has no auth)', () => {
        expect(provider.getAuthHeader({} as any)).toEqual({});
    });

    it('parses OpenAI-compatible usage fields', () => {
        const requestData = provider.parseRequest({} as any, { model: 'llama3.2', stream: false });
        const result = provider.parseResponse(
            { usage: { prompt_tokens: 120, completion_tokens: 45 } },
            requestData
        );
        expect(result.promptTokens).toBe(120);
        expect(result.completionTokens).toBe(45);
        expect(result.totalTokens).toBe(165);
        expect(result.provider).toBe('ollama');
    });

    it('parses native Ollama usage fields (prompt_eval_count / eval_count)', () => {
        const requestData = provider.parseRequest({} as any, { model: 'qwen2.5-coder', stream: false });
        const result = provider.parseResponse(
            { done: true, prompt_eval_count: 300, eval_count: 88 },
            requestData
        );
        expect(result.promptTokens).toBe(300);
        expect(result.completionTokens).toBe(88);
        expect(result.totalTokens).toBe(388);
    });

    it('always reports zero cost with unknown=false — local inference is known to be free', () => {
        const requestData = provider.parseRequest({} as any, { model: 'anything-the-user-installed' });
        const result = provider.parseResponse({ usage: { prompt_tokens: 1000, completion_tokens: 1000 } }, requestData);
        expect(result.costUsd).toBe(0);
        expect(result.pricing_unknown).toBe(false);
    });

    it('defaults stream to true (matching Ollama behavior) unless explicitly false', () => {
        expect(provider.parseRequest({} as any, { model: 'x' }).isStreaming).toBe(true);
        expect(provider.parseRequest({} as any, { model: 'x', stream: false }).isStreaming).toBe(false);
    });
});
