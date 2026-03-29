import { classifyAgentType } from '../../parsers/claude';

describe('Claude Parser > Agent Classification', () => {
    
    it('classifies as "plan" when output is significantly larger than input and no tools are used', () => {
        const toolCalls = {};
        const input = 500;
        const output = 1500; // > 2x input
        expect(classifyAgentType(toolCalls, input, output)).toBe('plan');
    });

    it('classifies as "explore" when Read/ReadFile tools dominate', () => {
        const toolCalls = { 'ReadFile': 10, 'ls': 2 };
        const input = 1000;
        const output = 500;
        expect(classifyAgentType(toolCalls, input, output)).toBe('explore');
    });

    it('classifies as "execute" when Write/WriteFile or Bash tools dominate', () => {
        const toolCalls = { 'WriteFile': 5, 'Bash': 3, 'ReadFile': 2 };
        const input = 1000;
        const output = 1000;
        expect(classifyAgentType(toolCalls, input, output)).toBe('execute');
    });

    it('classifies as "validate" when Bash is used alongside Read tools', () => {
        const toolCalls = { 'Bash': 5, 'ReadFile': 5, 'ls': 2 };
        const input = 1000;
        const output = 1000;
        expect(classifyAgentType(toolCalls, input, output)).toBe('validate');
    });

    it('returns "general" for mixed or unknown patterns', () => {
        const toolCalls = { 'Search': 1 };
        const input = 1000;
        const output = 1000;
        expect(classifyAgentType(toolCalls, input, output)).toBe('general');
    });
});
