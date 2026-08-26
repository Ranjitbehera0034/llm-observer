import * as claudeParser from '../claude';
import * as opencodeParser from '../opencode';
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
    getPricingForModel: jest.fn(() => ({ input: 3, output: 15, cached: 0.3 }))
}));

const FIXTURES_DIR = path.join(__dirname, 'fixtures');
const manifest = JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, 'format-matrix.json'), 'utf8'));

interface MatrixEntry {
    fixture: string;
    description: string;
    expected: {
        primaryModel: string;
        messageCount: number;
        inputTokens: number;
        outputTokens: number;
        cacheReadTokens: number;
        cacheWriteTokens: number;
        toolCalls: Record<string, number>;
        sessionType: string;
    };
}

/**
 * Recorded-format regression matrix.
 *
 * Each fixture is a real snapshot of a Claude Code JSONL format seen in the
 * wild (see fixtures/claude/*.jsonl), checked in next to the golden output
 * the parser must produce for it (fixtures/format-matrix.json). If Claude
 * Code's log format changes upstream in a way this parser doesn't already
 * handle, or a future edit to claude.ts regresses handling of an older
 * format still sitting on someone's disk, this fails loudly here instead of
 * a user silently seeing a $0 session.
 *
 * Other editors' parsers (Cursor/Aider/Cline/Codex) are not yet wired into
 * this matrix — their fixture tests are being built in a separate effort
 * and can be added as sibling entries once landed.
 */
describe('Claude parser — recorded format matrix', () => {
    let tmpHome: string;
    let projectDir: string;

    beforeEach(() => {
        jest.clearAllMocks();
        tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-format-matrix-'));
        projectDir = path.join(tmpHome, '.claude', 'projects', '-fixture-project');
        fs.mkdirSync(projectDir, { recursive: true });
        jest.spyOn(os, 'homedir').mockReturnValue(tmpHome);
    });

    afterEach(() => {
        jest.restoreAllMocks();
        fs.rmSync(tmpHome, { recursive: true, force: true });
    });

    it.each(manifest.claude as MatrixEntry[])('$fixture — $description', async ({ fixture, expected }) => {
        fs.copyFileSync(path.join(FIXTURES_DIR, 'claude', fixture), path.join(projectDir, fixture));

        await claudeParser.parse();

        const sessionId = fixture.replace(/\.jsonl$/, '');
        const call = (dbMock.insertSession as jest.Mock).mock.calls
            .map((c: any[]) => c[0])
            .find((s: any) => s.session_id === sessionId);

        expect(call).toBeDefined();
        expect(call.model_primary).toBe(expected.primaryModel);
        expect(call.message_count).toBe(expected.messageCount);
        expect(call.input_tokens).toBe(expected.inputTokens);
        expect(call.output_tokens).toBe(expected.outputTokens);
        expect(call.cache_read_tokens).toBe(expected.cacheReadTokens);
        expect(call.cache_write_tokens).toBe(expected.cacheWriteTokens);
        expect(JSON.parse(call.tool_calls_json)).toEqual(expected.toolCalls);
        expect(call.session_type).toBe(expected.sessionType);
    });
});

/**
 * Recorded-format regression matrix for the OpenCode parser.
 *
 * The fixture is a real-shaped SQLite database snapshot of opencode's
 * ~/.local/share/opencode/opencode.db `session` table. If opencode's
 * schema changes upstream in a way this parser doesn't already handle,
 * this fails loudly here instead of a user silently seeing a $0 session.
 */
describe('OpenCode parser — recorded format matrix', () => {
    let tmpHome: string;

    beforeEach(() => {
        jest.clearAllMocks();
        tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'opencode-format-matrix-'));
        const opencodeDir = path.join(tmpHome, '.local', 'share', 'opencode');
        fs.mkdirSync(opencodeDir, { recursive: true });
        fs.copyFileSync(
            path.join(FIXTURES_DIR, 'opencode', 'format-v1-current.vscdb'),
            path.join(opencodeDir, 'opencode.db')
        );
        jest.spyOn(os, 'homedir').mockReturnValue(tmpHome);
    });

    afterEach(() => {
        jest.restoreAllMocks();
        fs.rmSync(tmpHome, { recursive: true, force: true });
    });

    it.each(manifest.opencode as any[])('$fixture — $description', async ({ expected }) => {
        await opencodeParser.parse();

        const calls = (dbMock.insertSession as jest.Mock).mock.calls.map((c: any[]) => c[0]);

        const findById = (id: string) => calls.find((s: any) => s.session_id === id);

        const root = findById('ses_fixture_root_a');
        expect(root).toBeDefined();
        expect(root.provider).toBe(expected.rootSession.provider);
        expect(root.model_primary).toBe(expected.rootSession.primaryModel);
        expect(root.input_tokens).toBe(expected.rootSession.inputTokens);
        expect(root.output_tokens).toBe(expected.rootSession.outputTokens);
        expect(root.cache_read_tokens).toBe(expected.rootSession.cacheReadTokens);
        expect(root.cache_write_tokens).toBe(expected.rootSession.cacheWriteTokens);
        expect(root.session_type).toBe(expected.rootSession.sessionType);
        expect(Boolean(root.has_subagents)).toBe(expected.rootSession.hasSubagents);
        expect(root.subagent_count).toBe(expected.rootSession.subagentCount);

        const sub = findById('ses_fixture_subagent_1');
        expect(sub).toBeDefined();
        expect(sub.provider).toBe(expected.subagentSession.provider);
        expect(sub.model_primary).toBe(expected.subagentSession.primaryModel);
        expect(sub.input_tokens).toBe(expected.subagentSession.inputTokens);
        expect(sub.output_tokens).toBe(expected.subagentSession.outputTokens);
        expect(sub.cache_read_tokens).toBe(expected.subagentSession.cacheReadTokens);
        expect(sub.cache_write_tokens).toBe(expected.subagentSession.cacheWriteTokens);
        expect(sub.session_type).toBe(expected.subagentSession.sessionType);
        expect(Boolean(sub.has_subagents)).toBe(expected.subagentSession.hasSubagents);

        const interactive = findById('ses_fixture_interactive_b');
        expect(interactive).toBeDefined();
        expect(interactive.provider).toBe(expected.interactiveSession.provider);
        expect(interactive.model_primary).toBe(expected.interactiveSession.primaryModel);
        expect(interactive.input_tokens).toBe(expected.interactiveSession.inputTokens);
        expect(interactive.output_tokens).toBe(expected.interactiveSession.outputTokens);
        expect(interactive.cache_read_tokens).toBe(expected.interactiveSession.cacheReadTokens);
        expect(interactive.cache_write_tokens).toBe(expected.interactiveSession.cacheWriteTokens);
        expect(interactive.session_type).toBe(expected.interactiveSession.sessionType);
        expect(Boolean(interactive.has_subagents)).toBe(expected.interactiveSession.hasSubagents);
    });
});
