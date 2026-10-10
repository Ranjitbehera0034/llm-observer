/**
 * How far each session parser's format has been checked against a real recording of the tool.
 *
 * - verified:     the parser has golden-output tests (formatMatrix.test.ts) against a real recording of the tool's
 *                 own files (scrubbed, so a small excerpt). It does NOT mean costs were checked against a bill,
 *                 that every OS and tool version was recorded, or that the model behind the recording was real:
 *                 the Aider and Codex recordings used a mock model endpoint, so they verify the log FORMAT only.
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
    'aider': { verification: 'verified', note: 'Verified for the log format: golden-output tests against a scrubbed analytics log recorded from real Aider 0.86.2 on Linux. The model endpoint was a mock, so its token counts are the mock\'s (or Aider\'s own estimate when streamed), and costs are not checked against a bill. Other Aider versions, macOS and Windows were not recorded. Aider only writes this file when started with --analytics-log, and the log has no session id, so each message is one row.' },
    'codex': { verification: 'verified', note: 'Verified for the log format: golden-output tests against scrubbed rollout files recorded from real Codex CLI 0.162.1 (codex exec) on Linux. The model endpoint was a mock, so its token counts are the mock\'s, and costs are not checked against a bill (the log holds no cost; LLM Observer prices the tokens). Older Codex versions, macOS, Windows and a real model or account were not recorded: logs in an older layout may not parse. A session whose requests all failed has no usage and gets no row.' },
    'cline': { verification: 'unverified', note: 'Fixtures are hand-written, not recorded from the real tool.' },
    'windsurf': { verification: 'unverified', note: 'Fixtures are hand-written, not recorded from the real tool.' },
    'copilot': { verification: 'unverified', note: 'Fixtures are hand-written, not recorded from the real tool.' }
};
