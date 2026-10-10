# OTLP fixtures

Payloads for the opt-in OpenTelemetry receiver (`packages/proxy/src/otlp`).

## Provenance: RECORDED, then scrubbed

`delta/`, `cumulative/` and `log/` were produced by the real tool on a Linux machine, not written by hand:

- Tool: Claude Code **2.1.294** (`claude -p 'Reply with the single word: ok' --max-turns 1`), exporting with the
  environment `CLAUDE_CODE_ENABLE_TELEMETRY=1 OTEL_METRICS_EXPORTER=otlp OTEL_LOGS_EXPORTER=otlp
  OTEL_EXPORTER_OTLP_PROTOCOL=http/json OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:<port>`, export intervals
  shortened (`OTEL_METRIC_EXPORT_INTERVAL=2000`, `OTEL_LOGS_EXPORT_INTERVAL=1000`).
  `OTEL_LOG_USER_PROMPTS` and `OTEL_LOG_TOOL_DETAILS` were NOT set (the prompt/response fields therefore
  read `<REDACTED>`).
- Receiver: a throwaway Node HTTP server that wrote each request body to a file. The bodies here are those
  bytes (re-serialised after scrubbing); nothing was mocked or generated.
- Two runs, one real model call each:
  - `delta/`: default temporality (`aggregationTemporality: 1`), session id replaced by `5e55d3a1-0000-4000-8000-000000000001`.
  - `cumulative/`: `OTEL_EXPORTER_OTLP_METRICS_TEMPORALITY_PREFERENCE=cumulative` (`aggregationTemporality: 2`),
    session id replaced by `5e55d3a1-0000-4000-8000-000000000002`. This run also wrote a normal session log.
- `log/5e55d3a1-0000-4000-8000-000000000002.jsonl` is the one `assistant` line of that run's real Claude Code log
  (an excerpt, not the whole file). Its usage (2 / 4 / 25372 / 7277 tokens) equals the telemetry for the same run.
  In the real run the log file name equalled the telemetry `session.id`, which the receiver relies on. Caveat: the
  child `claude` process had inherited its session id from the launching session's environment, so this shows
  the two ids agree in that run, not that a normal fresh start always makes them agree.

### What was scrubbed

Replaced by fixed placeholders, consistently across files: `user.id`, `user.email`, `user.account_uuid`,
`user.account_id`, `organization.id`, `ccr.session.id`, `session.id`, `request_id`, `client_request_id`,
`message.uuid`, `prompt.id`, `traceId`, `spanId`; in the log line also `sessionId`, `cwd`, `uuid`, `parentUuid`,
`message.id`, `requestId`. Token counts, costs, model, timestamps, temporality and every other attribute are
as recorded. The scrub was checked by grepping the output for the original values.

### Files

| File | Signal | Notes |
|---|---|---|
| `delta/01-logs-startup.json` | logs | startup events (`plugin_loaded`, `user_prompt` ...), no usage |
| `delta/02-metrics-session-count.json` | metrics | `claude_code.session.count`, not usage |
| `delta/03-metrics-usage.json` | metrics | `claude_code.cost.usage` + `claude_code.token.usage` (4 types), delta |
| `delta/04-logs-api-request.json` | logs | `claude_code.api_request` + `assistant_response` |
| `delta/05-metrics-active-time.json` | metrics | `claude_code.active_time.total`, not usage |
| `cumulative/01..03` | | the same signals with cumulative temporality |
| `log/*.jsonl` | | Claude Code session log excerpt (for the log-parser interaction tests) |

## Not recorded (so not covered by a recording)

macOS/Windows, other Claude Code versions, multi-turn or subagent sessions, `http/protobuf`, gRPC, Codex.
Anything a test builds beyond these files (many requests, prompt-bearing attributes used as privacy
sentinels, `cost_usd_micros`, int64-as-string) is **synthetic** and is labelled "synthetic" in the test name.
