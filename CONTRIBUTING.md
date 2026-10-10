# Contributing to LLM Observer

Thank you for your interest in contributing to LLM Observer!

## Monorepo Structure

- `packages/proxy`: The core interception engine + session-log parsers + optimization/analysis engines (Node.js/Express).
- `packages/database`: Shared database layer (SQLite/better-sqlite3).
- `packages/cli`: Command-line interface, published to npm as `llm-observer`.
- `packages/dashboard`: React-based observability dashboard (Vite).
- `packages/desktop`: Tauri desktop app wrapping the proxy + dashboard (see [SIGNING.md](packages/desktop/SIGNING.md) for release signing).
- `packages/license-server`: Vercel-hosted payment webhook relay and license key issuance (Razorpay / Lemon Squeezy).
- `packages/team-server`: Express + MongoDB team auth backend (password + OIDC login, team membership) — API-only today, no dashboard UI yet.
- `landing-page`: Marketing site source (llm-observer.com).
- `scripts/verify-costs.js`: Independent cost-verification script — recomputes token counts/cost straight from raw session files and diffs against the app's own database, without calling any of the app's own code.

## Development Setup

1. **Install Dependencies**:
   ```bash
   npm install
   ```
   The local SQLite database is created and migrated automatically the first time the proxy or CLI starts — no separate init step.

2. **Run in Development**:
   ```bash
   npm run dev
   ```

## Testing

We use Jest for testing. Please ensure all tests pass before submitting a PR.

```bash
npm test
```

If you're touching a session-log parser (`packages/proxy/src/parsers/`), also see
[`formatMatrix.test.ts`](packages/proxy/src/parsers/__tests__/formatMatrix.test.ts) —
scrubbed excerpts of REAL logs checked against a golden-output manifest,
specifically to catch upstream log-format changes. Hand-written fixtures do not
go there: they live under `fixtures/synthetic/` with their own manifest and test
([`syntheticFormats.test.ts`](packages/proxy/src/parsers/__tests__/syntheticFormats.test.ts)),
and must be labelled as hand-written.

### Adding a parser

A parser is one **adapter** (a small object implementing `ParserAdapter` from
[`parsers/adapter.ts`](packages/proxy/src/parsers/adapter.ts)) plus a recording. The adapter is the single source of
truth for that tool: its name, how far its format is verified, where its files are and how to read them. The manager,
the file watcher, `GET /api/sessions/providers` and the tests are all driven from the list in
[`parsers/registry.ts`](packages/proxy/src/parsers/registry.ts); nothing else lists the agents.

```ts
// packages/proxy/src/parsers/myagent.ts
import fs from 'fs';
import path from 'path';
import os from 'os';
import { insertSession } from '@llm-observer/database';
import { ParserAdapter, locator } from './adapter';
import { findFilesRecursive, shouldParseFile, markFileParsed } from './utils';

/* PRIVACY RULE: metadata only (token counts, duration, tool counts). Never store prompt or response text. */

// Compute paths when called, not at import: tests redirect os.homedir().
const getDir = () => path.join(os.homedir(), '.myagent', 'sessions');

export const parse = async (onProgress?: (current: number, total: number) => void): Promise<void> => {
    if (!fs.existsSync(getDir())) return;                        // tool not installed: do nothing, never throw
    const files = findFilesRecursive(getDir(), /\.jsonl$/);
    let done = 0;
    for (const file of files) {
        onProgress?.(++done, files.length);
        const mtime = fs.statSync(file).mtimeMs;
        if (!shouldParseFile(file, mtime)) continue;             // incremental: skip files unchanged since the last run
        try {
            // ...read the file, then insertSession({ provider: 'myagent', session_id: <stable id>, ... })
            markFileParsed(file, 'myagent', mtime, 'success');
        } catch (err) {
            markFileParsed(file, 'myagent', mtime, 'error', String(err)); // one bad file must not stop the rest
        }
    }
};

// Where the tool's data is. Return [] (do not throw) when it is absent.
const located = locator(() => (fs.existsSync(getDir()) ? [getDir()] : []));
// If the data is a single file, watch its directory instead: locator(() => [file], paths => paths.map(p => path.dirname(p)))

export const adapter: ParserAdapter = {
    id: 'myagent',                       // the `provider` you write, and the key in /api/sessions/providers
    displayName: 'My Agent',             // used verbatim in the README table
    verification: {
        level: 'unverified',             // see "How verification is earned" below
        note: 'Fixtures are hand-written, not recorded from the real tool.',
    },
    detect: located.detect,              // { found, paths }
    watchPaths: located.watchPaths,      // directories whose changes mean new data
    parse: opts => parse(opts?.onProgress),
};
```

