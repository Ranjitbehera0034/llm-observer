import * as claudeParser from '../claude';
import * as dbMock from '@llm-observer/database';
import fs from 'fs';
import os from 'os';
import path from 'path';

jest.mock('@llm-observer/database', () => ({
    getParsedFile: jest.fn(),
    upsertParsedFile: jest.fn(),
    insertSession: jest.fn(() => 1),
    insertSubagent: jest.fn(),
    getSubagentsBySession: jest.fn(() => []),
    updateSessionTotals: jest.fn(),
    upsertToolUsage: jest.fn(),
    getPricingForModel: jest.fn((provider: string, model: string) =>
        model === 'claude-sonnet-5' ? { input: 3, output: 15, cached: 0.3 } : undefined
    )
}));

// Realistic current-format Claude Code JSONL: API data nested under `message`,
// one line per content block so usage repeats within a single API request.
const FIXTURE_LINES = [
    // user turn
    {
        type: 'user',
        timestamp: '2026-07-01T10:00:00.000Z',
        sessionId: 'test-session',
        message: { role: 'user', content: 'do the thing' }
    },
    // assistant response, first content block
    {
        type: 'assistant',
        timestamp: '2026-07-01T10:00:05.000Z',
        requestId: 'req_1',
        message: {
            id: 'msg_1',
            role: 'assistant',
            model: 'claude-sonnet-5',
            content: [{ type: 'text', text: 'working on it' }],
            usage: {
                input_tokens: 100,
                output_tokens: 50,
                cache_read_input_tokens: 1000,
                cache_creation_input_tokens: 200,
                cache_creation: { ephemeral_1h_input_tokens: 200, ephemeral_5m_input_tokens: 0 }
            }
        }
    },
    // same API request, second content block — identical usage MUST NOT be double-counted
    {
        type: 'assistant',
        timestamp: '2026-07-01T10:00:06.000Z',
        requestId: 'req_1',
        message: {
            id: 'msg_1',
            role: 'assistant',
            model: 'claude-sonnet-5',
            content: [{ type: 'tool_use', name: 'Bash', input: { command: 'ls' } }],
            usage: {
                input_tokens: 100,
                output_tokens: 50,
                cache_read_input_tokens: 1000,
                cache_creation_input_tokens: 200,
                cache_creation: { ephemeral_1h_input_tokens: 200, ephemeral_5m_input_tokens: 0 }
            }
        }
    },
    // a second, distinct API request
    {
        type: 'assistant',
        timestamp: '2026-07-01T10:00:10.000Z',
        requestId: 'req_2',
        message: {
            id: 'msg_2',
            role: 'assistant',
            model: 'claude-sonnet-5',
            content: [{ type: 'tool_use', name: 'Read', input: { file_path: '/tmp/x' } }],
            usage: {
                input_tokens: 10,
                output_tokens: 20,
                cache_read_input_tokens: 500,
                cache_creation_input_tokens: 0
            }
        }
    },
    // non-conversation line (attachment/progress) — no usage, not a message
    { type: 'attachment', timestamp: '2026-07-01T10:00:11.000Z', data: 'blob' }
];

describe('Claude Code Parser', () => {
    let tmpHome: string;

    beforeEach(() => {
        jest.clearAllMocks();
        tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-parser-test-'));
        const projectDir = path.join(tmpHome, '.claude', 'projects', '-Users-test-myproject');
        fs.mkdirSync(projectDir, { recursive: true });
        fs.writeFileSync(
            path.join(projectDir, 'abc-123.jsonl'),
            FIXTURE_LINES.map(l => JSON.stringify(l)).join('\n') + '\n'
        );
        jest.spyOn(os, 'homedir').mockReturnValue(tmpHome);
    });

    afterEach(() => {
        jest.restoreAllMocks();
        fs.rmSync(tmpHome, { recursive: true, force: true });
    });

    it('detects the claude projects directory', () => {
        expect(claudeParser.detector()).toBe(true);
    });

    it('detects inline subagents via Task tool calls and isSidechain events (current format)', async () => {
        const projectDir = path.join(tmpHome, '.claude', 'projects', '-Users-test-agentproj');
        fs.mkdirSync(projectDir, { recursive: true });
        const lines = [
            { type: 'user', timestamp: '2026-07-01T11:00:00.000Z', message: { role: 'user', content: 'go' } },
            {
                type: 'assistant', timestamp: '2026-07-01T11:00:05.000Z', requestId: 'r1',
                message: {
                    id: 'm1', role: 'assistant', model: 'claude-sonnet-5',
                    content: [
                        { type: 'tool_use', name: 'Task', input: {} },
                        { type: 'tool_use', name: 'Task', input: {} }
                    ],
                    usage: { input_tokens: 10, output_tokens: 5 }
                }
            },
            // subagent turns arrive inline, flagged isSidechain
            { type: 'assistant', isSidechain: true, timestamp: '2026-07-01T11:00:10.000Z', requestId: 'r2',
              message: { id: 'm2', role: 'assistant', model: 'claude-sonnet-5', content: [{ type: 'text', text: 'sub work' }], usage: { input_tokens: 5, output_tokens: 5 } } }
        ];
        fs.writeFileSync(path.join(projectDir, 'agent-session.jsonl'), lines.map(l => JSON.stringify(l)).join('\n') + '\n');

        await claudeParser.parse();

        const call = (dbMock.insertSession as jest.Mock).mock.calls
            .map((c: any[]) => c[0])
            .find((s: any) => s.session_id === 'agent-session');
        expect(call).toBeDefined();
        expect(call.has_subagents).toBe(true);
        expect(call.subagent_count).toBe(2); // one per Task spawn
        expect(call.session_type).toBe('agentic');
    });

    it('extracts nested message.usage, dedupes repeated usage per API request, and prices cache tokens', async () => {
        await claudeParser.parse();

        expect(dbMock.insertSession).toHaveBeenCalledTimes(1);
        const session = (dbMock.insertSession as jest.Mock).mock.calls[0][0];

        // Dedup: req_1 usage appears on two lines but must be counted once
        expect(session.input_tokens).toBe(110);       // 100 + 10
        expect(session.output_tokens).toBe(70);       // 50 + 20
        expect(session.cache_read_tokens).toBe(1500); // 1000 + 500
        expect(session.cache_write_tokens).toBe(200);

        // Model comes from message.model, not top-level
        expect(session.model_primary).toBe('claude-sonnet-5');

        // Tool calls come from message.content blocks → session is agentic
        const tools = JSON.parse(session.tool_calls_json);
        expect(tools).toEqual({ Bash: 1, Read: 1 });
        expect(session.session_type).toBe('agentic');

        // Only user/assistant lines count as messages (attachment line excluded)
        expect(session.message_count).toBe(4);

        // Cost: input 110*3 + output 70*15 + cacheRead 1500*0.3 + cacheWrite(1h) 200*3*2, per 1M tokens
        const expected = (110 * 3 + 70 * 15 + 1500 * 0.3 + 200 * 3 * 2) / 1_000_000;
        expect(session.estimated_cost_usd).toBeCloseTo(expected, 10);
    });
});
