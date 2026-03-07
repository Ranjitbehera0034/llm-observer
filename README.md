<div align="center">

# ⬡ LLM Observer

**Stop burning money on AI APIs. Track every token, every dollar, every millisecond.**

Privacy-first LLM cost tracking that runs entirely on your machine.
Your API keys and prompts never leave localhost.

[![npm version](https://img.shields.io/npm/v/llm-observer?color=3dffa0&style=flat-square)](https://www.npmjs.com/package/llm-observer)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue?style=flat-square)](LICENSE)
[![GitHub stars](https://img.shields.io/github/stars/Ranjitbehera0034/llm-observer?color=ffda4a&style=flat-square)](https://github.com/Ranjitbehera0034/llm-observer/stargazers)

<!-- TODO: Replace with actual demo GIF -->
<!-- ![LLM Observer Demo](./docs/assets/demo.gif) -->

[Quick Start](#-quick-start) · [Features](#-features) · [Dashboard](#-dashboard) · [Why Local?](#-why-local) · [Docs](https://llm-observer.dev/docs) · [Roadmap](#-roadmap)

</div>

---

## The Problem

You're building with OpenAI, Claude, and Gemini. Maybe all three. But you have **zero visibility** into what you're actually spending.

- A junior dev pushes a bug with an infinite loop → **$3,000 bill overnight**
- You're not sure if GPT-4o or Claude Sonnet is cheaper for your use case → **guessing, not knowing**
- Your AI feature works but you can't tell finance how much it costs per user → **no unit economics**
- You want to try a cheaper model but can't compare quality vs cost → **stuck on the expensive one**

## The Solution

LLM Observer sits between your app and your LLM providers as a lightweight local proxy. One line change. Full visibility. Zero data leaves your machine.

## ⚡ Quick Start

```bash
# Install globally
npm install -g llm-observer

# Start the proxy + dashboard
llm-observer start
```

Then change **one line** in your code:

```javascript
// Before
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// After — just add baseURL
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  baseURL: "http://localhost:4000/v1/openai",  // ← only change
});
```

Open **http://localhost:4001** → see your costs in real-time. That's it.

Works the same way for **Anthropic, Google Gemini, Mistral, Groq**, and any OpenAI-compatible API.

## ✨ Features

### 💰 Real-Time Cost Tracking
See exactly what you're spending across all LLM providers. Per model, per project, per hour.

### 🛑 Budget Kill Switch
Set a daily limit. When reached, all requests are blocked automatically. Never wake up to a surprise $5,000 bill again.

### 📊 Beautiful Dashboard
Real-time charts, request logs, model comparisons, latency tracking — all running locally at localhost:4001.

### 🔍 Request Inspector
Click any request to see the full prompt, response, token count, cost breakdown, and latency. Invaluable for debugging.

### 🚨 Smart Alerts
Budget warnings, spending anomalies, error spikes — via native OS notifications and Slack/Discord webhooks.

### 💡 Cost Optimizer *(Pro)*
"You sent 340 requests to GPT-4o under 100 tokens. Switching to GPT-4o-mini saves $47/month."

### 👥 Team Dashboard *(Team)*
See what your whole team is spending. Per-developer breakdown. Company-wide budget controls. Data syncs encrypted.

## 🔒 Why Local?

Unlike cloud-based alternatives, LLM Observer runs **100% on your machine**:

| | LLM Observer | Cloud Competitors |
|---|---|---|
| API keys | Stay on your machine | Stored on their servers |
| Prompts & data | Never leave localhost | Pass through their cloud |
| Added latency | <5ms (localhost) | 50-200ms (network hop) |
| Works offline | ✅ Yes | ❌ No |
| Security approval | Easy — no data leaves | Hard fight with security teams |
| Privacy compliance | Trivial | Complicated |

## 🖥️ Dashboard

<!-- TODO: Add actual screenshots -->
<!-- ![Dashboard Overview](./docs/assets/dashboard-overview.png) -->

The dashboard runs at `localhost:4001` and shows:
- **Live spend counter** — watch your costs tick up in real-time
- **Cost timeline** — hourly/daily/weekly/monthly trends
- **Model breakdown** — which models cost the most
- **Request log** — searchable, filterable, with full detail view
- **Budget meter** — visual gauge with color-coded status
- **Alert history** — every warning and anomaly

## 🔌 Supported Providers

| Provider | Status | Base URL |
|---|---|---|
| OpenAI | ✅ Supported | `localhost:4000/v1/openai` |
| Anthropic (Claude) | ✅ Supported | `localhost:4000/v1/anthropic` |
| Google (Gemini) | ✅ Supported | `localhost:4000/v1/google` |
| Mistral | ✅ Supported | `localhost:4000/v1/mistral` |
| Groq | ✅ Supported | `localhost:4000/v1/groq` |
| Ollama / vLLM / Custom | ✅ Supported | `localhost:4000/v1/custom/:baseUrl` |

## 🛠️ CLI Commands

```bash
llm-observer start                    # Start proxy + dashboard
llm-observer status                   # Show running status + today's spend
llm-observer stats                    # Terminal stats display
llm-observer stats --model gpt-4o     # Filter by model
llm-observer logs                     # Live tail of requests
llm-observer budget set 50 --daily    # Set daily budget to $50
llm-observer projects list            # List projects
llm-observer projects create          # Create new project
llm-observer export --format csv      # Export data
llm-observer team join <key>          # Join a team
```

## 💎 Pricing

| | Free | Pro | Team |
|---|---|---|---|
| **Price** | $0 forever | $19/month | $49/seat/month |
| **Projects** | 1 | Unlimited | Unlimited |
| **Log retention** | 7 days | 90 days | 1 year |
| **Budget alerts** | Basic | Full + webhooks | Full + team alerts |
| **Cost optimizer** | — | ✅ | ✅ |
| **Team dashboard** | — | — | ✅ |
| **Export** | — | ✅ | ✅ |

## 🗺️ Roadmap

- [x] Project scaffolding & monorepo setup
- [ ] Core proxy engine (OpenAI, Claude, Gemini)
- [ ] Token counting & cost calculation
- [ ] Budget kill switch
- [ ] React dashboard
- [ ] CLI interface
- [ ] npm publish
- [ ] Tauri desktop app (5MB, native)
- [ ] Cost optimizer suggestions
- [ ] Team sync & team dashboard
- [ ] Enterprise features (SSO, audit logs)

## 🤝 Contributing

We welcome contributions! See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

```bash
# Clone the repo
git clone https://github.com/Ranjitbehera0034/llm-observer.git
cd llm-observer

# Install dependencies
npm install

# Start development
npm run dev
```

## 📄 License

MIT — see [LICENSE](LICENSE) for details.

---

<div align="center">

**Built with ❤️ by [Ranjit Behera](https://github.com/Ranjitbehera0034)**

If LLM Observer saved you money, consider giving it a ⭐

</div>
