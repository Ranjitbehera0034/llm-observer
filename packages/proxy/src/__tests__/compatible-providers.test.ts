import { CompatibleProvider } from '../providers/compatible';
import { StreamHandler } from '../utils/streamHandler';
jest.mock('@llm-observer/database', () => ({ getSetting: jest.fn(() => 'upstream-test-key') }));
jest.mock('../utils/pricing', () => ({ calculateSharedCost: jest.fn(() => ({costUsd:0,unknown:true})) }));
const provider = new CompatibleProvider('moonshot','https://api.moonshot.ai');
describe('future model tracking', () => {
    it('keeps an unknown model and usage without inventing its price', () => {
        const result = provider.parseResponse({model:'kimi-future',usage:{prompt_tokens:25,completion_tokens:7,total_tokens:32}}, {model:'requested-alias'});
        expect(result).toMatchObject({provider:'moonshot',model:'kimi-future',promptTokens:25,completionTokens:7,pricing_unknown:true});
    });
    it('does not forward an Observer key or borrow another provider key', () => {
        expect(provider.getAuthHeader({headers:{authorization:'Bearer llmo_test'}} as any)).toEqual({Authorization:'Bearer upstream-test-key'});
    });
    it.each(['moonshot','deepseek','openrouter','xai','custom'])('captures fragmented %s SSE usage', name => {
        const stream = new StreamHandler(name);
        stream.processChunk('data: {"usage":{"prompt_tokens":25,');
        stream.processChunk('"completion_tokens":7,"total_tokens":32}}\n\ndata: [DONE]\n');
        expect(stream.getUsage()).toEqual({prompt_tokens:25,completion_tokens:7,total_tokens:32});
    });
    it('keeps missing usage unavailable', () => {
        const stream = new StreamHandler('moonshot');stream.processChunk('data: {"usage":{}}\n');expect(stream.getUsage()).toBeNull();
        expect(provider.parseResponse({}, {model:'unknown'}).pricing_unknown).toBe(true);
    });
});
