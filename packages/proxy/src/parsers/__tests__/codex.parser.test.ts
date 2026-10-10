import * as codexParser from '../codex';
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
    getPricingForModel: jest.fn(),
}));

// Only these models have a price; everything else (including the mock model of the recording) is unpriced.
const PRICES: Record<string, { input: number; output: number; cached: number | null }> = {
    'priced-model': { input: 2, output: 10, cached: 0.5 },
    'priced-no-cached': { input: 2, output: 10, cached: null },
    'codex-mini': { input: 2, output: 10, cached: 0.5 },
};

const SYNTHETIC_LEGACY = path.join(__dirname, 'fixtures', 'synthetic', 'codex', 'codex-session.synthetic.jsonl');

interface Usage { input_tokens: number; cached_input_tokens: number; cache_write_input_tokens: number; output_tokens: number; reasoning_output_tokens: number; total_tokens: number }
const usage = (input: number, cached: number, output: number, reasoning = 0): Usage =>
    ({ input_tokens: input, cached_input_tokens: cached, cache_write_input_tokens: 0, output_tokens: output, reasoning_output_tokens: reasoning, total_tokens: input + output });
const add = (a: Usage, b: Usage): Usage => ({
    input_tokens: a.input_tokens + b.input_tokens, cached_input_tokens: a.cached_input_tokens + b.cached_input_tokens,
    cache_write_input_tokens: 0, output_tokens: a.output_tokens + b.output_tokens,
    reasoning_output_tokens: a.reasoning_output_tokens + b.reasoning_output_tokens, total_tokens: a.total_tokens + b.total_tokens,
});

/**
 * Builds rollout lines in the envelope layout Codex CLI 0.162.1 really writes (see the recording in
 * fixtures/codex/recorded/codex-0.162.1/). These particular files are HAND-BUILT around that layout to pin one
 * behaviour each; they are not recordings. The real files are checked by formatMatrix.test.ts.
 */
class Rollout {
    private n = 0;
    private total: Usage = usage(0, 0, 0);
    readonly lines: string[] = [];
    constructor(private seconds = 0) {}
    private ts(): string { return new Date(Date.UTC(2026, 0, 12, 9, 0, this.seconds++)).toISOString(); }
    private push(type: string, payload: any, ts = this.ts()) {
        this.lines.push(JSON.stringify({ timestamp: ts, ordinal: this.n++, type, payload }));
        return this;
    }
    meta(cwd = '/work/proj') { return this.push('session_meta', { id: 'x', cwd, cli_version: '0.162.1' }); }
    turn(model: string) { return this.push('turn_context', { model, cwd: '/work/proj' }); }
    user() { return this.push('event_msg', { type: 'item_completed', item: { type: 'UserMessage', content: [] } }); }
    agent() { return this.push('event_msg', { type: 'item_completed', item: { type: 'AgentMessage', content: [] } }); }
    call(type: string, name: string) { return this.push('response_item', { type, name, call_id: 'c' }); }
    output() { return this.push('response_item', { type: 'function_call_output', call_id: 'c', output: '' }); }
    /** One API response: token_usage_record then event_msg/token_count, as Codex writes them. */
    response(u: Usage) {
        this.total = add(this.total, u);
        this.push('token_usage_record', { usage: u, thread_token_usage: this.total });
        return this.tokenCount(u);
    }
    tokenCount(last: Usage, info = true) {
        return this.push('event_msg', { type: 'token_count', info: info ? { total_token_usage: this.total, last_token_usage: last, model_context_window: 1000 } : null });
    }
    text() { return this.lines.join('\n') + '\n'; }
}

