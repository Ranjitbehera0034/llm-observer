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
    // claude-opus-5-5 is deliberately absent from the price table (family fallback must kick in)
    getPricingForModel: jest.fn((_provider: string, model: string) =>
        model.startsWith('claude-opus-5') ? undefined : { input: 3, output: 15, cached: 0.3 }
    ),
    fetchPricingFromDb: jest.fn(() => [
        { provider: 'anthropic', model: 'claude-opus-4-8', input_cost_per_1m: 5, output_cost_per_1m: 25, cached_input_cost_per_1m: 0.5 },
        { provider: 'anthropic', model: 'claude-sonnet-5', input_cost_per_1m: 3, output_cost_per_1m: 15, cached_input_cost_per_1m: 0.3 }
    ])
}));

const SYNTHETIC_DIR = path.join(__dirname, 'fixtures', 'synthetic', 'claude');
const manifest = JSON.parse(fs.readFileSync(path.join(SYNTHETIC_DIR, 'manifest.json'), 'utf8'));

/**
 * Parser behaviour on HAND-WRITTEN Claude Code logs (fixtures/synthetic/claude/).
 *
 * These are not recordings: each file was written by hand to pin one behaviour
 * (the pre-nesting legacy layout, per-content-block usage dedupe, per-model pricing with
 * an unknown model). They prove the parser does what its author intended, not that
 * Claude Code writes these shapes. The real recording is checked by formatMatrix.test.ts.
 */
describe('Claude parser, synthetic (hand-written) fixtures', () => {
    let tmpHome: string;
    let projectDir: string;

    beforeEach(() => {
        jest.clearAllMocks();
        tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-synthetic-'));
        projectDir = path.join(tmpHome, '.claude', 'projects', '-fixture-project');
        fs.mkdirSync(projectDir, { recursive: true });
        jest.spyOn(os, 'homedir').mockReturnValue(tmpHome);
    });

    afterEach(() => {
        jest.restoreAllMocks();
        fs.rmSync(tmpHome, { recursive: true, force: true });
    });

    it('keeps hand-written files out of the recorded-format matrix', () => {
        const matrix = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'format-matrix.json'), 'utf8'));
        const wired = (matrix.claude as { fixture: string }[]).map(e => e.fixture);
        for (const entry of manifest.claude as { fixture: string }[]) {
            expect(wired).not.toContain(entry.fixture);
            expect(wired.some(f => f.includes('synthetic'))).toBe(false);
        }
    });

    it.each(manifest.claude as any[])('$fixture: $description', async ({ fixture, expected }) => {
        fs.copyFileSync(path.join(SYNTHETIC_DIR, fixture), path.join(projectDir, fixture));

        await claudeParser.parse();

        const sessionId = fixture.replace(/\.jsonl$/, '');
        const call = (dbMock.insertSession as jest.Mock).mock.calls
            .map((c: any[]) => c[0])
            .find((s: any) => s.session_id === sessionId);

        expect(call).toBeDefined();
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
    });
});
