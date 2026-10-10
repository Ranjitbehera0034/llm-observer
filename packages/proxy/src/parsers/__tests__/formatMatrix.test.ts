import * as claudeParser from '../claude';
import * as aiderParser from '../aider';
import * as codexParser from '../codex';
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
    invalidateEstimatedSessions: jest.fn(() => 0),
    // One flat mocked price list; golden costs in format-matrix.json are computed from it.
    getPricingForModel: jest.fn(() => ({ input: 3, output: 15, cached: 0.3 })),
    fetchPricingFromDb: jest.fn(() => [])
}));

const FIXTURES_DIR = path.join(__dirname, 'fixtures');
const CLAUDE_DIR = path.join(FIXTURES_DIR, 'claude');
const manifest = JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, 'format-matrix.json'), 'utf8'));

interface Expected {
    primaryModel: string;
    messageCount: number;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
    toolCalls: Record<string, number>;
    isEstimated: boolean;
    costSource: string;
    costUsd?: number;
}

interface MatrixEntry {
    /** A recording directory under fixtures/claude/: <sessionId>.jsonl plus <sessionId>/subagents/agent-*.jsonl. */
    fixture: string;
    description: string;
    expected: Expected & {
        sessionType: string;
        subagents?: (Omit<Expected, 'primaryModel'> & { agentId: string; model: string })[];
    };
}

const copyDir = (from: string, to: string) => {
    fs.mkdirSync(to, { recursive: true });
    for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
        const src = path.join(from, entry.name);
        const dest = path.join(to, entry.name);
        if (entry.isDirectory()) copyDir(src, dest);
        else if (entry.name.endsWith('.jsonl')) fs.copyFileSync(src, dest); // skip the README
    }
};

/**
 * Recorded-format regression matrix.
 *
 * Each entry is a scrubbed excerpt of a REAL Claude Code session log (see the README in the
 * fixture folder for the tool version, OS, and what was redacted), checked in next to the
 * golden output the parser must produce for it (fixtures/format-matrix.json). If Claude Code's
 * log format changes upstream in a way this parser doesn't already handle, this fails loudly
 * here instead of a user silently seeing a $0 session.
 *
 * Hand-written files do NOT belong here: they live in fixtures/synthetic/ and are covered by
 * syntheticFormats.test.ts. Parsers other than Claude Code, Aider and Codex are not in this matrix either,
 * because their fixtures are hand-written; add an entry only with a real recording (CONTRIBUTING.md,
 * "Capturing a real recording"). The Aider and Codex recordings are in the describe blocks below.
 */
