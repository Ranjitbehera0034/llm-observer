import * as aiderParser from '../aider';
import * as dbMock from '@llm-observer/database';
import fs from 'fs';
import os from 'os';
import path from 'path';

const PRICING: Record<string, { input: number; output: number; cached?: number }> = {
    'anthropic:claude-sonnet-5': { input: 3, output: 15, cached: 0.3 },
    'openai:gpt-4o': { input: 2.5, output: 10 }
};

jest.mock('@llm-observer/database', () => ({
    getParsedFile: jest.fn(),
    upsertParsedFile: jest.fn(),
    insertSession: jest.fn(() => 1),
    getPricingForModel: jest.fn((provider: string, model: string) => PRICING[`${provider}:${model}`])
}));

// Realistic ~/.aider/analytics.jsonl lines: one event per API request, with
// aider-provided cost on some events and only token counts on others.
const FIXTURE_LINES = [
    // event with explicit cost and canonical token field names
    {
        id: 'evt-1',
        timestamp: '2026-07-01T09:00:00.000Z',
        type: 'chat',
        model: 'claude-sonnet-5',
        input_tokens: 1200,
        output_tokens: 400,
        cost: 0.05,
        project_dir: '/Users/test/myproj',
        duration: 30
    },
    // event without cost, using the alternate prompt/completion field names —
    // cost must be derived from pricing for the mapped provider
    {
        request_id: 'evt-2',
        timestamp: '2026-07-01T09:05:00.000Z',
        type: 'code',
        model: 'gpt-4o',
        prompt_tokens: 900,
        completion_tokens: 250,
        project_dir: '/Users/test/otherproj'
    }
];

describe('Aider Parser', () => {
    let tmpHome: string;
    let analyticsPath: string;

    beforeEach(() => {
        jest.clearAllMocks();
        tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'aider-parser-test-'));
        const aiderDir = path.join(tmpHome, '.aider');
        fs.mkdirSync(aiderDir, { recursive: true });
        analyticsPath = path.join(aiderDir, 'analytics.jsonl');
        fs.writeFileSync(
            analyticsPath,
            FIXTURE_LINES.map(l => JSON.stringify(l)).join('\n') + '\nnot-json{{{\n'
        );
        jest.spyOn(os, 'homedir').mockReturnValue(tmpHome);
    });

    afterEach(() => {
        jest.restoreAllMocks();
        fs.rmSync(tmpHome, { recursive: true, force: true });
    });

    it('detects the aider analytics file', () => {
        expect(aiderParser.detector()).toBe(true);
        fs.rmSync(analyticsPath);
        expect(aiderParser.detector()).toBe(false);
    });

    it('parses one session per event, skipping malformed lines', async () => {
        await aiderParser.parse();

        expect(dbMock.insertSession).toHaveBeenCalledTimes(2);
        const sessions = (dbMock.insertSession as jest.Mock).mock.calls.map(c => c[0]);
        expect(sessions.map((s: any) => s.session_id)).toEqual(['evt-1', 'evt-2']);
        expect(sessions.every((s: any) => s.provider === 'aider')).toBe(true);

        expect(dbMock.upsertParsedFile).toHaveBeenCalledWith(
            expect.objectContaining({ file_path: analyticsPath, provider: 'aider', status: 'success' })
        );
    });

    it('uses aider-provided cost and token counts when present', async () => {
        await aiderParser.parse();

        const session = (dbMock.insertSession as jest.Mock).mock.calls
            .map(c => c[0])
            .find((s: any) => s.session_id === 'evt-1');

        expect(session.input_tokens).toBe(1200);
        expect(session.output_tokens).toBe(400);
        expect(session.model_primary).toBe('claude-sonnet-5');
        expect(session.estimated_cost_usd).toBe(0.05); // explicit cost wins, no pricing lookup
        expect(session.project_name).toBe('myproj');
        expect(session.started_at).toBe('2026-07-01T09:00:00.000Z');
        expect(session.duration_seconds).toBe(30);
        expect(session.session_type).toBe('interactive'); // type === 'chat'
    });

    it('reads alternate token field names and falls back to pricing for cost', async () => {
        await aiderParser.parse();

        const session = (dbMock.insertSession as jest.Mock).mock.calls
            .map(c => c[0])
            .find((s: any) => s.session_id === 'evt-2');

        expect(session.input_tokens).toBe(900);  // from prompt_tokens
        expect(session.output_tokens).toBe(250); // from completion_tokens
        expect(session.model_primary).toBe('gpt-4o');
        expect(session.session_type).toBe('agentic'); // non-chat event type

        // gpt-4o maps to the default 'openai' provider for the pricing lookup
        expect(dbMock.getPricingForModel).toHaveBeenCalledWith('openai', 'gpt-4o');
        const expected = (900 / 1_000_000) * 2.5 + (250 / 1_000_000) * 10;
        expect(session.estimated_cost_usd).toBeCloseTo(expected, 10);
    });

    it('skips the file when it has not changed since the last parse', async () => {
        (dbMock.getParsedFile as jest.Mock).mockReturnValue({
            last_modified_at: fs.statSync(analyticsPath).mtimeMs + 1000
        });

        await aiderParser.parse();

        expect(dbMock.insertSession).not.toHaveBeenCalled();
        expect(dbMock.upsertParsedFile).not.toHaveBeenCalled();
    });
});
