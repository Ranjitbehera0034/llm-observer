# LLM Observer 🛡️

**Privacy-first, local-only LLM cost tracking for developers.**

Stop sending your prompt data to SaaS observability tools. LLM Observer runs entirely on your machine — tracks every OpenAI, Anthropic, Gemini, Mistral, and Groq call, calculates exact costs, and visualises everything in a real-time dashboard at `localhost:4001`.

Your API keys, prompts, and responses **never leave your machine**.

---

## Quick start

```bash
npx llm-observer start
```

That's it. Proxy starts on port `4000`, dashboard on port `4001`.

---

## How it works

Point your existing LLM code at the local proxy instead of the provider directly:

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

**Mistral / Groq / Ollama (local)**
```js
baseURL: 'http://localhost:4000/v1/mistral'
baseURL: 'http://localhost:4000/v1/groq'
baseURL: 'http://localhost:4000/v1/custom/http%3A%2F%2Flocalhost%3A11434'
```

Every request is intercepted, logged, costed, and shown in the dashboard — zero changes to your application logic.

---

## Features

### 🔒 100% Private
All data stored in a local SQLite database at `~/.llm-observer/data.db`. No telemetry. No third-party servers. Your prompts and API keys never leave your machine.

### 📊 Real-time dashboard
Live cost counter, request log with filters, latency tracking, model breakdown charts, and cost trajectory over 7 days — all at `http://localhost:4001`.

### 🛡️ Budget guard
Set a daily budget per project. When spend hits the limit, the proxy automatically blocks new requests before you wake up to a $1,000 bill.

```bash
llm-observer budget set 5.00 --daily
```

### 🚨 Anomaly detection
Automatic spike detection — if your spend velocity exceeds 5× your rolling average, an alert fires via webhook (Slack, Discord, or any HTTP endpoint).

### 💡 Cost optimizer
Identifies duplicate prompts, suggests cheaper model alternatives, and calculates potential monthly savings from switching specific call patterns.

### 🔌 6 providers supported
OpenAI · Anthropic · Google Gemini · Mistral · Groq · Custom/Local (Ollama, LM Studio, any OpenAI-compatible endpoint)

### 📦 80+ models priced
Full pricing database for GPT-4o, GPT-4o-mini, o1, o3, Claude Opus/Sonnet/Haiku, Gemini 2.5 Pro/Flash, Mistral, Groq, DeepSeek, Llama, Qwen, and more.

---

## CLI commands

```bash
llm-observer start              # Start proxy + dashboard
llm-observer stop               # Stop all services
llm-observer status             # Show current status and today's spend

llm-observer stats              # Cost breakdown by model (today/week/month)
llm-observer logs               # Live tail of requests
llm-observer logs --provider openai --min-cost 0.01

llm-observer projects list      # List all projects
llm-observer projects create    # Create a new project (interactive)

llm-observer budget set 10.00   # Set $10/day budget on default project
llm-observer config view        # View current configuration

llm-observer export --format csv --range 30d   # Export last 30 days
llm-observer export --format json --range all

llm-observer activate <key>     # Activate Pro license
llm-observer upgrade            # View Pro plans and pricing
```

---

## Dashboard pages

| Page | What it shows |
|---|---|
| **Overview** | Today's spend vs budget, request count, avg latency, error rate, 7-day cost chart |
| **Live Traffic** | Every request in real-time via SSE — provider, model, tokens, cost, latency, status |
| **Insights** | Cost optimizer suggestions, duplicate prompt detection, model downgrade opportunities |
| **Projects** | Multi-project cost isolation — separate budgets per app or environment |
| **Alerts** | Webhook alert rules for budget thresholds and anomaly spikes |
| **Settings** | API key management, proxy config, license activation |

---

## Pricing

| Plan | Price | Features |
|---|---|---|
| **Free** | $0 forever | 1 project · 7-day log retention · Budget guard · Anomaly alerts |
| **Pro** | $19/mo | Unlimited projects · 90-day retention · Cost optimizer · CSV/PDF export · Priority support |
| **Pro (India)** | ₹1,499/mo | Same as Pro, billed via Razorpay |
| **Team** | $49/seat/mo | Everything in Pro + encrypted team sync + shared dashboard |

```bash
llm-observer upgrade            # View plans
llm-observer upgrade --india    # Indian pricing via Razorpay
llm-observer activate <key>     # Activate after purchase
```

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

Config stored at `~/.llm-observer/config.json`.

```bash
llm-observer config view          # See all settings
llm-observer config set webhook_url https://hooks.slack.com/...
llm-observer config set proxy_port 4000
llm-observer config set dashboard_port 4001
```

Or set via environment variables:
```bash
PROXY_PORT=4000 DASHBOARD_PORT=4001 npx llm-observer start
```

---

## Data & privacy

- All data stored locally at `~/.llm-observer/data.db` (SQLite)
- Free tier: 7-day automatic log retention
- Pro tier: 90-day retention
- To delete all data: `rm ~/.llm-observer/data.db`
- Zero telemetry. Zero analytics. Zero outbound connections except to your configured LLM provider.

---

## Links

- [GitHub](https://github.com/Ranjitbehera0034/llm-observer)
- [Issues](https://github.com/Ranjitbehera0034/llm-observer/issues)
- [npm](https://www.npmjs.com/package/llm-observer)

---

## License

MIT © [Ranjit Behera](https://github.com/Ranjitbehera0034)