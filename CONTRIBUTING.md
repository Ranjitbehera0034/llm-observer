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
   file (not copied from the parser's output), plus an adapter in `formatMatrix.test.ts`, then
   flip the tool to `verified` in `packages/proxy/src/parsers/verification.ts` and the README
   table. Say in the label exactly what the recording covers (tool version, OS, how much).

Never wire a hand-written fixture into the format matrix.

## Architecture Overview

LLM Observer has four independent data-collection paths — most contributions touch one of them:

- **Session Parser** (`packages/proxy/src/parsers/`): reads session-log files editors already write (`~/.claude/`, `~/.cursor/`, etc.) — zero-config, the primary path most users rely on.
- **Proxy** (`packages/proxy/src/proxy.ts`, `server.ts`): an optional transparent proxy — intercepts `POST /v1/<provider>/...`, calculates costs in real time, logs to SQLite. Off by default.
- **Usage API Sync** (`packages/proxy/src/sync/` / rate-limits poller): polls provider admin APIs for provider-reported usage (designed to reconcile with an invoice; not yet validated against a live account, see [`docs/RELEASE_CHECKLIST.md`](docs/RELEASE_CHECKLIST.md)).
- **Network Monitor**: OS-level connection detection for per-app cost attribution.

Cutting across all four: **Budget Guard** (blocks/warns when project limits are exceeded) and the analysis engines under `packages/proxy/src/analysis/` and `packages/proxy/src/optimization/` (response drift, A/B comparison, ROI/plan-value, reasoning-chain reconstruction).
