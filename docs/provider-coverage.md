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
