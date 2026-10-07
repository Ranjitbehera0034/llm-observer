# Synthetic Claude Code fixtures: NOT RECORDINGS

Everything in this folder was written by hand to exercise one parser behaviour each. None of it was
captured from a running Claude Code, so it proves the parser agrees with its author's idea of the
format, not with the real tool. The real recording lives in `../../claude/recorded/`.

| File | Purpose |
|---|---|
| `format-v1-legacy-top-level.jsonl` | older layout: model/usage/content at the top level of each event, no `message.id`/`requestId` |
| `format-v2-current-nested.jsonl` | nested layout, usage repeated per content-block line and deduped by `(message.id, requestId)` |
| `format-v3-mixed-unknown-model.jsonl` | mixed-model session where `claude-opus-5-5` is deliberately missing from the (mocked) price table, so family fallback and the estimated flag are exercised; token counts are round numbers for easy arithmetic |

Golden values are in `manifest.json` and checked by `parsers/__tests__/syntheticFormats.test.ts`.
Do not add these files to `format-matrix.json` (see CONTRIBUTING.md, "Capturing a real recording").
