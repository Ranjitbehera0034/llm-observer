import * as claudeParser from '../claude';
import { initDb, getDb, seedPricing, addCustomPricing } from '@llm-observer/database';
import fs from 'fs';
import os from 'os';
import path from 'path';

// Real (in-memory) database: these tests cover pricing provenance, subagent
// attribution and registry retry behaviour that mocks cannot exercise.

const line = (o: any) => JSON.stringify(o);
const assistant = (id: string, model: string, usage: any, ts = '2026-07-01T10:00:05.000Z', extra: any = {}) => line({
    type: 'assistant', timestamp: ts, requestId: `req_${id}`,
    message: { id: `msg_${id}`, role: 'assistant', model, content: [{ type: 'text', text: 'x' }], usage },
    ...extra
});
const user = (ts = '2026-07-01T10:00:00.000Z') => line({ type: 'user', timestamp: ts, message: { role: 'user', content: 'go' } });

const getSession = (sessionId: string): any =>
    getDb().prepare("SELECT * FROM sessions WHERE provider = 'claude-code' AND session_id = ?").get(sessionId);

describe('Claude parser: pricing provenance, subagents and retries (real DB)', () => {
    let tmpHome: string;
    let projectDir: string;

    beforeAll(() => {
        jest.spyOn(console, 'log').mockImplementation(() => {});
        initDb(':memory:');
        seedPricing();
    });

    beforeEach(() => {
        getDb().prepare('DELETE FROM sessions').run();
        getDb().prepare('DELETE FROM parsed_files_registry').run();
        getDb().prepare("DELETE FROM model_pricing WHERE is_custom = 1").run();
        getDb().prepare("DELETE FROM settings WHERE key LIKE 'pricing_fingerprint:%'").run();
        tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-pricing-it-'));
        projectDir = path.join(tmpHome, '.claude', 'projects', '-Users-test-proj');
        fs.mkdirSync(projectDir, { recursive: true });
        jest.spyOn(os, 'homedir').mockReturnValue(tmpHome);
    });

    afterEach(() => {
        jest.restoreAllMocks();
        jest.spyOn(console, 'log').mockImplementation(() => {});
        fs.rmSync(tmpHome, { recursive: true, force: true });
    });

    it('prices an unknown model via family fallback and flags it estimated instead of $0', async () => {
        fs.writeFileSync(path.join(projectDir, 'sess-1.jsonl'), [
            user(),
            assistant('1', 'claude-opus-5-5', { input_tokens: 1_000_000, output_tokens: 1_000_000, cache_read_input_tokens: 1_000_000 })
        ].join('\n') + '\n');

        await claudeParser.parse();

        const s = getSession('sess-1');
        // Falls back to the newest known Opus generation (claude-opus-4-8: 5 / 25 / 0.5 per 1M)
        expect(s.estimated_cost_usd).toBeCloseTo(5 + 25 + 0.5, 6);
        expect(s.is_estimated).toBe(1);
        expect(s.cost_source).toBe('family_fallback');
        expect(s.tool).toBe('Claude Code');
    });

    it('does not flag a model that is in the pricing table', async () => {
        fs.writeFileSync(path.join(projectDir, 'sess-2.jsonl'), [
            user(),
            assistant('1', 'claude-sonnet-5', { input_tokens: 1_000_000, output_tokens: 0 })
        ].join('\n') + '\n');

        await claudeParser.parse();

        const s = getSession('sess-2');
        expect(s.estimated_cost_usd).toBeCloseTo(3, 6);
        expect(s.is_estimated).toBe(0);
        expect(s.cost_source).toBe('pricing_table');
    });

    it('flags a session as unpriced (not silently free) when the model family is unknown', async () => {
        fs.writeFileSync(path.join(projectDir, 'sess-3.jsonl'), [
            user(),
            assistant('1', 'mystery-model-9', { input_tokens: 1000, output_tokens: 1000 })
        ].join('\n') + '\n');

        await claudeParser.parse();

        const s = getSession('sess-3');
        expect(s.estimated_cost_usd).toBe(0);
        expect(s.is_estimated).toBe(1);
        expect(s.cost_source).toBe('unpriced');
    });

    it('prices each model in a mixed-model session separately', async () => {
        fs.writeFileSync(path.join(projectDir, 'sess-4.jsonl'), [
            user(),
            // dominant by event count: sonnet (3 events), but opus carries the big output
            assistant('1', 'claude-sonnet-5', { input_tokens: 1_000_000, output_tokens: 0 }),
            assistant('2', 'claude-sonnet-5', { input_tokens: 0, output_tokens: 0 }),
            assistant('3', 'claude-sonnet-5', { input_tokens: 0, output_tokens: 0 }),
            assistant('4', 'claude-opus-4-8', { input_tokens: 0, output_tokens: 1_000_000 })
        ].join('\n') + '\n');

        await claudeParser.parse();

        const s = getSession('sess-4');
        expect(s.model_primary).toBe('claude-sonnet-5');
        expect(s.estimated_cost_usd).toBeCloseTo(3 + 25, 6); // not 15 + 0 at the dominant model
    });

    it('reads subagent files from <project>/<sessionId>/subagents and attributes them to the parent', async () => {
        fs.writeFileSync(path.join(projectDir, 'parent-1.jsonl'), [
            user(),
            assistant('p', 'claude-sonnet-5', { input_tokens: 1_000_000, output_tokens: 0 })
        ].join('\n') + '\n');
        const agentsDir = path.join(projectDir, 'parent-1', 'subagents');
        fs.mkdirSync(agentsDir, { recursive: true });
        fs.writeFileSync(path.join(agentsDir, 'agent-aaa.jsonl'), [
            user(),
            assistant('a', 'claude-sonnet-5', { input_tokens: 0, output_tokens: 1_000_000 })
        ].join('\n') + '\n');
        fs.writeFileSync(path.join(agentsDir, 'agent-bbb.jsonl'), [
            user(),
            assistant('b', 'claude-sonnet-5', { input_tokens: 1_000_000, output_tokens: 0 })
        ].join('\n') + '\n');

        await claudeParser.parse();

        const s = getSession('parent-1');
        expect(s.has_subagents).toBe(1);
        expect(s.subagent_count).toBe(2);
        expect(s.total_subagent_cost_usd).toBeCloseTo(15 + 3, 6);
        expect(s.estimated_cost_usd).toBeCloseTo(3 + 15 + 3, 6);

        // Agent files must not also show up as top-level sessions
        const all = getDb().prepare("SELECT session_id FROM sessions WHERE provider = 'claude-code'").all() as any[];
        expect(all.map(r => r.session_id)).toEqual(['parent-1']);
        const agents = getDb().prepare('SELECT agent_id FROM subagents WHERE parent_session_id = ? ORDER BY agent_id').all(s.id) as any[];
        expect(agents.map(a => a.agent_id)).toEqual(['aaa', 'bbb']);
    });

    it('also reads workflow-spawned subagents nested under subagents/workflows/<workflowId>/', async () => {
        // Claude Code 2.1.29x writes agents started by a workflow into a nested folder; a flat
        // readdir missed them, so their (often larger) cost never reached the parent session.
        fs.writeFileSync(path.join(projectDir, 'parent-wf.jsonl'), [
            user(),
            assistant('p', 'claude-sonnet-5', { input_tokens: 1_000_000, output_tokens: 0 })
        ].join('\n') + '\n');
        const flat = path.join(projectDir, 'parent-wf', 'subagents');
        const nested = path.join(flat, 'workflows', 'wf_123');
        fs.mkdirSync(nested, { recursive: true });
        fs.writeFileSync(path.join(flat, 'agent-flat.jsonl'), [
            user(), assistant('f', 'claude-sonnet-5', { input_tokens: 0, output_tokens: 1_000_000 })
        ].join('\n') + '\n');
        fs.writeFileSync(path.join(nested, 'agent-nested.jsonl'), [
            user(), assistant('n', 'claude-sonnet-5', { input_tokens: 1_000_000, output_tokens: 0 })
        ].join('\n') + '\n');

        await claudeParser.parse();

        const s = getSession('parent-wf');
        expect(s.subagent_count).toBe(2);
        expect(s.total_subagent_cost_usd).toBeCloseTo(15 + 3, 6);
        const all = getDb().prepare("SELECT session_id FROM sessions WHERE provider = 'claude-code'").all() as any[];
        expect(all.map(r => r.session_id)).toEqual(['parent-wf']);
        const agents = getDb().prepare('SELECT agent_id FROM subagents WHERE parent_session_id = ? ORDER BY agent_id').all(s.id) as any[];
        expect(agents.map(a => a.agent_id)).toEqual(['flat', 'nested']);
    });

    it('does not attribute subagents of one session to another session in the same project', async () => {
        for (const sid of ['p-one', 'p-two']) {
            fs.writeFileSync(path.join(projectDir, `${sid}.jsonl`), [user(), assistant(sid, 'claude-sonnet-5', { input_tokens: 10, output_tokens: 10 })].join('\n') + '\n');
        }
        const agentsDir = path.join(projectDir, 'p-two', 'subagents');
        fs.mkdirSync(agentsDir, { recursive: true });
        fs.writeFileSync(path.join(agentsDir, 'agent-zzz.jsonl'), [user(), assistant('z', 'claude-sonnet-5', { input_tokens: 0, output_tokens: 1_000_000 })].join('\n') + '\n');

        await claudeParser.parse();

        expect(getSession('p-one').subagent_count).toBe(0);
        expect(getSession('p-two').subagent_count).toBe(1);
    });

    it('survives a dangling symlink in the projects tree', async () => {
        fs.writeFileSync(path.join(projectDir, 'ok-1.jsonl'), [user(), assistant('1', 'claude-sonnet-5', { input_tokens: 10, output_tokens: 10 })].join('\n') + '\n');
        fs.symlinkSync(path.join(tmpHome, 'does-not-exist.jsonl'), path.join(projectDir, 'dangling.jsonl'));

        await expect(claudeParser.parse()).resolves.toBeUndefined();
        expect(getSession('ok-1')).toBeDefined();
    });

    it('retries a file whose previous parse errored', async () => {
        const file = path.join(projectDir, 'flaky-1.jsonl');
        fs.writeFileSync(file, [user(), assistant('1', 'claude-sonnet-5', { input_tokens: 10, output_tokens: 10 })].join('\n') + '\n');

        jest.spyOn(console, 'error').mockImplementation(() => {});
        const realCreate = fs.createReadStream;
        jest.spyOn(fs, 'createReadStream').mockImplementationOnce(() => { throw new Error('transient EIO'); });
        await claudeParser.parse();
        expect(getSession('flaky-1')).toBeUndefined();
        expect((getDb().prepare('SELECT status FROM parsed_files_registry WHERE file_path = ?').get(file) as any).status).toBe('error');

        (fs.createReadStream as any).mockRestore?.();
        expect(fs.createReadStream).toBe(realCreate);

        await claudeParser.parse(); // file unchanged, but the error entry must not stick
        expect(getSession('flaky-1')).toBeDefined();
        expect((getDb().prepare('SELECT status FROM parsed_files_registry WHERE file_path = ?').get(file) as any).status).toBe('success');
    });

    it('re-prices estimated sessions after a pricing refresh without the log changing', async () => {
        fs.writeFileSync(path.join(projectDir, 'reprice-1.jsonl'), [
            user(),
            assistant('1', 'claude-opus-5-5', { input_tokens: 1_000_000, output_tokens: 0 })
        ].join('\n') + '\n');
        await claudeParser.parse();
        let s = getSession('reprice-1');
        expect(s.is_estimated).toBe(1);
        expect(s.estimated_cost_usd).toBeCloseTo(5, 6);

        // Unchanged pricing: a second cycle must not re-read the file
        const spy = jest.spyOn(fs, 'createReadStream');
        await claudeParser.parse();
        expect(spy).not.toHaveBeenCalled();
        spy.mockRestore();

        // Pricing refresh lands an exact entry for the model
        addCustomPricing({ provider: 'anthropic', model: 'claude-opus-5-5', input: 8, output: 40, cached: 0.8 });
        await claudeParser.parse();

        s = getSession('reprice-1');
        expect(s.is_estimated).toBe(0);
        expect(s.cost_source).toBe('pricing_table');
        expect(s.estimated_cost_usd).toBeCloseTo(8, 6);
    });
});