Then:

1. Add `import { adapter as myagent } from './myagent';` and append `myagent` to `ADAPTERS` in `registry.ts`. The
   manager (one adapter throwing never stops the others; per-adapter timing is logged), the providers endpoint and the
   file watcher pick it up from there.
2. Add a row to the README table (*Auto-Detected Session Files*), with the adapter's `displayName` as the tool name and
   the same level (`**Unverified**`, `**Experimental**` or `**Verified**`) at the start of the status cell.
   `readmeParserTable.test.ts` fails when the table and the registry disagree.
3. Add a seeder for it in `adapterConformance.test.ts` (`SEEDERS`: copy a fixture into the layout the tool writes
   under a temp home). It is required for `verified` adapters and strongly advised for the rest.
4. Run `cd packages/proxy && npx jest src/parsers`.

`adapterConformance.test.ts` runs against every adapter in the registry and enforces that it: has an id, display name
and a verification note; is idempotent (`parse()` twice leaves the same row counts); reports nothing found, and does
not throw, when the home directory is missing or `os.homedir()` throws; and, if `verified`, names a recorded
(not synthetic) fixture in `format-matrix.json`. It also checks that the manager survives an adapter that throws.

**How verification is earned.** `unverified` is the default for a new parser: it reads data, but its fixtures were
written by hand from the tool's docs or source, so it may disagree with the real tool. `experimental` is unverified
with a known gap (no usable local data, or the log must be enabled by hand). `verified` is earned in exactly one way: a
recording made by the real tool, scrubbed, checked in under `fixtures/<key>/recorded/<tool>-<version>[-<os>]/`, with a
README that names the tool version, OS and anything mocked, and wired into `format-matrix.json` with golden values
computed from the raw file. Set `verification: { level: 'verified', recording: '<key>', note }` on the adapter, where
`<key>` is that top-level key of `format-matrix.json`. A hand-written fixture never counts, however good, and a
recording does not mean costs were checked against a bill; say in `note` exactly what the recording covers.

**Fast path.** You do not have to do anything for it: `watchPaths()` tells the watcher where to look, and a change
re-runs only your adapter's `parse` a few seconds later (debounced, one run at a time per adapter, changes inside the
database directory ignored). Keep `parse` incremental (skip unchanged files) so those runs are cheap. Where recursive
`fs.watch` is not available (Node 18 on Linux), or a watch fails (inotify limits), that path is polled every 30 seconds
instead. The 5-minute full scan always runs as a safety net. `LLM_OBSERVER_WATCH=0` turns the watcher off.

**Checklist**

- [ ] `parsers/<agent>.ts` exports `parse` and `adapter`; the privacy rule comment is there and nothing stores prompt text
- [ ] `detect()` / `watchPaths()` return nothing, rather than throw, when the tool is not installed
- [ ] `parse()` is incremental and idempotent: stable session ids, unchanged files skipped, one bad file does not stop the rest
- [ ] Listed in `registry.ts`; row added to the README table with the same level
- [ ] Fixtures: hand-written under `fixtures/synthetic/` and labelled so, or a real recording (below)
- [ ] Seeder added to `adapterConformance.test.ts`; `npx jest src/parsers` passes
- [ ] Verified only if there is a real recording wired into `format-matrix.json`; the note says what it does and does not cover

### Capturing a real recording

Claude Code, Aider and Codex CLI are marked **verified**, and only narrowly. Claude Code's recording is a scrubbed
excerpt of one real Claude Code 2.1.291 log from Linux
([`fixtures/claude/recorded/`](packages/proxy/src/parsers/__tests__/fixtures/claude/recorded/claude-code-2.1.291-linux/README.md)).
Aider's is a scrubbed analytics log written by real Aider 0.86.2 on Linux against a mock model endpoint
([`fixtures/aider/recorded/`](packages/proxy/src/parsers/__tests__/fixtures/aider/recorded/aider-0.86.2/README.md)),
so it verifies the log format, not token counts or costs. Codex's is four scrubbed rollout files written by
real Codex CLI 0.162.1 on Linux against a mock Responses-API endpoint
([`fixtures/codex/recorded/`](packages/proxy/src/parsers/__tests__/fixtures/codex/recorded/codex-0.162.1/README.md)),
again the format only. Claude Code's older-format fixtures and every other parser's fixtures are
hand-written (the old Aider and Codex files are kept, labelled synthetic, in
[`fixtures/synthetic/aider/`](packages/proxy/src/parsers/__tests__/fixtures/synthetic/aider/README.md) and
[`fixtures/synthetic/codex/`](packages/proxy/src/parsers/__tests__/fixtures/synthetic/codex/README.md)),
so those agree with their fixtures, not necessarily with the real tool. A parser
is promoted to verified only with a recording from a real install:

