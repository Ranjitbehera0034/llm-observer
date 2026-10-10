# Codex CLI recording (scrubbed rollout files)

Session logs written by the REAL Codex CLI, run non-interactively on this machine, with the model
endpoint replaced by a mock. This is the only Codex fixture in the format matrix
(`fixtures/format-matrix.json`, key `codex`). The hand-written file that used to stand in for it now
lives under `../../synthetic/codex/` and is NOT a recording.

| | |
|---|---|
| Tool | Codex CLI 0.162.1 (`@openai/codex@0.162.1` from npm; it installs the native `@openai/codex-linux-x64@0.162.1-linux-x64` binary, no Node code runs the model loop) |
| OS | Linux (x86_64), in a cloud sandbox |
| Recorded | 10 October 2026 |
| Files | `sessions/2026/01/12/rollout-*.jsonl`, 4 files (13, 31, 9 and 13 lines): the `$CODEX_HOME/sessions` tree, one JSON object per line: `{timestamp, ordinal, type, payload}` |

## What was mocked (read this)

The model was NOT real. Every request went to a small Node server on `127.0.0.1` that implements only
`POST /v1/responses` (the OpenAI Responses API, streamed as server-sent events: `response.created`,
`response.output_item.added/done`, `response.output_text.delta`, `response.completed`). No LLM API was
called and no API key was used (the key variable held a dummy string). Codex's first request showed it
speaks the Responses API (`wire_api = "responses"`), not chat completions; the mock's request log shows
6 requests in total, all to that one path.

- **Token counts** are the mock's, fixed per scenario so the golden values can be computed by hand:
  a plain reply is `input 1000 / cached 0 / output 50 / reasoning 0`; the tool-call scenario returns
  `1200 / 800 / 80 / 40` for the request that asks for a command and `1500 / 1200 / 30 / 10` for the
  final answer; a later turn in the same thread is `1500 / 700 / 50 / 0`. They show how Codex records the numbers a
  server returns; they are not what a real model reports.
- **The model name is only a label.** The config named the model `mock-model`; one run used
  `-m gpt-5-codex`. No OpenAI model ran. Codex printed `Model metadata for ... not found. Defaulting to
  fallback metadata` for both, so context-window and similar fields in the log are Codex's fallback values.
- **Costs**: the Codex log contains NO cost. LLM Observer prices the tokens from its own price table, so
  the dollar figures in the golden manifest use a flat mocked table, and nothing was checked against a bill.

The recording therefore shows the log FORMAT of Codex CLI 0.162.1. It does not show that token counts match
what OpenAI reports for a real model or account.

## Command

A fresh `HOME` and a fresh `CODEX_HOME` (both temporary directories), so nothing touched a real home, and
a scratch directory that was a git repo with one file as the working directory. `CODEX_HOME/config.toml`:

```toml
model = "mock-model"
model_provider = "mock"
[model_providers.mock]
name = "Mock"
base_url = "http://127.0.0.1:<port>/v1"
env_key = "MOCK_API_KEY"
wire_api = "responses"
request_max_retries = 0
stream_max_retries = 0
```

```
HOME=<tmp> CODEX_HOME=<tmp> MOCK_API_KEY=<dummy> codex exec --skip-git-repo-check [-m <model>] "<prompt>" < /dev/null
HOME=<tmp> CODEX_HOME=<tmp> MOCK_API_KEY=<dummy> codex exec --skip-git-repo-check resume --last "<prompt>" < /dev/null
```

| Run | Prompt (mock scenario) | What happened | Rollout (scrubbed name ends in) |
|---|---|---|---|
| 1 | a short greeting | one request, one text reply | `...0001` |
| 2 | "list the files here" | request 1 returned a reasoning item and an `exec_command` call, Codex ran `ls -a` in its read-only sandbox, request 2 returned the final text | `...0010` |
| 3 | `resume --last` with a second greeting | a new turn appended to run 2's file (same thread, the running totals continue) | `...0010` (same file) |
| 4 | "please fail" | the mock answered HTTP 500 with a JSON error; Codex printed "high demand" and exited | `...0025` |
| 5 | greeting with `-m gpt-5-codex` | one request, one text reply | `...0033` |

Codex also printed `could not create PATH aliases` because its home was under `/tmp`. That is harmless.
Besides the rollout files, the Codex home held SQLite state files (`state_5.sqlite`, `logs_2.sqlite`, ...);
they are not part of the fixture and the parser does not read them. Only the mock's request log was
inspected: it saw nothing but `POST /v1/responses`, but other outbound connections by Codex were not captured.

As a cross-check, the line Codex prints at the end of each run (`tokens used`: 1,050 for run 1, 810 for run 2,
1,660 after the resume in run 3, 1,050 for run 5) equals `input - cached + output` of the mock's numbers
(for run 2: `(1200-800) + 80 + (1500-1200) + 30 = 810`). That is consistent with `input_tokens` including
cached tokens, which is how the parser reads it.

