/**
 * How far each session parser's format has been checked against a real recording of the tool.
 *
 * The adapters (adapter.ts, registry.ts) are the single source of truth: each declares its own level and note.
 * This module is a read-only view of them, kept for code that asked for the old table. See adapter.ts for
 * what 'verified', 'unverified' and 'experimental' mean, and CONTRIBUTING.md, "Adding a parser", for how a
 * parser earns 'verified'.
 */
import { ADAPTERS } from './registry';
import type { VerificationLevel } from './adapter';

export type ParserVerification = VerificationLevel;

export interface ParserVerificationInfo {
    verification: ParserVerification;
    note: string;
}

export const PARSER_VERIFICATION: Record<string, ParserVerificationInfo> = Object.fromEntries(
    ADAPTERS.map(a => [a.id, { verification: a.verification.level, note: a.verification.note }])
);