describe('Claude parser, recorded format matrix', () => {
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

    it.each(manifest.claude as MatrixEntry[])('$fixture: $description', async ({ fixture, expected }) => {
        copyDir(path.join(CLAUDE_DIR, fixture), projectDir);

        await claudeParser.parse();

        const sessionFiles = fs.readdirSync(projectDir).filter(f => f.endsWith('.jsonl'));
        expect(sessionFiles).toHaveLength(1);
        const sessionId = sessionFiles[0].replace(/\.jsonl$/, '');
        const sessions = (dbMock.insertSession as jest.Mock).mock.calls.map((c: any[]) => c[0]);
        expect(sessions).toHaveLength(1);
        const call = sessions[0];

        expect(call.session_id).toBe(sessionId);
        expect(call.model_primary).toBe(expected.primaryModel);
        expect(call.message_count).toBe(expected.messageCount);
        expect(call.input_tokens).toBe(expected.inputTokens);
        expect(call.output_tokens).toBe(expected.outputTokens);
        expect(call.cache_read_tokens).toBe(expected.cacheReadTokens);
        expect(call.cache_write_tokens).toBe(expected.cacheWriteTokens);
        expect(JSON.parse(call.tool_calls_json)).toEqual(expected.toolCalls);
        expect(call.session_type).toBe(expected.sessionType);
        expect(Boolean(call.is_estimated)).toBe(expected.isEstimated);
        expect(call.cost_source).toBe(expected.costSource);
        if (expected.costUsd !== undefined) expect(call.estimated_cost_usd).toBeCloseTo(expected.costUsd, 6);

        const agents = (dbMock.insertSubagent as jest.Mock).mock.calls.map((c: any[]) => c[0]);
        const wanted = expected.subagents ?? [];
        expect(agents).toHaveLength(wanted.length);
        expect(call.subagent_count).toBe(wanted.length);
        for (const w of wanted) {
            const a = agents.find((x: any) => x.agent_id === w.agentId);
            expect(a).toBeDefined();
            expect(a.model).toBe(w.model);
            expect(a.message_count).toBe(w.messageCount);
            expect(a.input_tokens).toBe(w.inputTokens);
            expect(a.output_tokens).toBe(w.outputTokens);
            expect(a.cache_read_tokens).toBe(w.cacheReadTokens);
            expect(a.cache_write_tokens).toBe(w.cacheWriteTokens);
            expect(JSON.parse(a.tool_calls_json)).toEqual(w.toolCalls);
            expect(Boolean(a.is_estimated)).toBe(w.isEstimated);
            expect(a.cost_source).toBe(w.costSource);
            if (w.costUsd !== undefined) expect(a.estimated_cost_usd).toBeCloseTo(w.costUsd, 6);
        }
    });

    it('only wires recordings into the matrix: every fixture is a directory with a README, none is synthetic', () => {
        for (const { fixture } of manifest.claude as MatrixEntry[]) {
            const dir = path.join(CLAUDE_DIR, fixture);
            expect(fixture).toMatch(/^recorded\//);
            expect(fixture).not.toMatch(/synthetic/i);
            expect(fs.statSync(dir).isDirectory()).toBe(true);
            const readme = fs.readFileSync(path.join(dir, 'README.md'), 'utf8');
            expect(readme).toMatch(/Claude Code \d+\.\d+\.\d+/);
            expect(readme).toMatch(/Linux|macOS|Windows/);
        }
    });

    it('recorded fixtures contain no paths, emails, URLs, or the current home directory', () => {
        const forbidden: RegExp[] = [
            /\/home\//, /\/Users\//, /\/root\b/, /[A-Za-z]:\\/, /@/, /https?:\/\//, /session_/, /\.wt\b/,
        ];
        const home = os.homedir();
        const files: string[] = [];
        const walk = (d: string) => fs.readdirSync(d, { withFileTypes: true }).forEach(e => {
            const p = path.join(d, e.name);
            if (e.isDirectory()) walk(p); else if (e.name.endsWith('.jsonl')) files.push(p);
        });
        walk(path.join(CLAUDE_DIR, 'recorded'));
        expect(files.length).toBeGreaterThan(0);
        const offenders: string[] = [];
        for (const file of files) {
            const text = fs.readFileSync(file, 'utf8');
            for (const re of forbidden) if (re.test(text)) offenders.push(`${path.basename(file)} matches ${re}`);
            if (home.length > 1 && text.includes(home)) offenders.push(`${path.basename(file)} contains the home directory`);
        }
        expect(offenders).toEqual([]);
    });
});

const AIDER_DIR = path.join(FIXTURES_DIR, 'aider');

interface AiderRow {
    line: number;
    model: string;
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
    costSource: string;
    isEstimated: boolean;
    startedAt: string;
    durationSeconds: number;
}

interface AiderEntry {
    fixture: string;
    description: string;
    expected: { eventsInFile: number; sessionRows: number; inputTokens: number; outputTokens: number; rows: AiderRow[] };
}

/**
 * Aider recorded-format matrix.
 *
 * The fixture is the analytics log (`--analytics-log`) written by real Aider 0.86.2, scrubbed (see the
 * README in the fixture folder). The model endpoint was a mock, so token counts are not real model usage;
 * what is checked here is the FORMAT: where the usage lives, how models are named, how events are paired.
 * Golden values were computed by hand from the raw lines (the `line` field is the 1-based line number).
 */
describe('Aider parser, recorded format matrix', () => {
    let tmpHome: string;
    let logPath: string;

    beforeEach(() => {
        jest.clearAllMocks();
        tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'aider-format-matrix-'));
        fs.mkdirSync(path.join(tmpHome, '.aider'), { recursive: true });
        logPath = path.join(tmpHome, '.aider', 'analytics.jsonl');
        jest.spyOn(os, 'homedir').mockReturnValue(tmpHome);
    });

    afterEach(() => {
        jest.restoreAllMocks();
        fs.rmSync(tmpHome, { recursive: true, force: true });
    });

    it.each(manifest.aider as AiderEntry[])('$fixture: $description', async ({ fixture, expected }) => {
        fs.copyFileSync(path.join(AIDER_DIR, fixture, 'analytics.jsonl'), logPath);
        expect(fs.readFileSync(logPath, 'utf8').trim().split('\n')).toHaveLength(expected.eventsInFile);

        await aiderParser.parse();

        const rows = (dbMock.insertSession as jest.Mock).mock.calls.map((c: any[]) => c[0]);
        expect(rows).toHaveLength(expected.sessionRows);
        expect(rows.map((r: any) => r.input_tokens).reduce((a: number, b: number) => a + b, 0)).toBe(expected.inputTokens);
        expect(rows.map((r: any) => r.output_tokens).reduce((a: number, b: number) => a + b, 0)).toBe(expected.outputTokens);

        // Every row is unique and stable: the id is derived from the log path and the line's byte offset.
        expect(new Set(rows.map((r: any) => r.session_id)).size).toBe(rows.length);

        expected.rows.forEach((want, i) => {
            const got = rows[i];
            const label = `line ${want.line}`;
            expect([label, got.provider, got.tool]).toEqual([label, 'aider', 'Aider']);
            expect([label, got.model_primary]).toEqual([label, want.model]);
            expect([label, got.input_tokens]).toEqual([label, want.inputTokens]);
            expect([label, got.output_tokens]).toEqual([label, want.outputTokens]);
            expect([label, got.estimated_cost_usd]).toEqual([label, expect.closeTo(want.costUsd, 9)]);
            expect([label, got.cost_source]).toEqual([label, want.costSource]);
            expect([label, Boolean(got.is_estimated)]).toEqual([label, want.isEstimated]);
            expect([label, got.started_at]).toEqual([label, want.startedAt]);
            expect([label, got.duration_seconds]).toEqual([label, want.durationSeconds]);
        });
    });

    it('only wires a real recording into the matrix: a recorded/ directory with a README naming the Aider version', () => {
        for (const { fixture } of manifest.aider as AiderEntry[]) {
            const dir = path.join(AIDER_DIR, fixture);
            expect(fixture).toMatch(/^recorded\//);
            expect(fixture).not.toMatch(/synthetic/i);
            const readme = fs.readFileSync(path.join(dir, 'README.md'), 'utf8');
            expect(readme).toMatch(/Aider 0\.\d+\.\d+/);
            expect(readme).toMatch(/Linux|macOS|Windows/);
            expect(readme).toMatch(/mock/i);
            expect(fixture).toContain(readme.match(/Aider (0\.\d+\.\d+)/)![1]);
        }
    });

    it('the recording keeps real key names and nesting, and has one scrubbed user id', () => {
        const lines = fs.readFileSync(path.join(AIDER_DIR, 'recorded', 'aider-0.86.2', 'analytics.jsonl'), 'utf8')
            .trim().split('\n').map(l => JSON.parse(l));
        for (const l of lines) expect(Object.keys(l)).toEqual(['event', 'properties', 'user_id', 'time']);
        expect(new Set(lines.map(l => l.user_id)).size).toBe(1);
        const send = lines.find(l => l.event === 'message_send');
        expect(Object.keys(send.properties)).toEqual([
            'main_model', 'weak_model', 'editor_model', 'edit_format',
            'prompt_tokens', 'completion_tokens', 'total_tokens', 'cost', 'total_cost',
        ]);
    });

    it('recorded Aider fixture contains no paths, emails, URLs, keys, or the current home directory', () => {
        const text = fs.readFileSync(path.join(AIDER_DIR, 'recorded', 'aider-0.86.2', 'analytics.jsonl'), 'utf8');
        const forbidden: RegExp[] = [/\/home\//, /\/Users\//, /\/root\b/, /\/tmp\b/, /[A-Za-z]:\\/, /@/, /https?:\/\//, /127\.0\.0\.1/, /sk-/, /session_/, /\.wt\b/];
        const offenders = forbidden.filter(re => re.test(text)).map(String);
        const home = os.homedir();
        if (home.length > 1 && text.includes(home)) offenders.push('home directory');
        expect(offenders).toEqual([]);
    });
});

const CODEX_DIR = path.join(FIXTURES_DIR, 'codex');

interface CodexRow {
    sessionId: string;
    model: string;
    messageCount: number;
    inputTokens: number;
    cacheReadTokens: number;
    outputTokens: number;
    toolCalls: Record<string, number>;
    sessionType: string;
    costUsd: number;
    costSource: string;
    isEstimated: boolean;
    startedAt: string;
    endedAt: string;
    durationSeconds: number;
    projectPath: string;
    projectName: string;
}

interface CodexEntry {
    fixture: string;
    description: string;
    expected: { filesInRecording: number; sessionRows: number; filesWithoutUsage: string[]; rows: CodexRow[] };
}

const listJsonl = (dir: string): string[] => {
    const out: string[] = [];
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) out.push(...listJsonl(p));
        else if (e.name.endsWith('.jsonl')) out.push(p);
    }
    return out.sort();
};

