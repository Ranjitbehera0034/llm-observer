# Aider fixtures: SYNTHETIC, NOT A REAL RECORDING

`analytics.synthetic.jsonl` was written by hand. It was NOT captured from a running Aider. It was
derived from reading the upstream source before a real recording existed:

- https://github.com/Aider-AI/aider/blob/main/aider/analytics.py
- https://github.com/Aider-AI/aider/blob/main/aider/coders/base_coder.py (`show_usage_report`)

The user ids are the all-zero placeholder UUID. The token counts and costs are made up.

It is kept only to exercise parser edge cases in `aider.parser.test.ts` (appended lines, half-written
lines, pricing-table fallback). It is NOT wired into the format matrix. Where it disagrees with the real
tool, the real tool wins: Aider 0.86.2 writes `openai/REDACTED` for models litellm does not know (this
file uses a bare `REDACTED`), writes litellm-prefixed names such as `openai/gpt-4o-mini`, and also logs
`message_send_starting` before each `message_send` (absent here). The real recording is in
`../../aider/recorded/aider-0.86.2/`.
