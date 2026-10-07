jest.mock('../../utils/pricing', () => ({
    getPricingWithFuzzy: (provider: string, model: string) =>
        provider === 'openai' && model === 'gpt-4o-mini' ? { input: 0.15, output: 0.6 } : undefined,
}));

import { estimateRequestTokens, estimateRequestCost, estimateTokenCount, extractMaxOutputTokens, MAX_ESTIMATED_OUTPUT_TOKENS } from '../../services/costEstimator';

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

describe('extractMaxOutputTokens', () => {
    it('reads the declared output cap from every provider shape', () => {
        expect(extractMaxOutputTokens({ max_tokens: 1000 })).toBe(1000);
        expect(extractMaxOutputTokens({ max_completion_tokens: 2000 })).toBe(2000);
        expect(extractMaxOutputTokens({ max_output_tokens: 3000 })).toBe(3000);
        expect(extractMaxOutputTokens({ generationConfig: { maxOutputTokens: 4000 } })).toBe(4000);
    });

    it('ignores absent, zero, negative and non-numeric caps', () => {
        expect(extractMaxOutputTokens(undefined)).toBeUndefined();
        expect(extractMaxOutputTokens({})).toBeUndefined();
        expect(extractMaxOutputTokens({ max_tokens: 0 })).toBeUndefined();
        expect(extractMaxOutputTokens({ max_tokens: -5 })).toBeUndefined();
        expect(extractMaxOutputTokens({ max_tokens: '1000' })).toBeUndefined();
        expect(extractMaxOutputTokens({ generationConfig: 'x' })).toBeUndefined();
    });
});

describe('estimateRequestCost output estimate', () => {
    // gpt-4o-mini: $0.15 in / $0.60 out per 1M
    const price = (inTok: number, outTok: number) => (inTok * 0.15 + outTok * 0.6) / 1_000_000;

    it('uses the declared output cap instead of input x multiplier', () => {
        expect(estimateRequestCost('openai', 'gpt-4o-mini', 100_000, 3, 1000)).toBeCloseTo(price(100_000, 1000), 8);
    });

    it('caps the multiplier-based output estimate when no cap is declared', () => {
        expect(estimateRequestCost('openai', 'gpt-4o-mini', 100_000, 3)).toBeCloseTo(price(100_000, MAX_ESTIMATED_OUTPUT_TOKENS), 8);
        expect(MAX_ESTIMATED_OUTPUT_TOKENS).toBe(64_000);
        // below the ceiling the multiplier still applies
        expect(estimateRequestCost('openai', 'gpt-4o-mini', 10_000, 3)).toBeCloseTo(price(10_000, 30_000), 8);
    });

    it('applies the same output estimate to the unpriced fallback', () => {
        expect(estimateRequestCost('unknown', 'x', 100_000, 3, 1000)).toBeCloseTo((100_000 * 15 + 1000 * 75) / 1_000_000, 8);
    });
});