/**
 * Codex CLI recorded-format matrix.
 *
 * The fixture is the `$CODEX_HOME/sessions` tree written by real Codex CLI 0.162.1 (`codex exec`), scrubbed
 * (see the README in the fixture folder). The model endpoint was a mock Responses-API server, so token counts
 * are the mock's; what is checked here is the FORMAT: the envelope, where usage and the model live, that
 * every response's usage is logged twice, that input includes cached tokens, and that a failed request
 * leaves no usage. Golden values were computed by a separate script from the raw lines, not by the parser.
 * Codex writes no cost, so costs use this file's flat mocked price table (3 / 15 / 0.3 USD per million).
 */
describe('Codex parser, recorded format matrix', () => {
    let tmpHome: string;
    let sessionsDir: string;
    const savedCodexHome = process.env.CODEX_HOME;

    beforeEach(() => {
        jest.clearAllMocks();
        delete process.env.CODEX_HOME;
        (dbMock.getPricingForModel as jest.Mock).mockImplementation(() => ({ input: 3, output: 15, cached: 0.3 }));
        tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-format-matrix-'));
        sessionsDir = path.join(tmpHome, '.codex', 'sessions');
        fs.mkdirSync(sessionsDir, { recursive: true });
        jest.spyOn(os, 'homedir').mockReturnValue(tmpHome);
    });

    afterEach(() => {
        jest.restoreAllMocks();
        if (savedCodexHome === undefined) delete process.env.CODEX_HOME; else process.env.CODEX_HOME = savedCodexHome;
        fs.rmSync(tmpHome, { recursive: true, force: true });
    });

    it.each(manifest.codex as CodexEntry[])('$fixture: $description', async ({ fixture, expected }) => {
        const src = path.join(CODEX_DIR, fixture, 'sessions');
        expect(listJsonl(src)).toHaveLength(expected.filesInRecording);
        copyDir(src, sessionsDir);

        await codexParser.parse();

        const rows = (dbMock.insertSession as jest.Mock).mock.calls.map((c: any[]) => c[0])
            .sort((a: any, b: any) => a.session_id.localeCompare(b.session_id));
        expect(rows).toHaveLength(expected.sessionRows);
        expect(new Set(rows.map((r: any) => r.session_id)).size).toBe(rows.length);

        // A file whose only request failed has no usage: no row, but it is still recorded as parsed.
        const parsed = (dbMock.upsertParsedFile as jest.Mock).mock.calls.map((c: any[]) => c[0]);
        expect(parsed).toHaveLength(expected.filesInRecording);
        for (const p of parsed) {
            expect([p.file_path, p.provider, p.status]).toEqual([p.file_path, 'codex', 'success']);
        }
        for (const id of expected.filesWithoutUsage) {
            expect(rows.map((r: any) => r.session_id)).not.toContain(id);
            expect(parsed.map((p: any) => path.basename(p.file_path, '.jsonl'))).toContain(id);
        }

        expected.rows.forEach((want, i) => {
            const got = rows[i];
            const label = want.sessionId.slice(-12);
            expect([label, got.session_id]).toEqual([label, want.sessionId]);
            expect([label, got.tool]).toEqual([label, 'OpenAI Codex CLI']);
            expect([label, got.model_primary]).toEqual([label, want.model]);
            expect([label, got.message_count]).toEqual([label, want.messageCount]);
            expect([label, got.input_tokens]).toEqual([label, want.inputTokens]);
            expect([label, got.cache_read_tokens]).toEqual([label, want.cacheReadTokens]);
            expect([label, got.output_tokens]).toEqual([label, want.outputTokens]);
            expect([label, JSON.parse(got.tool_calls_json)]).toEqual([label, want.toolCalls]);
            expect([label, got.session_type]).toEqual([label, want.sessionType]);
            expect([label, got.estimated_cost_usd]).toEqual([label, expect.closeTo(want.costUsd, 9)]);
            expect([label, got.cost_source]).toEqual([label, want.costSource]);
            expect([label, Boolean(got.is_estimated)]).toEqual([label, want.isEstimated]);
            expect([label, got.started_at]).toEqual([label, want.startedAt]);
            expect([label, got.ended_at]).toEqual([label, want.endedAt]);
            expect([label, got.duration_seconds]).toEqual([label, want.durationSeconds]);
            expect([label, got.project_path]).toEqual([label, want.projectPath]);
            expect([label, got.project_name]).toEqual([label, want.projectName]);
        });
    });

    it('only wires a real recording into the matrix: a recorded/ directory with a README naming the Codex version and the mock', () => {
        for (const { fixture } of manifest.codex as CodexEntry[]) {
            const dir = path.join(CODEX_DIR, fixture);
            expect(fixture).toMatch(/^recorded\//);
            expect(fixture).not.toMatch(/synthetic/i);
            const readme = fs.readFileSync(path.join(dir, 'README.md'), 'utf8');
            expect(readme).toMatch(/Codex CLI \d+\.\d+\.\d+/);
            expect(readme).toMatch(/Linux|macOS|Windows/);
            expect(readme).toMatch(/mock/i);
            expect(fixture).toContain(readme.match(/Codex CLI (\d+\.\d+\.\d+)/)![1]);
            // every rollout says which Codex wrote it
            for (const file of listJsonl(path.join(dir, 'sessions'))) {
                const meta = JSON.parse(fs.readFileSync(file, 'utf8').split('\n')[0]);
                expect([path.basename(file), meta.type, meta.payload.cli_version]).toEqual([path.basename(file), 'session_meta', fixture.replace('recorded/codex-', '')]);
            }
        }
    });

    it('the recording keeps real key names and nesting (envelope, usage logged twice, cumulative totals)', () => {
        const file = listJsonl(path.join(CODEX_DIR, 'recorded', 'codex-0.162.1', 'sessions'))
            .find(f => f.includes('0000000010'))!;
        const lines = fs.readFileSync(file, 'utf8').trim().split('\n').map(l => JSON.parse(l));
        for (const l of lines) expect(Object.keys(l).slice(0, 4)).toEqual(['timestamp', 'ordinal', 'type', 'payload']);
        const usageKeys = ['input_tokens', 'cached_input_tokens', 'cache_write_input_tokens', 'output_tokens', 'reasoning_output_tokens', 'total_tokens'];
        const counts = lines.filter(l => l.type === 'event_msg' && l.payload.type === 'token_count');
        const records = lines.filter(l => l.type === 'token_usage_record');
        expect(counts).toHaveLength(3);
        expect(records).toHaveLength(3);
        for (const c of counts) {
            expect(Object.keys(c.payload.info)).toEqual(['total_token_usage', 'last_token_usage', 'model_context_window']);
            expect(Object.keys(c.payload.info.last_token_usage)).toEqual(usageKeys);
        }
        expect(Object.keys(records[0].payload.usage)).toEqual(usageKeys);
        // totals are cumulative across the resumed second turn
        expect(counts.map(c => c.payload.info.total_token_usage.total_tokens)).toEqual([1280, 2810, 4360]);
        expect(lines.find(l => l.type === 'turn_context').payload.model).toBe('mock-model');
    });

    it('recorded Codex fixtures contain no paths, emails, URLs, keys, prompts or the current home directory', () => {
        const forbidden: RegExp[] = [/\/home\//, /\/Users\//, /\/root\b/, /\/tmp\b/, /[A-Za-z]:\\/, /@/, /https?:\/\//, /127\.0\.0\.1/, /sk-/,
            /claude\.ai/, /\.wt\b/, /scratchpad/, /mock-not-a-key/, /say hi/i, /Hello from the mock/i, /hello\.py/];
        const home = os.homedir();
        const offenders: string[] = [];
        for (const file of listJsonl(path.join(CODEX_DIR, 'recorded'))) {
            const text = fs.readFileSync(file, 'utf8');
            for (const re of forbidden) if (re.test(text)) offenders.push(`${path.basename(file)} matches ${re}`);
            if (home.length > 1 && text.includes(home)) offenders.push(`${path.basename(file)} contains the home directory`);
        }
        expect(offenders).toEqual([]);
    });
});