1. Use the tool normally on a throwaway project for a few prompts (include a tool call or
   edit if the tool supports them). For Aider, start it with
   `aider --analytics-log ~/.aider/analytics.jsonl`; it writes no log otherwise. Add `--no-analytics`
   unless you want Aider's own remote analytics on: the local log is written either way. To record
   without a paid model, point `--openai-api-base` at a small mock `/v1/chat/completions` server and say
   so in the README (see the Aider recording for the exact command and what the mock changes).
   For Codex CLI, install `@openai/codex` into a scratch prefix, give it a throwaway `HOME` and
   `CODEX_HOME`, put a `[model_providers.<id>]` block with `wire_api = "responses"` and a loopback
   `base_url` in `$CODEX_HOME/config.toml`, serve `POST /v1/responses` as server-sent events from a mock,
   and run `codex exec --skip-git-repo-check "<prompt>"`; the rollout lands in `$CODEX_HOME/sessions/`
   (see the Codex recording's README for the exact setup).
2. Copy the file(s) the parser reads (see the table in the README) into
   `packages/proxy/src/parsers/__tests__/fixtures/<tool>/`. For SQLite stores, copy the
   `.db`/`.vscdb` file after closing the editor.
3. Scrub anything private: prompts, file contents, paths, emails, API keys, and user ids.
   Keep structure, field names and numeric values. The parsers do not store prompt text,
   and fixtures must not either. For Claude Code, do not copy a log by hand: run
   `node scripts/redact-claude-recording.js --session ~/.claude/projects/<project>/<id>.jsonl
   [--subagent <agent-*.jsonl>] --out <fixture dir>`. It keeps record shapes, field names, model
   ids and every number, replaces all other strings with `[redacted]`, gives every id fresh random
   values and shifts timestamps. Then grep the output for your home path, username, email, repo
   names and URLs before committing (`formatMatrix.test.ts` also scans for common leaks). Never
   commit raw log content.
4. Note in a README next to the fixture the tool version, OS and date it was recorded.
   Do not label hand-written files as recordings.
5. Add the fixture to `format-matrix.json` with golden values computed by hand from the raw
   file (not copied from the parser's output), plus a describe block in `formatMatrix.test.ts`, then
   set the adapter's `verification` to `{ level: 'verified', recording: '<format-matrix key>', note }`
   (in the parser's own file, `packages/proxy/src/parsers/<tool>.ts`) and flip the README
   table row. Say in the note exactly what the recording covers (tool version, OS, how much).

Never wire a hand-written fixture into the format matrix. `adapterConformance.test.ts` fails if an adapter claims
`verified` without a matrix entry, if a matrix entry belongs to no verified adapter, or if the fixture is not under
`recorded/`.

## Architecture Overview

LLM Observer has four independent data-collection paths — most contributions touch one of them:

- **Session Parser** (`packages/proxy/src/parsers/`): reads session-log files editors already write (`~/.claude/`, `~/.cursor/`, etc.) — zero-config, the primary path most users rely on.
- **Proxy** (`packages/proxy/src/proxy.ts`, `server.ts`): an optional transparent proxy — intercepts `POST /v1/<provider>/...`, calculates costs in real time, logs to SQLite. Off by default.
- **Usage API Sync** (`packages/proxy/src/sync/` / rate-limits poller): polls provider admin APIs for provider-reported usage (designed to reconcile with an invoice; not yet validated against a live account, see [`docs/RELEASE_CHECKLIST.md`](docs/RELEASE_CHECKLIST.md)).
- **Network Monitor**: OS-level connection detection for per-app cost attribution.

Cutting across all four: **Budget Guard** (blocks/warns when project limits are exceeded) and the analysis engines under `packages/proxy/src/analysis/` and `packages/proxy/src/optimization/` (response drift, A/B comparison, ROI/plan-value, reasoning-chain reconstruction).
