import fs from 'fs';
import os from 'os';
import path from 'path';
import { parse, detector } from '../codex';
import { insertSession, upsertParsedFile, getParsedFile } from '@llm-observer/database';

jest.mock('@llm-observer/database', () => ({
    insertSession: jest.fn(), upsertParsedFile: jest.fn(), getParsedFile: jest.fn(),
    getPricingForModel: jest.fn((_provider, model) => model === 'unknown' ? undefined :
        model === 'gpt-cheap' ? { input: 1, output: 2, cached: 0.5 } : { input: 10, output: 30, cached: 5 })
}));

describe('Codex schema regression fixtures', () => {
    let home: string;
    let file: string;
    const oldHome = process.env.CODEX_HOME;
    beforeEach(() => {
        jest.clearAllMocks();
        home = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-parser-'));
        process.env.CODEX_HOME = home;
        fs.mkdirSync(path.join(home, 'sessions'));
        file = path.join(home, 'sessions', 'example.jsonl');
    });
    afterEach(() => {
        fs.rmSync(home, { recursive: true, force: true });
        if (oldHome === undefined) delete process.env.CODEX_HOME;
        else process.env.CODEX_HOME = oldHome;
    });
    const result = () => (insertSession as jest.Mock).mock.calls[0][0];
    const event = (input: number, output: number) => JSON.stringify({ type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: { input_tokens: input, output_tokens: output } } } });
    it('reads nested totals, avoids repeats, prices model changes and keeps real project identity', async () => {
        fs.copyFileSync(path.join(__dirname, 'fixtures/codex/nested.jsonl'), file);
        expect(detector()).toBe(true);
        await parse();
        expect(result()).toMatchObject({ input_tokens: 1500, output_tokens: 300, cache_read_tokens: 500, project_name: 'widget', project_path: '/projects/widget', model_primary: 'gpt-test', session_type: 'agentic' });
        expect(result().estimated_cost_usd).toBeCloseTo(0.01465);
        expect(JSON.parse(result().tool_calls_json)).toEqual({ shell: 1 });
        expect(JSON.parse(result().raw_metadata_json).issue_count).toBe(0);
    });
    it('continues reading the legacy checked-in format', async () => {
        fs.copyFileSync(path.join(__dirname, 'fixtures/codex-session.jsonl'), file);
        await parse();
        expect(result()).toMatchObject({ input_tokens: 800, output_tokens: 350, model_primary: 'codex-mini' });
        expect(result().project_path).toBeUndefined();
    });
    it('keeps a missing model unpriced instead of defaulting to codex-mini', async () => {
        fs.writeFileSync(file, event(100, 20));
        await parse();
        expect(result()).toMatchObject({ model_primary: 'unknown', estimated_cost_usd: null });
    });
    it('rejects unsupported logs without inserting a zero-cost session', async () => {
        fs.writeFileSync(file, '{"new_format":true}\n');
        await expect(parse()).rejects.toThrow('incomplete');
        expect(insertSession).not.toHaveBeenCalled();
        expect(upsertParsedFile).toHaveBeenCalledWith(expect.objectContaining({ status: 'error' }));
    });
    it('marks malformed or rolled-back counters partial and never adds them', async () => {
        fs.writeFileSync(file, [event(100, 20), event(50, 10), '{unfinished'].join('\n'));
        await expect(parse()).rejects.toThrow('incomplete');
        expect(result()).toMatchObject({ input_tokens: 100, output_tokens: 20, estimated_cost_usd: null });
        expect(JSON.parse(result().raw_metadata_json).issue_count).toBe(2);
    });
    it('keeps a quota-only session unpriced without inventing usage', async () => {
        fs.writeFileSync(file, '{"type":"event_msg","payload":{"type":"token_count","info":null}}');
        await parse();
        expect(result().estimated_cost_usd).toBeNull();
        expect(JSON.parse(result().raw_metadata_json).usage_observed).toBe(false);
    });
    it('skips an unchanged successfully parsed file', async () => {
        fs.writeFileSync(file, event(100, 20));
        (getParsedFile as jest.Mock).mockReturnValueOnce({ status: 'success', last_modified_at: fs.statSync(file).mtimeMs });
        await parse();
        expect(insertSession).not.toHaveBeenCalled();
    });
});
