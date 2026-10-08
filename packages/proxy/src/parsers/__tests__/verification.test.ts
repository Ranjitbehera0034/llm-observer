import fs from 'fs';
import path from 'path';
import { PARSER_VERIFICATION } from '../verification';
import { getProviderStatus } from '../manager';

jest.mock('@llm-observer/database', () => ({}));

describe('parser verification registry', () => {
    it('labels every parser the manager runs', () => {
        const status = getProviderStatus() as Record<string, any>;
        for (const id of Object.keys(status)) {
            expect(PARSER_VERIFICATION[id]).toBeDefined();
            expect(status[id].verification).toBe(PARSER_VERIFICATION[id].verification);
            expect(status[id].note).toBeTruthy();
        }
    });

    it('only marks parsers verified that have a real recording in the format matrix; every other fixture is hand-written', () => {
        const verified = Object.entries(PARSER_VERIFICATION).filter(([, v]) => v.verification === 'verified').map(([k]) => k);
        expect(verified).toEqual(['claude-code', 'aider']);
        const matrix = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'format-matrix.json'), 'utf8'));
        expect(Object.keys(matrix).filter(k => !k.startsWith('_')).sort()).toEqual(['aider', 'claude']);
        expect(PARSER_VERIFICATION.cursor.verification).toBe('experimental');
        for (const id of ['codex', 'cline', 'windsurf', 'copilot']) expect(PARSER_VERIFICATION[id].verification).toBe('unverified');
    });

    it('describes Aider verification as the log format only: mock endpoint, no bill check, hand-written fixture kept separate', () => {
        const note = PARSER_VERIFICATION.aider.note;
        expect(note).toMatch(/Aider 0\.86\.2/);
        expect(note).toMatch(/log format/i);
        expect(note).toMatch(/mock/i);
        expect(note).toMatch(/not checked against a bill/i);
        expect(note).toMatch(/--analytics-log/);
        expect(note).not.toMatch(/synthetic/i);
    });

    it('describes Claude Code verification as what it is: a scrubbed excerpt, not a bill check', () => {
        const note = PARSER_VERIFICATION['claude-code'].note;
        expect(note).toMatch(/scrubbed excerpt/i);
        expect(note).toMatch(/hand-written/i);
        expect(note).toMatch(/not checked against a bill/i);
        expect(note).not.toMatch(/^Recorded Claude Code JSONL fixtures/);
    });
});
