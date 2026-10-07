jest.mock('../../utils/pricing', () => ({
    getPricingWithFuzzy: (provider: string, model: string) =>
        provider === 'openai' && model === 'gpt-4o-mini' ? { input: 0.15, output: 0.6 } : undefined,
}));

import { estimateRequestTokens, estimateRequestCost, estimateTokenCount } from '../../services/costEstimator';

describe('estimateRequestTokens', () => {
    it('counts OpenAI chat messages (same as the legacy estimateTokenCount)', () => {
        const messages = [{ role: 'user', content: 'a'.repeat(400) }];
        expect(estimateRequestTokens({ messages })).toBe(100);
        expect(estimateTokenCount(messages)).toBe(100);
    });

    it('counts Anthropic system (string and blocks), tools and tool_result', () => {
        expect(estimateRequestTokens({ system: 'a'.repeat(4000), messages: [] })).toBe(1000);
        expect(estimateRequestTokens({ system: [{ type: 'text', text: 'a'.repeat(4000) }], messages: [] })).toBe(1000);
        expect(estimateRequestTokens({ tools: [{ name: 't', description: 'd'.repeat(4000) }] })).toBeGreaterThan(1000);
        const withResult = estimateRequestTokens({
            messages: [{ role: 'user', content: [{ type: 'tool_result', tool_use_id: 'x', content: [{ type: 'text', text: 'r'.repeat(4000) }] }] }],
        });
        expect(withResult).toBe(1000);
        const stringResult = estimateRequestTokens({
            messages: [{ role: 'user', content: [{ type: 'tool_result', tool_use_id: 'x', content: 'r'.repeat(4000) }] }],
        });
        expect(stringResult).toBe(1000);
    });

    it('counts Gemini contents, systemInstruction and inline images', () => {
        expect(estimateRequestTokens({ contents: [{ role: 'user', parts: [{ text: 'a'.repeat(400) }] }] })).toBe(100);
        expect(estimateRequestTokens({ systemInstruction: { parts: [{ text: 'a'.repeat(400) }] } })).toBe(100);
        expect(estimateRequestTokens({ contents: [{ parts: [{ inlineData: { mimeType: 'image/png', data: 'AAAA' } }] }] })).toBe(1000);
    });

    it('counts OpenAI Responses input and instructions', () => {
        expect(estimateRequestTokens({ input: 'a'.repeat(400) })).toBe(100);
        expect(estimateRequestTokens({
            instructions: 'b'.repeat(400),
            input: [{ role: 'user', content: [{ type: 'input_text', text: 'a'.repeat(400) }, { type: 'input_image', image_url: 'x' }] }],
        })).toBe(100 + 100 + 1000);
    });

    it('is safe on empty or odd bodies', () => {
        expect(estimateRequestTokens(undefined)).toBe(0);
        expect(estimateRequestTokens(null)).toBe(0);
        expect(estimateRequestTokens('x')).toBe(0);
        expect(estimateRequestTokens({})).toBe(0);
    });
});

describe('estimateRequestCost', () => {
    it('uses the provider pricing row (gpt-4o-mini, 10k tokens ~ $0.02)', () => {
        const cost = estimateRequestCost('openai', 'gpt-4o-mini', 10_000);
        expect(cost).toBeCloseTo(0.0195, 4);
    });

    it('keeps the conservative fallback for unpriced paid models', () => {
        expect(estimateRequestCost('unknown', 'gpt-4o-mini', 10_000)).toBeCloseTo(2.4, 2);
    });

    it('treats local Ollama as free', () => {
        expect(estimateRequestCost('ollama', 'llama3', 10_000)).toBe(0);
    });
});
