import * as clineParser from '../cline';
import * as dbMock from '@llm-observer/database';
import fs from 'fs';
import os from 'os';
import path from 'path';

const PRICING: Record<string, { input: number; output: number; cached?: number }> = {
    'anthropic:claude-sonnet-4-20250514': { input: 3, output: 15, cached: 0.3 }
};

jest.mock('@llm-observer/database', () => ({
    getParsedFile: jest.fn(),
    upsertParsedFile: jest.fn(),
    insertSession: jest.fn(() => 1),
    getPricingForModel: jest.fn((provider: string, model: string) => PRICING[`${provider}:${model}`])
}));

const FIXTURE = path.join(__dirname, 'fixtures', 'cline-task', 'api_conversation_history.json');

const globalStorageDir = (home: string): string => {
    if (process.platform === 'win32') {
        const appData = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
        return path.join(appData, 'Code', 'User', 'globalStorage');
    }
    if (process.platform === 'darwin') {
        return path.join(home, 'Library', 'Application Support', 'Code', 'User', 'globalStorage');
    }
    return path.join(home, '.config', 'Code', 'User', 'globalStorage');
};

describe('Cline Parser', () => {
    let tmpHome: string;
    let savedAppData: string | undefined;
    let taskFile: string;

    const addTask = (extensionId: string, taskDirName: string): string => {
        const taskDir = path.join(globalStorageDir(tmpHome), extensionId, 'tasks', taskDirName);
        fs.mkdirSync(taskDir, { recursive: true });
        const file = path.join(taskDir, 'api_conversation_history.json');
        fs.copyFileSync(FIXTURE, file);
        return file;
    };

    beforeEach(() => {
        jest.clearAllMocks();
        tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'cline-parser-test-'));
        if (process.platform === 'win32') {
            savedAppData = process.env.APPDATA;
            process.env.APPDATA = path.join(tmpHome, 'AppData', 'Roaming');
        }
        taskFile = addTask('saoudrizwan.claude-dev', '1712345678901');
        jest.spyOn(os, 'homedir').mockReturnValue(tmpHome);
    });

    afterEach(() => {
        jest.restoreAllMocks();
        if (process.platform === 'win32') process.env.APPDATA = savedAppData;
        fs.rmSync(tmpHome, { recursive: true, force: true });
    });

    it('detects the cline tasks directory', () => {
        expect(clineParser.detector()).toBe(true);
        fs.rmSync(path.join(globalStorageDir(tmpHome), 'saoudrizwan.claude-dev'), { recursive: true });
        expect(clineParser.detector()).toBe(false);
    });

    it('extracts exact token counts, model, tool calls, and cost from a task history', async () => {
        await clineParser.parse();

        expect(dbMock.insertSession).toHaveBeenCalledTimes(1);
        const session = (dbMock.insertSession as jest.Mock).mock.calls[0][0];

        expect(session.provider).toBe('anthropic');
        expect(session.tool).toBe('Cline');
        expect(session.session_id).toBe('task-1712345678901');
        expect(session.model_primary).toBe('claude-sonnet-4-20250514');

        // Exact usage from the assistant message in the fixture
        expect(session.input_tokens).toBe(3200);
        expect(session.output_tokens).toBe(1100);
        expect(session.cache_read_tokens).toBe(1200);
        expect(session.cache_write_tokens).toBe(2000);
        expect(session.message_count).toBe(2);

        expect(JSON.parse(session.tool_calls_json)).toEqual({ write_to_file: 1 });
        expect(session.session_type).toBe('agentic');

        // calculateCost: input + output minus the cache-read discount, per 1M tokens
        const expected = (3200 * 3 + 1100 * 15 - 1200 * (3 - 0.3)) / 1_000_000;
        expect(session.estimated_cost_usd).toBeCloseTo(expected, 10);
        expect(session.is_estimated).toBe(0);

        expect(dbMock.upsertParsedFile).toHaveBeenCalledWith(
            expect.objectContaining({ file_path: taskFile, provider: 'cline', status: 'success' })
        );
    });

    it('labels tasks under the roo extensions as Roo Code', async () => {
        addTask('rooveterinaryinc.roo-cline', '1712345678902');

        await clineParser.parse();

        const sessions = (dbMock.insertSession as jest.Mock).mock.calls.map(c => c[0]);
        const roo = sessions.find((s: any) => s.session_id === 'task-1712345678902');
        expect(roo.tool).toBe('Roo Code');
    });

    it('skips a task file already parsed at the same mtime', async () => {
        (dbMock.getParsedFile as jest.Mock).mockReturnValue({
            status: 'success',
            last_modified_at: fs.statSync(taskFile).mtimeMs
        });

        await clineParser.parse();

        expect(dbMock.insertSession).not.toHaveBeenCalled();
    });
});
