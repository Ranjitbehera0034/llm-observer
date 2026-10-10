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

// HAND-WRITTEN fixture derived from upstream aider/analytics.py, see fixtures/synthetic/aider/README.md.
// The real Aider 0.86.2 recording is checked by formatMatrix.test.ts; these tests pin edge cases.
const FIXTURE = path.join(__dirname, 'fixtures', 'synthetic', 'aider', 'analytics.synthetic.jsonl');

describe('Aider parser (synthetic hand-written fixture, not a recording)', () => {
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

    // The cases below are variations of lines seen in the real Aider 0.86.2 recording
    // (fixtures/aider/recorded/aider-0.86.2), changed to cover paths the recording did not hit.
    const line = (event: string, properties: Record<string, unknown>, time: number) =>
        JSON.stringify({ event, properties, user_id: 'x', time }) + '\n';
    const usage = (model: string, cost: number) => ({
        main_model: model, weak_model: model, editor_model: model, edit_format: 'whole',
        prompt_tokens: 1000, completion_tokens: 100, total_tokens: 1100, cost, total_cost: cost,
    });

    it('names models the way the price table does: litellm provider prefixes are dropped', async () => {
        fs.writeFileSync(logPath, line('message_send', usage('openai/gpt-4o', 0), 1760001000)
            + line('message_send', usage('openrouter/anthropic/claude-3.5-sonnet', 0.01), 1760001010));
        await aiderParser.parse();
        const r = rows();
        expect(r[0].model_primary).toBe('gpt-4o');
        // the table lookup uses the bare name, so a prefixed model with cost 0 is still priced
        expect(r[0].cost_source).toBe('pricing_table');
        expect(r[0].estimated_cost_usd).toBeCloseTo((1000 / 1e6) * 2.5 + (100 / 1e6) * 10, 8);
        expect(r[1].model_primary).toBe('claude-3.5-sonnet');
    });

    it.each(['openai/REDACTED', 'anthropic/REDACTED', 'REDACTED', 'None', ''])(
        'treats the model name %j as unknown, not as a model called that', async (name) => {
            fs.writeFileSync(logPath, line('message_send', usage(name, 0), 1760001100));
            await aiderParser.parse();
            expect(rows()[0].model_primary).toBe('unknown');
            expect(rows()[0].cost_source).toBe('unpriced');
        });

    it('uses message_send_starting for the start time and duration, and ignores one left by a failed request', async () => {
        fs.writeFileSync(logPath,
            line('launched', {}, 1760002000)
            + line('message_send_starting', {}, 1760002001) // request that failed: no message_send follows
            + line('message_send_starting', {}, 1760002010) // retry
            + line('message_send', usage('openai/gpt-4o', 0.01), 1760002017)
            + line('message_send', usage('openai/gpt-4o', 0.01), 1760002030) // no starting event of its own
            + line('exit', { reason: '/exit' }, 1760002040));
        await aiderParser.parse();
        const [a, b] = rows();
        expect(a.started_at).toBe(new Date(1760002010 * 1000).toISOString());
        expect(a.ended_at).toBe(new Date(1760002017 * 1000).toISOString());
        expect(a.duration_seconds).toBe(7);
        expect(b.started_at).toBe(b.ended_at);
        expect(b.duration_seconds).toBe(0);
    });

    it('does not carry a start time across launches', async () => {
        fs.writeFileSync(logPath,
            line('message_send_starting', {}, 1760003000) // launch ended before the reply
            + line('exit', { reason: 'Control-C' }, 1760003001)
            + line('launched', {}, 1760009000)
            + line('message_send', usage('openai/gpt-4o', 0.01), 1760009005));
        await aiderParser.parse();
        expect(rows()[0].duration_seconds).toBe(0);
        expect(rows()[0].started_at).toBe(new Date(1760009005 * 1000).toISOString());
    });
});
