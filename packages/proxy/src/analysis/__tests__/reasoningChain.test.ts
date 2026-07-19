import { buildReasoningChain } from '../reasoningChain';

describe('buildReasoningChain — OpenAI-style shape', () => {
    it('parses a simple system/user request with a plain-text response', () => {
        const req = JSON.stringify({
            model: 'gpt-4o',
            messages: [
                { role: 'system', content: 'You are a helpful assistant.' },
                { role: 'user', content: 'What is 2+2?' }
            ]
        });
        const res = JSON.stringify({ choices: [{ message: { role: 'assistant', content: '4' } }] });

        const result = buildReasoningChain(req, res, false);
        expect(result.responseParsed).toBe(true);
        expect(result.steps.map((s) => ({ role: s.role, type: s.type, text: s.text }))).toEqual([
            { role: 'system', type: 'text', text: 'You are a helpful assistant.' },
            { role: 'user', type: 'text', text: 'What is 2+2?' },
            { role: 'assistant', type: 'text', text: '4' }
        ]);
    });

    it('parses assistant tool_calls with JSON-string arguments, and a subsequent tool-result message', () => {
        const req = JSON.stringify({
            messages: [
                { role: 'user', content: 'What is the weather in Paris?' },
                {
                    role: 'assistant', content: null,
                    tool_calls: [{ id: 'call_1', function: { name: 'get_weather', arguments: '{"city":"Paris"}' } }]
                },
                { role: 'tool', tool_call_id: 'call_1', content: '18°C, cloudy' }
            ]
        });
        const res = JSON.stringify({ choices: [{ message: { role: 'assistant', content: "It's 18°C and cloudy in Paris." } }] });

        const result = buildReasoningChain(req, res, false);
        const toolUse = result.steps.find((s) => s.type === 'tool_use');
        const toolResult = result.steps.find((s) => s.type === 'tool_result');

        expect(toolUse?.toolName).toBe('get_weather');
        expect(toolUse?.toolInput).toEqual({ city: 'Paris' }); // parsed, not left as a raw string
        expect(toolUse?.toolUseId).toBe('call_1');

        expect(toolResult?.text).toBe('18°C, cloudy');
        expect(toolResult?.toolUseId).toBe('call_1');
        expect(toolResult?.role).toBe('tool');

        expect(result.steps[result.steps.length - 1].text).toContain('18°C');
    });

    it('gracefully leaves unparseable tool-call arguments as the raw string rather than throwing', () => {
        const req = JSON.stringify({
            messages: [{
                role: 'assistant', content: null,
                tool_calls: [{ id: 'x', function: { name: 'broken_tool', arguments: '{not valid json' } }]
            }]
        });
        const result = buildReasoningChain(req, '{}', false);
        expect(result.steps[0].toolInput).toBe('{not valid json');
    });
});

describe('buildReasoningChain — Anthropic-style shape', () => {
    it('parses text and tool_use/tool_result content blocks', () => {
        const req = JSON.stringify({
            system: 'You are a coding agent.',
            messages: [
                { role: 'user', content: [{ type: 'text', text: 'List files in /tmp' }] },
                { role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_1', name: 'bash', input: { command: 'ls /tmp' } }] },
                { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: [{ type: 'text', text: 'a.txt\nb.txt' }] }] }
            ]
        });
        const res = JSON.stringify({
            content: [{ type: 'text', text: 'There are two files: a.txt and b.txt.' }]
        });

        const result = buildReasoningChain(req, res, false);
        expect(result.responseParsed).toBe(true);

        expect(result.steps[0]).toMatchObject({ role: 'system', type: 'text', text: 'You are a coding agent.' });
        expect(result.steps.find((s) => s.type === 'tool_use')).toMatchObject({ toolName: 'bash', toolInput: { command: 'ls /tmp' }, toolUseId: 'toolu_1' });
        expect(result.steps.find((s) => s.type === 'tool_result')).toMatchObject({ text: 'a.txt\nb.txt', toolUseId: 'toolu_1', isError: false });
        expect(result.steps[result.steps.length - 1]).toMatchObject({ turn: 'response', role: 'assistant', text: 'There are two files: a.txt and b.txt.' });
    });

    it('marks an errored tool_result with isError: true', () => {
        const req = JSON.stringify({
            messages: [{ role: 'user', content: [{ type: 'tool_result', tool_use_id: 'x', content: 'permission denied', is_error: true }] }]
        });
        const result = buildReasoningChain(req, '{}', false);
        expect(result.steps[0]).toMatchObject({ type: 'tool_result', isError: true, text: 'permission denied' });
    });
});

describe('buildReasoningChain — honest degrade paths', () => {
    it('does not attempt to parse a streamed response — reports responseParsed: false rather than guessing', () => {
        const req = JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] });
        const streamedRaw = 'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\ndata: [DONE]\n\n';
        const result = buildReasoningChain(req, streamedRaw, true);
        expect(result.responseParsed).toBe(false);
        // The request side is still fully usable even though the response wasn't
        expect(result.steps).toHaveLength(1);
        expect(result.steps[0].text).toBe('hi');
    });

    it('does not throw on a malformed/truncated request body — returns an empty step list for that side', () => {
        const result = buildReasoningChain('{"messages": [ truncated', '{}', false);
        expect(() => result).not.toThrow();
        expect(result.steps).toEqual([]);
    });

    it('does not throw on empty strings for either body', () => {
        expect(() => buildReasoningChain('', '', false)).not.toThrow();
        expect(buildReasoningChain('', '', false).steps).toEqual([]);
    });

    it('skips empty-string text content instead of emitting a blank step', () => {
        const req = JSON.stringify({ messages: [{ role: 'user', content: '   ' }] });
        const result = buildReasoningChain(req, '{}', false);
        expect(result.steps).toHaveLength(0);
    });
});
