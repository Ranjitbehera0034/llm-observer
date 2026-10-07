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

    it('only marks Claude Code verified, since every other fixture is hand-written or synthetic', () => {
        const verified = Object.entries(PARSER_VERIFICATION).filter(([, v]) => v.verification === 'verified').map(([k]) => k);
        expect(verified).toEqual(['claude-code']);
        expect(PARSER_VERIFICATION.cursor.verification).toBe('experimental');
        expect(PARSER_VERIFICATION.aider.verification).toBe('experimental');
    });

    it('describes Claude Code verification as what it is: a scrubbed excerpt, not a bill check', () => {
        const note = PARSER_VERIFICATION['claude-code'].note;
        expect(note).toMatch(/scrubbed excerpt/i);
        expect(note).toMatch(/hand-written/i);
        expect(note).toMatch(/not checked against a bill/i);
        expect(note).not.toMatch(/^Recorded Claude Code JSONL fixtures/);
    });
});
