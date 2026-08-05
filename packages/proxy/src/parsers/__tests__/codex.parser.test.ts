import * as codexParser from '../codex';
import * as dbMock from '@llm-observer/database';
import fs from 'fs';
import os from 'os';
import path from 'path';

const PRICING: Record<string, { input: number; output: number; cached?: number }> = {
    'openai:codex-mini': { input: 1.5, output: 6 }
};

jest.mock('@llm-observer/database', () => ({
    getParsedFile: jest.fn(),
    upsertParsedFile: jest.fn(),
    insertSession: jest.fn(() => 1),
    getPricingForModel: jest.fn((provider: string, model: string) => PRICING[`${provider}:${model}`])
}));

const FIXTURE = path.join(__dirname, 'fixtures', 'codex-session.jsonl');

describe('Codex Parser', () => {
    let tmpHome: string;
    let sessionsDir: string;

    beforeEach(() => {
        jest.clearAllMocks();
        tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-parser-test-'));
        sessionsDir = path.join(tmpHome, '.codex', 'sessions');
        fs.mkdirSync(sessionsDir, { recursive: true });
        fs.copyFileSync(FIXTURE, path.join(sessionsDir, 'rollout-2026-03-22.jsonl'));
        jest.spyOn(os, 'homedir').mockReturnValue(tmpHome);
    });

    afterEach(() => {
        jest.restoreAllMocks();
        fs.rmSync(tmpHome, { recursive: true, force: true });
    });

    it('detects the codex sessions directory', () => {
        expect(codexParser.detector()).toBe(true);
        fs.rmSync(sessionsDir, { recursive: true });
        expect(codexParser.detector()).toBe(false);
    });

    it('extracts explicit usage, model, tool calls, and cost from a session file', async () => {
        await codexParser.parse();

        expect(dbMock.insertSession).toHaveBeenCalledTimes(1);
        const session = (dbMock.insertSession as jest.Mock).mock.calls[0][0];

        expect(session.session_id).toBe('rollout-2026-03-22');
        expect(session.provider).toBe('openai');
        expect(session.tool).toBe('OpenAI Codex CLI');
        expect(session.model_primary).toBe('codex-mini');

        // Explicit usage from the assistant message; content-length estimates discarded
        expect(session.input_tokens).toBe(800);
        expect(session.output_tokens).toBe(350);
        expect(session.is_estimated).toBe(0);

        // Only type === 'message' lines count (tool_call / tool_result excluded)
        expect(session.message_count).toBe(2);

        expect(JSON.parse(session.tool_calls_json)).toEqual({ shell: 1 });
        expect(session.session_type).toBe('agentic');

        // First to last event timestamp: 18:08:35Z -> 18:08:43Z
        expect(session.started_at).toBe('2026-03-22T18:08:35.000Z');
        expect(session.ended_at).toBe('2026-03-22T18:08:43.000Z');
        expect(session.duration_seconds).toBe(8);

        const expected = (800 * 1.5 + 350 * 6) / 1_000_000;
        expect(session.estimated_cost_usd).toBeCloseTo(expected, 10);

        expect(dbMock.upsertParsedFile).toHaveBeenCalledWith(
            expect.objectContaining({ provider: 'codex', status: 'success' })
        );
    });

    it('estimates tokens from content length when usage is absent', async () => {
        const lines = [
            { type: 'message', role: 'user', content: 'x'.repeat(40), timestamp: '2026-03-23T10:00:00Z' },
            { type: 'message', role: 'assistant', content: 'y'.repeat(20), timestamp: '2026-03-23T10:00:30Z' }
        ];
        fs.writeFileSync(
            path.join(sessionsDir, 'no-usage.jsonl'),
            lines.map(l => JSON.stringify(l)).join('\n') + '\n'
        );

        await codexParser.parse();

        const session = (dbMock.insertSession as jest.Mock).mock.calls
            .map(c => c[0])
            .find((s: any) => s.session_id === 'no-usage');
        expect(session).toBeDefined();

        // ceil(40/4) + ceil(20/4) = 15 estimated tokens, split input/output
        expect(session.input_tokens).toBe(7);
        expect(session.output_tokens).toBe(8);
        expect(session.is_estimated).toBe(1);
        expect(session.model_primary).toBe('codex-mini'); // default when no model on events
        expect(session.session_type).toBe('interactive'); // no tool_call events
        expect(session.duration_seconds).toBe(30);
    });

    it('skips a session file already parsed at the same mtime', async () => {
        (dbMock.getParsedFile as jest.Mock).mockReturnValue({
            status: 'success',
            last_modified_at: fs.statSync(path.join(sessionsDir, 'rollout-2026-03-22.jsonl')).mtimeMs
        });

        await codexParser.parse();

        expect(dbMock.insertSession).not.toHaveBeenCalled();
    });
});
