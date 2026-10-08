# Real-time Claude Code usage via OpenTelemetry

Claude Code can push its own usage telemetry (OpenTelemetry metrics and events). LLM Observer can receive
it on your machine, so a session shows up while it is running instead of after the log file is next read.

It is **opt-in and off by default**. Nothing listens until you turn it on, nothing leaves your machine, and
no prompt text is ever stored.

## Turn it on

1. Start LLM Observer: `npx llm-observer start`.
2. Open **Settings → Security & Privacy → OpenTelemetry Receiver** and switch it on. The receiver starts
   immediately (no restart) and the page shows the endpoint and the exact variables for your port.
3. Paste them into the shell you start Claude Code from:

```bash
export CLAUDE_CODE_ENABLE_TELEMETRY=1
export OTEL_METRICS_EXPORTER=otlp
export OTEL_LOGS_EXPORTER=otlp
export OTEL_EXPORTER_OTLP_PROTOCOL=http/json
export OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:4318
```

4. Run `claude` as usual. The session appears under **Sessions** (its project is shown as
   `(OpenTelemetry)` until the log file is read).

Switching the setting off stops the listener at once. The setting is `otlp_receiver_enabled`.

Things that matter:

- **Protocol must be `http/json`.** The receiver answers `http/protobuf` (and anything that is not JSON)
  with `415` and a message naming `OTEL_EXPORTER_OTLP_PROTOCOL=http/json`. gRPC is not supported.
- **Use `127.0.0.1`, not `localhost`**, in the endpoint. The receiver binds IPv4 loopback only, and some
  runtimes resolve `localhost` to `::1`.
- **Port.** Default `4318` (the standard OTLP/HTTP port). Change it with `LLM_OBSERVER_OTLP_PORT=<port>` in
  the environment of `llm-observer start`, then use the same port in the endpoint. If the port is taken the
  Settings card says so; nothing else is affected.
- **Do not set** `OTEL_LOG_USER_PROMPTS`, `OTEL_LOG_TOOL_DETAILS`, `OTEL_LOG_ASSISTANT_RESPONSES`,
  `OTEL_LOG_TOOL_CONTENT` or `OTEL_LOG_RAW_API_BODIES`. They make Claude Code put content into the telemetry.
  LLM Observer drops it anyway, but it is pointless to send it.
- Optional: `OTEL_METRIC_EXPORT_INTERVAL` (default 60000 ms) and `OTEL_LOGS_EXPORT_INTERVAL` (default
  5000 ms) control how quickly data arrives. Events carry every API request, so they are what makes the
  session near-real-time.

## What is stored

For each API request (`claude_code.api_request` event) or usage counter (`claude_code.token.usage`,
`claude_code.cost.usage` metrics) only these are read:

| Stored | From |
|---|---|
| Session id | `session.id` |
| Model | `model` |
| Input / output / cache-read / cache-write tokens | `input_tokens`, `output_tokens`, `cache_read_tokens`, `cache_creation_tokens` (metrics: `type` = `input`, `output`, `cacheRead`, `cacheCreation`) |
| Cost in USD, **as computed by Claude Code** | `cost_usd` (metric: `claude_code.cost.usage`) |
| Timestamps and a request id, to recognise repeats | `event.timestamp`, `request_id` (metrics: the series and its time window) |

Everything else is ignored and never copied: prompts, responses, tool names/parameters/inputs, error text,
file and workspace paths, and user, account, organisation and e-mail attributes. Traces are accepted and
discarded. The session row is marked `cost_source = reported`.

## How it avoids double counting

- **Repeats.** Each request and each metric window is stored once under a key; delivering the same export
  twice changes nothing. Session totals are recomputed from those rows, never incremented.
- **Events and metrics both on.** Claude Code reports the same requests both ways. When a session has
  events, only the events are used for it; the counters are used only when no events arrive.
- **Delta and cumulative metrics.** Claude Code defaults to delta temporality (each export is new usage, so
  windows are added). With `OTEL_EXPORTER_OTLP_METRICS_TEMPORALITY_PREFERENCE=cumulative` each series
  reports a running total, and the largest value seen is kept instead of adding. Both were observed on real
  output (see below). A metric with unspecified temporality is ignored.
- **The log parser.** Claude Code's log file is still read every few minutes. The telemetry `session.id` is
  treated as the log file's name, so they are one session (see the caveat below). The log parser wins: when it reads the file it
  **replaces** the telemetry-built row (tokens and cost are then LLM Observer's own pricing, not Claude
  Code's reported number), and telemetry for a session the parser already stored is dropped. You get one
  session either way.

## Security

The receiver binds `127.0.0.1` only and has no login, so it refuses anything a web page could send: any
request with an `Origin` header gets `403`, a `Host` other than `localhost`, `127.0.0.1` or `[::1]` gets
`421` (DNS rebinding), and no CORS headers are ever sent. Bodies are limited to 4 MB, both as sent and
after gzip decompression (`Content-Encoding: gzip` is accepted). `GET /health` answers `200`.

## What was and was not verified

Verified on **Claude Code 2.1.294, Linux**: `http/json` export of metrics and events, with delta (the
default) and cumulative temporality, one single-turn `claude -p` run each. The field names and values the
receiver relies on come from those recordings (`fixtures/otlp`, see its README), and the token counts in the
telemetry matched the tool's own log file for the same run.

Caveat on the session id: in both recorded runs the telemetry `session.id` equalled the name of the log file
the same run wrote, but the child `claude` process had inherited its session id from the environment of the
session that launched it, so that equality was observed, not established for a normal fresh start. If the two
ever differ you would see two sessions (one from each source) rather than a wrong total.

Not verified: macOS and Windows, other Claude Code versions, long or multi-turn sessions, subagent
telemetry, `http/protobuf` and gRPC (deliberately unsupported), Codex or any other tool (this only maps
`claude_code.*` telemetry), and a real, sustained export over hours.

Known limits: telemetry sent while LLM Observer is not running or the receiver is off is not replayed (the
log parser still covers it later); there is no project name or tool-call breakdown until the log file is
read; and the Sessions page does not yet show the `source` column.
