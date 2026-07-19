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
