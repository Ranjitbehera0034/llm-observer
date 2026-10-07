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
 * syntheticFormats.test.ts. Other editors' parsers are not in this matrix either, because their
 * fixtures are hand-written; add an entry only with a real recording (CONTRIBUTING.md,
 * "Capturing a real recording").
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
