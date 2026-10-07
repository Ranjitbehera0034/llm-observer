# Claude Code recording (redacted excerpt)

A real Claude Code session log, truncated and scrubbed. This is the only fixture in the
format matrix (`fixtures/format-matrix.json`).

| | |
|---|---|
| Tool | Claude Code 2.1.291 (parent log) and 2.1.292 (subagent log; the CLI was upgraded mid-run) |
| OS | Linux |
| Recorded | 6-7 October 2026, in a cloud sandbox session that also ran workflow subagents |
| Layout | `<sessionId>.jsonl` plus `<sessionId>/subagents/agent-<id>.jsonl`, as `parsers/claude.ts` reads it |

## What is real

Record types and order, every field name and nesting level, model ids (`claude-opus-5-5` for the
parent, `claude-sonnet-5-5` for the subagent), the full `usage` objects (input, output, cache read,
cache creation with the 1h/5m split, `iterations`), content block structure, tool names, and the
repeated-usage-per-content-block shape that the parser dedupes by `(message.id, requestId)`.
The parent has 16 user/assistant records (5 `Bash` and 1 `Grep` tool calls, three cache-heavy
requests), the subagent 10 (4 `Bash`).

## What was scrubbed

Generated with `node scripts/redact-claude-recording.js --session <log> --subagent <agent log> --records 16 --subagent-records 10 --out <dir>`:

- every string outside a short allowlist of enum-like fields (`type`, `role`, `model`, `stop_reason`,
  `service_tier`, ...) is replaced with `[redacted]`: prompts, assistant text, thinking, tool inputs,
  tool results, attachment bodies, signatures, hostnames, remotes and paths
- all uuids, `msg_`/`req_`/`toolu_` ids, session and agent ids are fresh random values, applied
  consistently so `parentUuid` chains and dedupe keys still line up
- timestamps are shifted by one constant so the log starts at 2026-01-12T09:00:00Z
- `cwd` is `/redacted/project`, `gitBranch` is `main`
- all but two `attachment` records were dropped to keep the file small

Token counts are the real values. They are not secrets, and the golden output depends on them.

## What this does and does not show

It shows the parser reads the current Claude Code log format as it was written by 2.1.291 on Linux.
It does not show the computed dollar cost matches an Anthropic invoice (the matrix prices with a mocked
price table), nor that macOS/Windows logs or older Claude Code versions look the same. Older formats
are covered by the hand-written files in `../../synthetic/claude/`, which are NOT recordings.

## Layout

Workflow-spawned subagents are stored as Claude Code wrote them:
`<sessionId>/subagents/workflows/<workflowId>/agent-*.jsonl` (the workflow id is replaced with
`wf_redacted`). `parsers/claude.ts` reads `subagents/` recursively, so these are attributed to the
parent session along with Task-tool subagents that sit directly under `<sessionId>/subagents/`.
