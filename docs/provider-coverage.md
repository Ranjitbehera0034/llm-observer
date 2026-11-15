# What LLM Observer can track

The beta bundles **113 pricing entries across 13 provider labels**. A price entry is not a tested integration, provider account connection, or guarantee that every endpoint/modality works.

## Proxy adapters

OpenAI, Anthropic, Google, Mistral, Groq, Ollama, custom endpoints, Moonshot/Kimi, DeepSeek, OpenRouter and xAI (11 adapters).

For the compatible providers, save the upstream provider key in Settings → Upstream Providers. Set your client's base URL to `http://localhost:4000/v1/moonshot`, `/v1/deepseek`, `/v1/openrouter`, or `/v1/xai`. Authenticate to the local proxy using an Observer project key; the configured provider key is used upstream. Keep the model ID exactly as provided by the upstream model list. Do not forward an Observer key directly to the provider.

The added adapters capture compatible text/chat usage, including streaming usage events when returned by the upstream. Token reporting requires usage fields; streaming clients may need `stream_options.include_usage`. Image, video, audio, search fees, tool charges and arbitrary provider-specific response formats are not covered by a universal billing parser. Absent prices stay unpriced, not free. Daily catalog refreshes preserve custom prices. Use `llm-observer pricing add --help` to configure verified rates for missing models.

## Other data sources

- Local file parsers import supported Claude Code, Codex CLI, Aider, Cline, Copilot and Windsurf formats. Format/version differences can reduce coverage. Cursor import is in progress and reports unavailable.
- Provider usage/billing sync currently targets OpenAI and Anthropic. Reconciliation across billing accounts and full billing schemas remains work in progress.
- Network monitoring identifies supported connections. It cannot decrypt arbitrary traffic or infer token counts and exact cost from a TCP connection.

Requests that bypass the proxy and do not appear in supported logs or connected provider APIs are invisible. Chat subscriptions and API usage are separate products; a ChatGPT/Claude subscription does not make this app's analyst API calls free.

## What the agents do

The Agents page shows observed subagent activity from supported logs. AI Analyst is a user-triggered paid API analysis of aggregate usage. Task inbox collects local optimizer recommendations and saved analyst advice and tracks user-controlled status. These are different capabilities. The app does not automatically read all conversations, import all task services, execute arbitrary work, or bypass model/service limits.

## Current model IDs checked on 15 November 2026

The Moonshot proxy preserves `kimi-k3`, `kimi-k3.1-pro`, and `kimi-k3.1-pro-highspeed`; DeepSeek preserves `deepseek-flash` and `deepseek-v4-pro`. These are current IDs in the [Kimi API guide](https://platform.kimi.ai/docs/guide/kimi-k3-1-pro-quickstart) and [DeepSeek model page](https://api-docs.deepseek.com/quick_start/pricing/). The Anthropic adapter accepts the current `claude-opus-5-5` and `claude-sonnet-5-5` IDs listed in [Claude model docs](https://platform.claude.com/docs/en/models/overview). No adapter enforces a fixed model allowlist.

A newly released model is usable for observed text/chat calls when its provider accepts it. Observer records the exact returned ID and reported tokens. Unknown or complex pricing remains explicitly unpriced until a verified catalog rate or custom rate is added; provider-specific tool fees, time-based discounts, cache writes, and multimodal charges may require additional billing support. An API key and routing through the proxy or a supported log source are still required. Current-model tests use recorded response shapes, not live provider credentials.

## Local-only prompt mode

Settings → Security & Privacy → Local-only prompts blocks **new** proxy requests to cloud providers before the body is sent or logged. Only the dedicated Ollama adapter pointing to HTTP loopback (`localhost`, `127.0.0.1`, `[::1]`) is allowed. A custom endpoint cannot bypass the guard; a remote Ollama URL is rejected. `LLM_OBSERVER_LOCAL_ONLY=1` locks the policy on at server start. The block applies to clients configured to use Observer; a client calling a cloud provider directly remains outside Observer's control. Already in-flight calls are not recalled. The mode does not make account sync, pricing refresh, license validation, or opt-in activity fully offline; those have separate data boundaries and do not send the proxied prompt body. PII Redaction remains a separate best-effort option for cloud calls when local-only mode is off.
