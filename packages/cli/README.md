# LLM Observer 🛡️

**Privacy-first, local-only LLM cost tracking for developers.**

Stop sending your prompt data to SaaS observability tools. LLM Observer runs entirely on your machine — auto-detects usage from Claude Code, Cursor, Aider, GitHub Copilot, Windsurf, Cline, and OpenAI Codex CLI, or proxies live OpenAI/Anthropic/Gemini/Mistral/Groq/Ollama calls — calculates costs, and visualises everything in a real-time dashboard at `localhost:4001`.

Your API keys, prompts, and responses **never leave your machine** unless you explicitly opt into a feature that sends less than that elsewhere (see [Data & privacy](#data--privacy)).

---

## Quick start

```bash
npx llm-observer start
```

That's it. Proxy starts on port `4000`, dashboard on port `4001`. On first launch it also auto-detects and parses session history from any supported editor already on your machine — no proxy setup required for that part.

---

## How it works

Session tracking (Claude Code, Cursor, Aider, Copilot, Windsurf, Cline, Codex CLI) needs **zero setup** — it just reads files those tools already write.

For **live traffic** — full per-request prompt/response capture, real-time cost, and budget kill switches — point your existing LLM code at the local proxy instead of the provider directly:

**OpenAI (Node.js)**
```js
import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: 'your-actual-key',           // still goes here, stored locally
  baseURL: 'http://localhost:4000/v1/openai',
});
```

**Anthropic (Node.js)**
```js
import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({
  apiKey: 'your-actual-key',
  baseURL: 'http://localhost:4000/v1/anthropic',
});
```

**Google Gemini**
```js
baseURL: 'http://localhost:4000/v1/google'
```

**Mistral / Groq**
```js
baseURL: 'http://localhost:4000/v1/mistral'
baseURL: 'http://localhost:4000/v1/groq'
```

**Ollama (local, first-class — always tracked at $0 cost)**
```js
baseURL: 'http://localhost:4000/v1/ollama'
```

**Any other OpenAI-compatible endpoint (LM Studio, self-hosted, etc.)**
```js
baseURL: 'http://localhost:4000/v1/custom/http%3A%2F%2Flocalhost%3A1234'
```

Every proxied request is intercepted, logged, costed, and shown in the dashboard — zero changes to your application logic.

---

## Features

### 🔒 100% Private by default
All data stored in a local SQLite database at `~/.llm-observer/data.db`. No telemetry. No third-party servers. Your prompts and API keys never leave your machine unless you opt into the proxy (still local-only storage) or the AI Analyst (sends only aggregated numbers, never prompts, and only with your own API key).

### 📊 Real-time dashboard
Live cost counter, request log with filters, latency tracking, model breakdown charts, cost trajectory, subagent trees, statistical A/B comparison, and a reasoning-chain debugger — all at `http://localhost:4001`.

### 🛡️ Budget guard
Set a daily budget per project. When spend hits the limit, the proxy can hard-block new requests before you wake up to a surprise bill.

```bash
llm-observer budget set 5.00 --daily
```

### 🚨 Anomaly & drift detection
Spend-spike alerts via webhook (Slack, Discord, or any HTTP endpoint), plus opt-in response-drift detection that flags when a project's outputs start statistically diverging from its own baseline.

### 💡 Cost optimizer + AI Analyst
Identifies duplicate prompts and cheaper model alternatives with real savings estimates. Optionally, bring your own Anthropic key and get a Claude-generated summary of your spend — built only from aggregated metadata, never your prompts.

### 🔌 7 providers supported
OpenAI · Anthropic · Google Gemini · Mistral · Groq · Ollama (first-class, $0 cost) · Custom/Local (LM Studio or any other OpenAI-compatible endpoint)

### 🔒 Opt-in PII redaction
Regex + Luhn-validated detection for emails, phone numbers, SSNs, credit cards, and API keys/tokens in proxied traffic — off by default, one toggle in Settings.

### 📦 100+ models priced
Pricing database covering GPT-5.x, Claude 5/Opus 4.8/Sonnet 5/Haiku 4.5, Gemini 3.x, Grok 4.x, DeepSeek V4, Mistral, and more — kept current, see the root repo's `pricing.json`.

---

## CLI commands

```bash
llm-observer start                   # Start proxy + dashboard
llm-observer stop                    # Stop all services
llm-observer status                  # Check if the proxy and dashboard are online

llm-observer stats                   # Cost breakdown (--model / --provider filters)
llm-observer logs --tail             # Live tail of requests
llm-observer logs --limit 50         # Show the last N requests

llm-observer projects                # List all projects and budget statuses
llm-observer budget set 10.00 --daily --project <id>

llm-observer export --format csv --range 30d   # Export last 30 days
llm-observer export --format json --range all

llm-observer pricing update          # Refresh pricing from the remote registry
llm-observer audit --range 30d       # Enterprise audit log export
llm-observer config                  # Show current settings (read-only for now)
llm-observer reset --force           # Wipe the local database
```

> **License activation and upgrading to Pro currently happen in the Dashboard** (Settings → License & Billing tab), not the CLI. `llm-observer activate <key>` and `llm-observer upgrade` exist but are placeholders — a follow-up will wire them to the same backend the dashboard already uses correctly.

---

## Dashboard pages

| Page | What it shows |
|---|---|
| **Control Room** (Overview) | Today's spend vs budget, request count, avg latency, error rate, cost trend |
| **Requests** | Every request in real-time via SSE — provider, model, tokens, cost, latency, status, and a reasoning-chain view for any single request |
| **Optimize** | Health score, optimization rules, ROI/plan-value, AI Analyst recommendations |
| **Compare** | Statistical A/B comparison between models, projects, or time windows |
| **Insights** | Cost optimizer suggestions, duplicate prompt detection, model downgrade opportunities |
| **Projects** | Multi-project cost isolation — separate budgets per app or environment |
| **Alerts** | Webhook alert rules for budget thresholds and anomaly spikes |
| **Settings** | API key management, proxy config, PII redaction, drift detection, license activation |

---

## Pricing

| Plan | Price | Features |
|---|---|---|
| **Free** | $0 forever | 1 project · 7-day log retention · Budget guard · Anomaly alerts |
| **Pro** | $19/mo | Unlimited projects · 90-day retention · Cost optimizer · CSV/PDF export · Priority support |
| **Pro (India)** | ₹1,599/mo | Same as Pro, billed via Razorpay |
| **Team** | $49/seat/mo | Everything in Pro + encrypted team sync + shared dashboard *(team-server auth backend exists; dashboard/CLI integration is still in progress — see the [main repo README](https://github.com/Ranjitbehera0034/llm-observer#roadmap))* |

Purchase via the [website](https://www.llm-observer.com) (card or UPI/Razorpay) — your license key is emailed automatically, then activated in **Dashboard → Settings → License & Billing**.

---

## Why not Helicone, Langfuse, or LangSmith?

| | LLM Observer | Helicone | Langfuse | LangSmith |
|---|---|---|---|---|
| Data stays local | ✅ Always | ❌ Cloud | ❌ Cloud | ❌ Cloud |
| No account required | ✅ | ❌ | ❌ | ❌ |
| Works offline | ✅ | ❌ | ❌ | ❌ |
| Your prompts exposed | Never | To their servers | To their servers | To their servers |
| Free tier | Unlimited local | Limited | Limited | Limited |

If you're working on anything sensitive — client data, proprietary prompts, internal tooling — LLM Observer is the only observability tool where your data genuinely never leaves your machine.

---

## Requirements

- Node.js 18+
- macOS / Linux / Windows

---

## Configuration

```bash
llm-observer config               # Print current API URL and ports (read-only)
```

Set via environment variables (see the [main repo README](https://github.com/Ranjitbehera0034/llm-observer#configuration) for the full, current list):
```bash
LLM_OBSERVER_PORT=4001 LLM_OBSERVER_PROXY_PORT=4000 npx llm-observer start

# PROXY_PORT / DASHBOARD_PORT also still work, kept for backward compatibility
```

---

## Data & privacy

- All data stored locally at `~/.llm-observer/data.db` (SQLite)
- Free tier: 7-day automatic log retention
- Pro tier: 90-day retention
- To delete all data: `llm-observer reset --force` (or `rm ~/.llm-observer/data.db`)
- Zero telemetry, zero analytics, zero outbound connections except: your configured LLM provider, and — only if you opt in — the AI Analyst (aggregated metadata only) and license validation (a license key, nothing else)

---

## Links

- [GitHub](https://github.com/Ranjitbehera0034/llm-observer)
- [Issues](https://github.com/Ranjitbehera0034/llm-observer/issues)
- [npm](https://www.npmjs.com/package/llm-observer)

---

## License

MIT © [Ranjit Behera](https://github.com/Ranjitbehera0034)