describe('Codex parser (real-format edge cases on hand-built rollouts, plus the synthetic legacy fixture)', () => {
    let tmpHome: string;
    let sessionsDir: string;
    const savedCodexHome = process.env.CODEX_HOME;

    beforeEach(() => {
        jest.clearAllMocks();
        store.clear();
        delete process.env.CODEX_HOME;
        (dbMock.getPricingForModel as jest.Mock).mockImplementation((_p: string, model: string) => PRICES[model]);
        tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-parser-'));
        jest.spyOn(os, 'homedir').mockReturnValue(tmpHome);
        sessionsDir = path.join(tmpHome, '.codex', 'sessions', '2026', '01', '12');
        fs.mkdirSync(sessionsDir, { recursive: true });
    });

    afterEach(() => {
        jest.restoreAllMocks();
        if (savedCodexHome === undefined) delete process.env.CODEX_HOME; else process.env.CODEX_HOME = savedCodexHome;
        fs.rmSync(tmpHome, { recursive: true, force: true });
    });

    const write = (name: string, r: Rollout | string) => {
        const file = path.join(sessionsDir, name);
        fs.writeFileSync(file, typeof r === 'string' ? r : r.text());
        return file;
    };
    const rows = () => [...store.values()];

    it('counts each API response once: the usage record, the token_count and a repeated token_count are one response', async () => {
        const r = new Rollout().meta().turn('priced-model').user();
        r.response(usage(1000, 0, 100));
        r.tokenCount(usage(1000, 0, 100)); // Codex re-emits the same cumulative total (e.g. rate-limit refresh)
        r.tokenCount(usage(0, 0, 0), false); // info: null carries no usage
        r.agent();
        write('rollout-a.jsonl', r);
        await codexParser.parse();
        expect(rows()).toHaveLength(1);
        expect(rows()[0].input_tokens).toBe(1000);
        expect(rows()[0].output_tokens).toBe(100);
    });

    it('falls back to the change in the running total when a token_count has no last_token_usage (not seen in the recording)', async () => {
        const r = new Rollout().meta().turn('priced-model').user();
        r.response(usage(1000, 0, 100));
        const first = usage(1000, 0, 100);
        const second = add(first, usage(500, 200, 40));
        r.lines.push(JSON.stringify({ timestamp: '2026-01-12T09:00:30.000Z', ordinal: 99, type: 'event_msg',
            payload: { type: 'token_count', info: { total_token_usage: second } } }));
        write('rollout-a.jsonl', r);
        await codexParser.parse();
        expect(rows()[0].input_tokens).toBe(1000 + 300);
        expect(rows()[0].cache_read_tokens).toBe(200);
        expect(rows()[0].output_tokens).toBe(140);
    });

    it('stores uncached input apart from cache reads (Codex input_tokens includes cached) and does not add reasoning tokens twice', async () => {
        const r = new Rollout().meta().turn('priced-model').user();
        r.response(usage(1000, 600, 100, 40)); // 40 of the 100 output tokens were reasoning
        r.agent();
        write('rollout-a.jsonl', r);
        await codexParser.parse();
        const s = rows()[0];
        expect(s.input_tokens).toBe(400);
        expect(s.cache_read_tokens).toBe(600);
        expect(s.output_tokens).toBe(100);
        expect(s.estimated_cost_usd).toBeCloseTo(400 * 2e-6 + 600 * 0.5e-6 + 100 * 10e-6, 9);
        expect(s.cost_source).toBe('pricing_table');
        expect(Boolean(s.is_estimated)).toBe(false);
    });

    it('bills cached tokens at the input rate, flagged estimated, when the price row has no cached rate', async () => {
        const r = new Rollout().meta().turn('priced-no-cached').user();
        r.response(usage(1000, 600, 100));
        write('rollout-a.jsonl', r);
        await codexParser.parse();
        const s = rows()[0];
        expect(s.estimated_cost_usd).toBeCloseTo(1000 * 2e-6 + 100 * 10e-6, 9);
        expect(s.cost_source).toBe('estimated');
        expect(Boolean(s.is_estimated)).toBe(true);
    });

    it('marks a model with no price as unpriced at $0 instead of inventing a flat rate', async () => {
        const r = new Rollout().meta().turn('some-custom-model').user();
        r.response(usage(1000, 0, 100));
        write('rollout-a.jsonl', r);
        await codexParser.parse();
        const s = rows()[0];
        expect(s.model_primary).toBe('some-custom-model');
        expect(s.input_tokens).toBe(1000);
        expect(s.estimated_cost_usd).toBe(0);
        expect(s.cost_source).toBe('unpriced');
        expect(Boolean(s.is_estimated)).toBe(true);
    });

    it('prices each model separately when the model changes between turns, and names the one with most tokens', async () => {
        const r = new Rollout().meta().turn('priced-model').user();
        r.response(usage(1000, 0, 100));
        r.turn('some-custom-model');
        r.response(usage(5000, 0, 500));
        write('rollout-a.jsonl', r);
        await codexParser.parse();
        const s = rows()[0];
        expect(s.model_primary).toBe('some-custom-model');
        expect(s.input_tokens).toBe(6000);
        expect(s.output_tokens).toBe(600);
        expect(s.estimated_cost_usd).toBeCloseTo(1000 * 2e-6 + 100 * 10e-6, 9); // only the priced model's part
        expect(s.cost_source).toBe('unpriced');
    });

    it('takes the project from the working directory in the log, not from the sessions/date folder', async () => {
        const r = new Rollout().meta('/work/my-app').turn('priced-model').user();
        r.response(usage(10, 0, 5));
        write('rollout-a.jsonl', r);
        await codexParser.parse();
        expect(rows()[0].project_path).toBe('/work/my-app');
        expect(rows()[0].project_name).toBe('my-app');
    });

    it('writes no row for a session where no request ever completed, and still records the file as parsed', async () => {
        const r = new Rollout().meta().turn('priced-model').user();
        const file = write('rollout-failed.jsonl', r);
        await codexParser.parse();
        expect(rows()).toHaveLength(0);
        const parsed = (dbMock.upsertParsedFile as jest.Mock).mock.calls.map((c: any[]) => c[0]);
        expect(parsed).toEqual([expect.objectContaining({ file_path: file, provider: 'codex', status: 'success' })]);
    });

    it('re-reading a resumed session (turns appended to the same file) updates the same row', async () => {
        const r = new Rollout().meta().turn('priced-model').user();
        r.response(usage(1000, 0, 100));
        r.agent();
        const file = write('rollout-a.jsonl', r);
        await codexParser.parse();
        expect(rows()[0].input_tokens).toBe(1000);

        r.turn('priced-model').user();
        r.response(usage(1500, 1000, 50));
        r.agent();
        fs.writeFileSync(file, r.text());
        await codexParser.parse();
        expect(rows()).toHaveLength(1);
        expect(rows()[0].input_tokens).toBe(1000 + 500);
        expect(rows()[0].cache_read_tokens).toBe(1000);
        expect(rows()[0].output_tokens).toBe(150);
        expect(rows()[0].message_count).toBe(4);
    });

    it('counts function calls and custom tool calls by name; their outputs are not calls (custom_tool_call is not in the recording)', async () => {
        const r = new Rollout().meta().turn('priced-model').user();
        r.call('function_call', 'exec_command').output().call('function_call', 'exec_command').output().call('custom_tool_call', 'apply_patch').output();
        r.response(usage(10, 0, 5));
        write('rollout-a.jsonl', r);
        await codexParser.parse();
        expect(JSON.parse(rows()[0].tool_calls_json)).toEqual({ exec_command: 2, apply_patch: 1 });
        expect(rows()[0].session_type).toBe('agentic');
    });

    it('ignores malformed and half-written lines', async () => {
        const r = new Rollout().meta().turn('priced-model').user();
        r.response(usage(10, 0, 5));
        write('rollout-a.jsonl', r.text() + '{"timestamp":"2026-01-12T09:10:00.000Z","ordina');
        await codexParser.parse();
        expect(rows()).toHaveLength(1);
        expect(rows()[0].input_tokens).toBe(10);
    });

    it('finds sessions under $CODEX_HOME when it is set, as Codex itself does', async () => {
        const custom = path.join(tmpHome, 'elsewhere');
        fs.mkdirSync(path.join(custom, 'sessions'), { recursive: true });
        const r = new Rollout().meta().turn('priced-model').user();
        r.response(usage(10, 0, 5));
        fs.writeFileSync(path.join(custom, 'sessions', 'rollout-b.jsonl'), r.text());
        expect(codexParser.detector()).toBe(true); // ~/.codex/sessions exists
        fs.rmSync(path.join(tmpHome, '.codex'), { recursive: true });
        expect(codexParser.detector()).toBe(false);
        process.env.CODEX_HOME = custom;
        expect(codexParser.detector()).toBe(true);
        await codexParser.parse();
        expect(rows().map(s => s.session_id)).toEqual(['rollout-b']);
    });

    describe('the old hand-written fixture (top-level message/usage/tool_call lines, NOT what Codex 0.162.1 writes)', () => {
        it('still parses: usage on the event, model on the event, tool calls by name', async () => {
            fs.copyFileSync(SYNTHETIC_LEGACY, path.join(sessionsDir, 'legacy.jsonl'));
            await codexParser.parse();
            const s = rows()[0];
            expect(s.session_id).toBe('legacy');
            expect(s.model_primary).toBe('codex-mini');
            expect(s.message_count).toBe(2);
            expect(s.input_tokens).toBe(800);
            expect(s.output_tokens).toBe(350);
            expect(JSON.parse(s.tool_calls_json)).toEqual({ shell: 1 });
            expect(s.session_type).toBe('agentic');
            expect(s.estimated_cost_usd).toBeCloseTo(800 * 2e-6 + 350 * 10e-6, 9);
            expect(Boolean(s.is_estimated)).toBe(false);
        });
    });
});
