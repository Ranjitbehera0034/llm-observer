# Aider fixtures: SYNTHETIC, NOT A REAL RECORDING

`analytics.synthetic.jsonl` was written by hand. It was NOT captured from a running
Aider. It is derived from the upstream source:

- https://github.com/Aider-AI/aider/blob/main/aider/analytics.py
  (`Analytics.event` writes `{"event", "properties", "user_id", "time"}` as one JSON
  object per line when `--analytics-log FILE` is given; `time` is Unix seconds;
  `main_model` is redacted to `REDACTED` for models litellm does not know)
- https://github.com/Aider-AI/aider/blob/main/aider/coders/base_coder.py
  (`show_usage_report` emits `message_send` with `main_model`, `edit_format`,
  `prompt_tokens`, `completion_tokens`, `total_tokens`, `cost`, `total_cost`)

The user ids are the all-zero placeholder UUID. The token counts and costs are made up.

Because it is synthetic, the Aider parser is marked unverified/experimental. To replace
it with a real recording see "Capturing a real recording" in CONTRIBUTING.md.
