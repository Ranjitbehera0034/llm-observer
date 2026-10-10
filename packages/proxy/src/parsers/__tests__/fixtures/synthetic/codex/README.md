# Codex fixtures: SYNTHETIC, NOT A REAL RECORDING

`codex-session.synthetic.jsonl` was written by hand. It was NOT captured from a running Codex CLI.
It is the file that used to be `fixtures/codex-session.jsonl`, kept unchanged apart from its name. Its token
counts and timestamps are made up.

It uses a shape that real Codex never wrote: flat top-level `message`, `tool_call` and `tool_result` lines with
`usage` and `model` on the event. Codex CLI 0.162.1 writes envelope lines (`{timestamp, ordinal, type, payload}`)
with usage in `event_msg` / `token_count`, the model in `turn_context` and the project in `session_meta`.
The real recording is in `../../codex/recorded/codex-0.162.1/`.

It is kept only so `codex.parser.test.ts` can show that logs in the old hand-written shape are still read
(the parser still has that code path). It is NOT wired into the format matrix.
