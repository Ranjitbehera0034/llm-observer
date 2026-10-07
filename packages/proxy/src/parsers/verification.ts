/**
 * How far each session parser's format has been checked against a real recording of the tool.
 *
 * - verified:     the parser has golden-output tests (formatMatrix.test.ts) against a real recording of the tool's
 *                 own files (scrubbed, so a small excerpt). It does NOT mean costs were checked against a bill,
 *                 or that every OS and tool version was recorded.
 * - unverified:   the parser reads data, but its fixtures are hand-written from the tool's docs or source,
 *                 so it may disagree with what the real tool writes.
 * - experimental: unverified, and it also has a known gap (no usable data source, or the log must be enabled by hand).
 *
 * Promote a parser only after a real recording is checked in (see CONTRIBUTING.md,
 * "Capturing a real recording"). Never wire a hand-written fixture into the format matrix.
 */
export type ParserVerification = 'verified' | 'unverified' | 'experimental';

export interface ParserVerificationInfo {
    verification: ParserVerification;
    note: string;
}

export const PARSER_VERIFICATION: Record<string, ParserVerificationInfo> = {
    'claude-code': { verification: 'verified', note: 'Golden-output tests against a scrubbed excerpt of one real Claude Code 2.1.291 log recorded on Linux (parent session plus one subagent file). Older log formats are covered by hand-written fixtures only. Dollar costs are not checked against a bill.' },
    'cursor': { verification: 'experimental', note: 'Cursor logs no token counts locally and its tracking database is not decoded, so no usage is read.' },
    'aider': { verification: 'experimental', note: 'Fixtures are synthetic, derived from upstream source. Aider only writes this file when started with --analytics-log.' },
    'codex': { verification: 'unverified', note: 'Fixtures are hand-written, not recorded from the real tool.' },
    'cline': { verification: 'unverified', note: 'Fixtures are hand-written, not recorded from the real tool.' },
    'windsurf': { verification: 'unverified', note: 'Fixtures are hand-written, not recorded from the real tool.' },
    'copilot': { verification: 'unverified', note: 'Fixtures are hand-written, not recorded from the real tool.' }
};
