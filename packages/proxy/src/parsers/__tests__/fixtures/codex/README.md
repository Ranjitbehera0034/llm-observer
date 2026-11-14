# Codex schema fixtures

`nested.jsonl` is synthetic, with invented project paths and no user prompts. It follows the nested `event_msg` / `token_count` shape and the cumulative `TokenUsageInfo.total_token_usage` fields defined in OpenAI's public protocol. It exercises repeated cumulative snapshots, cached-input subsets, model changes and function-call IDs. The sibling `../codex-session.jsonl` remains the legacy-format fixture.

Reference inspected 2026-11-14: https://github.com/openai/codex/blob/main/codex-rs/protocol/src/protocol.rs (TokenUsage, TokenUsageInfo).

These tests establish behavior for these shapes, not certification of every Codex version. Compressed archives, forked/shared-history ownership, counter resets, and newer per-thread usage-record events need separate coverage. Ambiguous counters are retained as partial/unpriced, rather than fabricated estimates.
