import * as aiderParser from '../aider';
import * as dbMock from '@llm-observer/database';
import fs from 'fs';
import os from 'os';
import path from 'path';

// Fake store keyed like the real UNIQUE(provider, session_id) so re-inserts overwrite, as in SQLite.
const store = new Map<string, any>();

jest.mock('@llm-observer/database', () => ({
    getParsedFile: jest.fn(() => undefined),
    upsertParsedFile: jest.fn(),
    insertSession: jest.fn((s: any) => {
        store.set(`${s.provider}:${s.session_id}`, s);
        return store.size;
    }),
    getPricingForModel: jest.fn((_provider: string, model: string) =>
        model === 'gpt-4o' ? { input: 2.5, output: 10, cached: 1.25 } : undefined
    ),
}));

// Synthetic fixture derived from upstream aider/analytics.py, see fixtures/aider/README.md.
const FIXTURE = path.join(__dirname, 'fixtures', 'aider', 'analytics.synthetic.jsonl');

describe('Aider parser (synthetic upstream-shaped fixture)', () => {
    let tmpHome: string;
    let logPath: string;

    beforeEach(() => {
        jest.clearAllMocks();
        store.clear();
        tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'aider-parser-'));
        jest.spyOn(os, 'homedir').mockReturnValue(tmpHome);
        fs.mkdirSync(path.join(tmpHome, '.aider'), { recursive: true });
        logPath = path.join(tmpHome, '.aider', 'analytics.jsonl');
        fs.copyFileSync(FIXTURE, logPath);
    });

    afterEach(() => {
        jest.restoreAllMocks();
        fs.rmSync(tmpHome, { recursive: true, force: true });
    });

    const rows = () => [...store.values()].sort((a, b) => a.started_at.localeCompare(b.started_at));

    it('reads tokens, model, cost and time from properties.* and only for message_send events', async () => {
        await aiderParser.parse();
        const r = rows();
        expect(r).toHaveLength(2); // launched / command_add / exit carry no usage and must not become $0 rows
        expect(r[0].model_primary).toBe('claude-3-5-sonnet-20241022');
        expect(r[0].input_tokens).toBe(1200);
        expect(r[0].output_tokens).toBe(300);
        expect(r[0].estimated_cost_usd).toBeCloseTo(0.0081, 6);
        expect(r[0].is_estimated).toBeFalsy();
        expect(r[0].started_at).toBe(new Date(1760000060 * 1000).toISOString());
        expect(r[0].tool).toBe('Aider');
    });

    it('prices from the pricing table when aider reports cost 0, and flags it estimated', async () => {
        await aiderParser.parse();
        const gpt = rows()[1];
        expect(gpt.input_tokens).toBe(2000);
        expect(gpt.estimated_cost_usd).toBeCloseTo((2000 / 1e6) * 2.5 + (500 / 1e6) * 10, 8);
        expect(gpt.is_estimated).toBeTruthy();
        expect(gpt.cost_source).toBe('pricing_table');
    });

    it('marks usage with no price as unpriced instead of a silent real-looking $0', async () => {
        fs.appendFileSync(logPath, JSON.stringify({
            event: 'message_send',
            properties: { main_model: 'REDACTED', prompt_tokens: 10, completion_tokens: 5, cost: 0 },
            user_id: 'x', time: 1760000300,
        }) + '\n');
        await aiderParser.parse();
        const last = rows()[2];
        expect(last.model_primary).toBe('unknown');
        expect(last.is_estimated).toBeTruthy();
        expect(last.cost_source).toBe('unpriced');
    });

    it('gives the same ids on a re-parse and adds only the appended line when the file grows', async () => {
        await aiderParser.parse();
        const firstIds = new Set(store.keys());
        expect(firstIds.size).toBe(2);

        (dbMock.insertSession as jest.Mock).mockClear();
        fs.appendFileSync(logPath, JSON.stringify({
            event: 'message_send',
            properties: { main_model: 'gpt-4o', prompt_tokens: 100, completion_tokens: 20, cost: 0.001 },
            user_id: 'x', time: 1760000400,
        }) + '\n');
        const future = new Date(Date.now() + 60_000);
        fs.utimesSync(logPath, future, future);

        await aiderParser.parse();
        expect(store.size).toBe(3);
        for (const id of firstIds) expect(store.has(id)).toBe(true);
    });

    it('does not parse a half-written last line and picks it up once complete, under the same id', async () => {
        const full = JSON.stringify({
            event: 'message_send',
            properties: { main_model: 'gpt-4o', prompt_tokens: 1, completion_tokens: 1, cost: 0.5 },
            user_id: 'x', time: 1760000500,
        });
        fs.appendFileSync(logPath, full.slice(0, 30));
        await aiderParser.parse();
        expect(store.size).toBe(2);

        fs.appendFileSync(logPath, full.slice(30) + '\n');
        const future = new Date(Date.now() + 60_000);
        fs.utimesSync(logPath, future, future);
        await aiderParser.parse();
        expect(store.size).toBe(3);
    });
});
