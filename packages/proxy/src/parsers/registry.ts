import type { ParserAdapter } from './adapter';
import { adapter as claude } from './claude';
import { adapter as cursor } from './cursor';
import { adapter as aider } from './aider';
import { adapter as codex } from './codex';
import { adapter as cline } from './cline';
import { adapter as windsurf } from './windsurf';
import { adapter as copilot } from './copilot';

/**
 * Every built-in session-log adapter, in the order they are parsed and listed by /api/sessions/providers.
 * To add an agent, export an `adapter` from its parser file and add it here (CONTRIBUTING.md, "Adding a parser").
 */
export const ADAPTERS: readonly ParserAdapter[] = [claude, cursor, aider, codex, cline, windsurf, copilot];

const seen = new Set<string>();
for (const a of ADAPTERS) {
    if (seen.has(a.id)) throw new Error(`Duplicate parser adapter id: ${a.id}`);
    seen.add(a.id);
}

export const getAdapter = (id: string): ParserAdapter | undefined => ADAPTERS.find(a => a.id === id);