## What the format turned out to be

- Envelope: `{"timestamp","ordinal","type","payload"}` (plus `metadata` on some `response_item` lines).
  `timestamp` is an ISO string; `ordinal` counts lines from 0.
- Top-level `type` values seen: `session_meta` (first line: `payload.id`, `cwd`, `cli_version`, `originator`,
  `model_provider`, `base_instructions`), `event_msg` (`payload.type` is `task_started`, `item_completed`,
  `token_count`, `task_complete`, `thread_settings_applied`), `response_item` (`payload.type` is `message`,
  `reasoning`, `function_call`, `function_call_output`), `turn_context` (`payload.model`, `cwd`, sandbox and
  approval settings), `world_state`, and `token_usage_record`.
- The model is named only in `turn_context.payload.model` (and in `session_meta.payload.base_instructions.provenance.model`).
  Neither `session_meta` nor the messages carry it.
- Usage is written TWICE per API response: a top-level `token_usage_record` (`payload.usage`, `turn_token_usage`,
  `thread_token_usage`) and an `event_msg` with `payload.type == "token_count"` (`payload.info.last_token_usage`
  for that response, `payload.info.total_token_usage` as the running total of the thread, `model_context_window`).
  Summing both would double every count. Each usage object has `input_tokens`, `cached_input_tokens`,
  `cache_write_input_tokens`, `output_tokens`, `reasoning_output_tokens`, `total_tokens`.
- `input_tokens` INCLUDES `cached_input_tokens`, and `output_tokens` INCLUDES `reasoning_output_tokens`
  (`total_tokens` is `input + output`). `cache_write_input_tokens` was 0 everywhere.
- `rate_limits` on `token_count` was all null (API-key style provider).
- Conversation turns are `event_msg` / `item_completed` with `payload.item.type` `UserMessage` or `AgentMessage`.
  The `response_item` messages also include `developer` and injected `user` context messages, so counting them would overcount.
- A tool call is a `response_item` with `payload.type == "function_call"` and `payload.name` (`exec_command`);
  the command's result is a `function_call_output`.
- A resumed session appends to the same file; running totals continue across turns.
- A failed request leaves NO usage and no error line of its own: the only trace is an `error` object
  (`message`, `codex_error_info`) on that turn's `task_complete`.

## What was scrubbed

The raw files held the machine's absolute paths, ids that embed creation times, Codex's whole built-in system
prompt (about 20,000 characters, in `base_instructions` and the `developer` messages), the prompts, the
mock's replies, a command and its output, and an `encrypted_content` blob. All keys, the nesting, the order of lines and every number
(token counts, ordinals, durations, exit code) are exactly as Codex wrote them, except:

- **Timestamps**: every ISO timestamp, Unix-seconds field (`started_at`, `completed_at`), millisecond field
  (`started_at_ms`, `completed_at_ms`) and the float `create_time` was shifted by one constant, so the first
  session starts at 2026-01-12T09:00:00Z; gaps are unchanged. The file names and directories use the shifted time.
- **Ids**: every UUID (thread, turn, item, message and window ids, and ids that embed one such as `msg_<uuid>`,
  `retained_<uuid>`) became a placeholder of the form `00000000-0000-7000-8000-0000000000NN`, the same one wherever
  the original repeated, so the cross references still line up. Ids the mock generated (`resp_mock_N`,
  `msg_resp_mock_N`, `call_resp_mock_N`) were kept.
- **Paths**: every `cwd` and the workspace roots became `/fixture/project`.
- **Free text**: every other string except the enum-like ones below became `[scrubbed:N]`, where N is the
  original length in characters. That covers prompts, replies, the system prompt, shell, date, command lines,
  command output, tool arguments, `encrypted_content`, hashes and the error message.
- **Kept verbatim** (structure, not content): the `type`, `role`, `kind`, `mode`, `status`, `access`, `network`,
  `source`, `originator`, `thread_source`, `turn_trigger`, `history_mode`, `model`, `model_provider`, `name`,
  `cli_version`, `limit_id` and `codex_error_info` values, and the permission profile id `:read-only`.

The scrub was a throwaway script that read the raw files; it is not checked in and the raw files were not kept.
The formatMatrix test scans the fixture for paths, emails, URLs, key-like strings and the prompts.

## Not covered

Other Codex versions (earlier releases wrote a different rollout layout that was not recorded), macOS and Windows,
a real model or a ChatGPT-login account (rate limits, plan type), the interactive TUI (it should write the same rollout; not recorded),
non-zero `cache_write_input_tokens`, compaction, forks and sub-agents, `local_shell_call`, `custom_tool_call` and
`web_search_call` items, images, MCP tools, and `$CODEX_HOME/archived_sessions`.
