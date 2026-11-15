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

import { OpenAIProvider } from '../providers/openai';
import { calculateSharedCost } from '../utils/pricing';
describe('current model families and Responses usage', () => {
    it.each([
        ['moonshot', 'kimi-k3'], ['moonshot', 'kimi-k3.1-pro'],
        ['moonshot', 'kimi-k3.1-pro-highspeed'], ['deepseek', 'deepseek-flash'],
        ['deepseek', 'deepseek-v4-pro'],
    ])('preserves %s %s model IDs, usage, and tool calls', (name, model) => {
        const adapter = new CompatibleProvider(name, 'https://example.invalid');
        const request = adapter.parseRequest({} as any, {model, tools:[{type:'function'}]});
        expect(adapter.parseResponse({model,usage:{prompt_tokens:100,completion_tokens:20,prompt_tokens_details:{cached_tokens:40}}},request)).toMatchObject({model,promptTokens:100,completionTokens:20,totalTokens:120,hasTools:true,pricing_unknown:true});
        expect(calculateSharedCost).toHaveBeenLastCalledWith(name,model,100,20,40);
    });
    it('records Responses API input/output and cached tokens with the returned model', () => {
        const adapter = new OpenAIProvider();
        expect(adapter.parseResponse({model:'new-model-version',usage:{input_tokens:100,output_tokens:20,input_tokens_details:{cached_tokens:40}}},{model:'alias'})).toMatchObject({model:'new-model-version',promptTokens:100,completionTokens:20,totalTokens:120});
        expect(calculateSharedCost).toHaveBeenLastCalledWith('openai','new-model-version',100,20,40);
    });
    it('does not treat empty Responses usage as measured zero', () => {
        expect(new OpenAIProvider().parseResponse({usage:{}},{model:'new-model'}).pricing_unknown).toBe(true);
    });
    it('reads streamed Responses completion usage', () => {
        const stream = new StreamHandler('openai');
        stream.processChunk('data: {"type":"response.completed","response":{"usage":{"input_tokens":100,"output_tokens":20,"input_tokens_details":{"cached_tokens":40}}}}\n\n');
        expect(stream.getUsage()).toEqual({prompt_tokens:100,completion_tokens:20,total_tokens:120,cached_tokens:40});
    });
});
