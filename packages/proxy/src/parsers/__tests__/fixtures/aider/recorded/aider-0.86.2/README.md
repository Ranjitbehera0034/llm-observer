# Aider recording (scrubbed analytics log)

An analytics log written by the REAL Aider tool, run non-interactively on this machine, with the model
endpoint replaced by a mock. This is the only Aider fixture in the format matrix
(`fixtures/format-matrix.json`, key `aider`). The hand-written file that used to stand in for it now
lives under `../../../synthetic/aider/` and is NOT a recording.

| | |
|---|---|
| Tool | Aider 0.86.2 (`aider-chat==0.86.2` from PyPI, litellm 1.81.10, openai 2.20.0) |
| Python | 3.12.3, in a fresh virtualenv |
| OS | Linux (x86_64) |
| Recorded | 8 October 2026, in a cloud sandbox |
| File | `analytics.jsonl`, 34 lines, one JSON object per line: `{event, properties, user_id, time}` |

## What was mocked (read this)

The model was NOT real. Every request went to a small Node server on `127.0.0.1` that implements
`POST /v1/chat/completions` and always answers with the same sentence. No LLM API was called and no
API key was used (`--openai-api-key test`).

- **Non-streamed requests** (launches 1 and 4): the mock returns an OpenAI `usage` object with
  deterministic counts that depend only on the request's position (`1000 + 100n` prompt tokens,
  `50 + 10n` completion tokens). Aider read those counts, so `prompt_tokens` / `completion_tokens` in
  the log are the mock's numbers: 1100/60, 1200/70 and 1500/100.
- **Streamed requests** (launch 2, Aider's default): the mock also sent a final SSE chunk with `usage`,
  but Aider 0.86.2 does not ask for streaming usage (no `stream_options` anywhere in its source) and
  ignored it. The 809/13 and 835/13 counts in the log are Aider's OWN tokenizer estimates, not the
  mock's. This is how Aider behaves against a real streaming endpoint too: streamed token counts are
  estimates.
- **Costs** are whatever Aider computed. For `openai/gpt-4o-mini` Aider multiplied the counts by the
  gpt-4o-mini prices in litellm's model price map (so the cost is real-price arithmetic on mock or
  estimated tokens, not a bill). For `openai/mock-model` litellm has no price, so Aider logged
  `cost: 0`.

The recording therefore shows the log FORMAT of Aider 0.86.2. It does not show that token counts match
what a provider reports, and the dollar costs are not checked against any invoice.

## Command

Aider was started from a scratch git repo (one file, `hello.py`) with a fresh `HOME`, so its own
`~/.aider` state was new. Each of the four launches appended to the same log:

```
aider --model <MODEL> --openai-api-base http://127.0.0.1:<port>/v1 --openai-api-key test \
      --yes-always --no-analytics --analytics-log <log> --no-check-update --no-show-release-notes \
      --no-show-model-warnings --no-pretty [--no-stream] [--message '...'] hello.py
```

| Launch | Model | Mode | What happened | Lines |
|---|---|---|---|---|
| 1 | `openai/mock-model` | `--no-stream`, prompts piped on stdin | 2 prompts, `/tokens`, `/exit` | 1-11 |
| 2 | `openai/gpt-4o-mini` | streaming (default), stdin | 2 prompts, `/exit` | 12-21 |
| 3 | `mock-model` (no provider prefix) | stdin | request failed in litellm ("LLM Provider NOT provided"): `message_send_starting` but no `message_send` | 22-28 |
| 4 | `openai/gpt-4o-mini` | `--no-stream --message` | 1 prompt, exit "Completed --message" | 29-34 |

`--no-analytics` matters: opting in (or letting Aider ask, which it does for about 10 percent of
install ids) would enable Aider's PostHog uploader. With `--no-analytics` nothing is sent anywhere and
the local `--analytics-log` file is still written, which is also what a user who never opted in gets.
Aider itself downloaded litellm's public model price map from GitHub on start-up; that is its normal
behaviour and the only outbound traffic besides the pip install.

## What the format turned out to be

- Envelope: `{"event", "properties", "user_id", "time"}`, in that key order. `time` is integer Unix seconds.
  `user_id` is one random UUID per install. There is no session id, project id, working directory or
  file name in any event; a "session" can only be inferred from the `launched` ... `exit` span.
- Events seen: `launched`, `repo` (`num_files`), `auto_commits` (`enabled`), `cli session` (models and
  `edit_format`), `message_send_starting`, `message_send`, `command_tokens`, `command_exit`, `exit`
  (`reason`). Only `message_send` has `prompt_tokens`, `completion_tokens`, `total_tokens`, `cost` (this
  message) and `total_cost` (running total for the launch, resets on the next launch).
- `message_send` is written after the reply arrives; the preceding `message_send_starting` gives the
  request start. A failed request has the start event only.
- Model names are litellm ids. A known model keeps its name (`openai/gpt-4o-mini`); an unknown model
  with a provider prefix becomes `openai/REDACTED`; an unknown model without a prefix becomes the
  string `None`. The bare string `REDACTED` was never seen. `None` appeared only on events without
  usage here (launch 3) because a model Aider cannot route cannot complete a request.

## What was scrubbed

The raw log held nothing private beyond two things, so only those were changed (checked by reading the
file and grepping for paths, the username, `127.0.0.1`, `@`, `test` and key-like strings):

- `user_id`: the random per-install UUID replaced by another random UUID, the same on every line.
- `time`: every timestamp shifted by one constant so the first event is 2026-01-12T09:00:00Z; the
  relative gaps are unchanged.

All event names, property names, nesting, model names, token counts, costs and the order of lines are
exactly as Aider wrote them. Aider's analytics events never contain prompts, replies, file names or
paths, which the formatMatrix test also asserts by scanning for common leaks.

## Not covered

Other Aider versions, macOS and Windows, caching models (`cache_*` token fields), architect/editor
mode, a model with a real provider key, and anything the mock cannot produce (a reply that edits files,
rate limits, `message_send_exception`).
