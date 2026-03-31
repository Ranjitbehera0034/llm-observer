<p align="center">
  <img src="docs/logo.svg" alt="LLM Observer" width="120" />
  <br />
  <strong>LLM Observer</strong>
  <br />
  <em>Your AI spend. Your control.</em>
</p>

<p align="center">
  <a href="https://github.com/Ranjitbehera0034/llm-observer/blob/main/LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="License: MIT" /></a>
  <a href="https://www.npmjs.com/package/llm-observer"><img src="https://img.shields.io/npm/v/llm-observer" alt="npm version" /></a>
  <a href="https://github.com/Ranjitbehera0034/llm-observer/commits"><img src="https://img.shields.io/github/last-commit/Ranjitbehera0034/llm-observer" alt="Last Commit" /></a>
  <a href="https://github.com/Ranjitbehera0034/llm-observer/stargazers"><img src="https://img.shields.io/github/stars/Ranjitbehera0034/llm-observer" alt="GitHub Stars" /></a>
</p>

<p align="center">
  Free, open-source, local-first AI cost tracking and observability.<br />
  See every dollar across Claude Code, Cursor, Aider, and more — without changing how you work.
</p>

<p align="center">
  <a href="#quickstart">Quickstart</a> · <a href="#features">Features</a> · <a href="#how-it-works">How It Works</a> · <a href="#configuration">Configuration</a> · <a href="#roadmap">Roadmap</a> · <a href="#contributing">Contributing</a>
</p>

---

<!-- Replace with actual screenshot paths from your docs/ folder -->
<p align="center">
  <img src="docs/screenshot-overview.png" alt="LLM Observer Overview Dashboard" width="800" />
</p>

<details>
<summary>More Screenshots</summary>

| | |
|---|---|
| ![Sessions](docs/screenshot-sessions.png) | ![Agents](docs/screenshot-agents.png) |
| ![Tools](docs/screenshot-tools.png) | ![Wrapped](docs/screenshot-wrapped.png) |

</details>

---

## Quickstart

**Prerequisites:** Node.js 18+ (`node --version` to check)

### Option 1 — npm (recommended)

```bash
npm install -g llm-observer
llm-observer
```

### Option 2 — Run from source

```bash
git clone https://github.com/Ranjitbehera0034/llm-observer.git
cd llm-observer
npm install
npm run build
npm start
```

Dashboard opens at **http://localhost:8089**. That's it.

On first launch, LLM Observer automatically detects your installed AI tools, parses your session history, and shows a populated dashboard — **no API keys, no proxy setup, no account required.**

> **Want billing-accurate costs?** Add your provider Admin API keys in the dashboard (Sync page). See [Add Provider Keys](#add-provider-keys) below.

---

## Features

### Session Tracking (Zero Config)

- **Auto-Detection** — Automatically finds Claude Code, Cursor, and Aider data on your machine
- **Session Explorer** — Browse every AI conversation with cost, duration, tokens, model, and project
- **Incremental Parsing** — Only new/modified files are re-parsed on startup (fast after first run)
- **Session Type Labels** — Automatically classifies sessions as "interactive" or "agentic"

### Subagent Observability

- **Agent Tree View** — See every subagent Claude Code spawns — cost, tools used, duration per agent
- **Agent Classification** — Auto-labels agents as Explore, Plan, Execute, Validate, or General
- **Agent KPIs** — Total agents spawned, cost breakdown by type, most expensive agents
- **Closed Feature Gap** — Anthropic declined requests #10164 and #10388 for this; LLM Observer provides it

### Tool Usage Analytics

- **Cost by Operation** — See which operations (Read, Write, Bash, Search) consume the most tokens
- **Tool Frequency** — Which tools your AI calls most and their cost attribution
- **Redundant Detection** — Flags waste like reading the same file 100+ times across sessions

### ROI Analysis & Forecasting

- **Git Correlation** — Link AI sessions directly to git commits to measure true return on investment
- **Spend Forecasting** — Predictive models forecast your API spend for the rest of the billing cycle
- **Migration Calculator** — Instantly compare costs for migrating workflows to cheaper models

### Provider API Sync

- **Billing-Accurate Costs** — Pull real spend from Anthropic and OpenAI admin APIs (matches your invoice)
- **Automatic Polling** — Syncs every 60 seconds in the background
- **Multi-Provider** — Single dashboard for Anthropic + OpenAI with aggregated totals

### Budget Control

- **Per-Provider / Per-Model Budgets** — Set daily, weekly, or monthly limits
- **Three-Threshold Alerts** — Notifications at 80%, 90%, and 100% of budget
- **Kill Switch** — Optionally hard-block proxy requests when a budget is exceeded
- **Pre-Estimation** — Estimates request cost *before* sending to prevent overshoot
- **Desktop Notifications** — Native OS alerts, not just in-dashboard (macOS, Linux, Windows)

### AI Wrapped

- **Monthly & Yearly Reports** — Complete spending analysis with trends and comparisons
- **Shareable Cards** — Download visual cards (1200×630px) optimized for Twitter/LinkedIn
- **Four Insight Algorithms** — Model optimization, cache efficiency, subscription value, budget compliance
- **Privacy Toggles** — Control which stats appear on the card before sharing

### Network Monitor

- **Per-App Attribution** — See which app (Cursor, Claude Code, scripts) drives your cost
- **Zero Setup for Apps** — Uses OS-level connection detection (`lsof` / `ss`), no per-app config
- **Subscription Insight** — Estimates API-equivalent cost for subscription tools like Cursor Pro

### Unified Dashboard

- **Complete Budget View** — API spend (tracked) + subscriptions (manual) in one total
- **Deduplication** — Sync data wins over proxy data; never double-counts
- **Subscription Presets** — One-click add for Cursor Pro, Copilot, ChatGPT Plus, Claude Pro, and more

### Local Proxy (Optional)

- **Per-Request Detail** — Full prompt, response, and latency for proxied traffic
- **Budget Enforcement** — Kill switch blocks requests when limits are hit
- **Provider Error Forwarding** — 402/429 errors passed through with `_source` field

---

## How It Works

LLM Observer has four independent data engines. Use any combination:

```
Engine 1: Session Parser                Engine 2: Usage API Sync
Reads local files from                  Polls Anthropic & OpenAI admin APIs
~/.claude/, ~/.cursor/, ~/.aider/       for billing-accurate spend data
Setup: None (auto-detects)              Setup: Add admin API key (30 sec)
Gives: Per-session detail               Gives: Exact cost matching invoice

Engine 3: Network Monitor               Engine 4: Local Proxy
Detects which apps connect              Intercepts requests for full
to AI API endpoints                     prompt/response capture
Setup: Enable in Settings               Setup: Route traffic through proxy
Gives: Per-app attribution              Gives: Per-request detail + kill switch
```

**All data stays local.** SQLite database on your machine. No cloud. No telemetry. No account.

**Data priority:** When multiple engines report cost for the same provider, Usage API sync (billing-accurate) takes precedence. Session parser provides per-session breakdown. They complement each other.

---

## Add Provider Keys

Session parsing estimates costs from token counts (~95% accurate). For exact billing data:

### Anthropic

1. Go to [console.anthropic.com](https://console.anthropic.com) → Settings → Admin API Keys
2. Create a key (starts with `sk-ant-admin-`)
3. Dashboard → Sync page → Anthropic card → paste key

### OpenAI

1. Go to [platform.openai.com/settings/organization/admin-keys](https://platform.openai.com/settings/organization/admin-keys)
2. Create a key (requires Organization Owner role, starts with `sk-admin-`)
3. Dashboard → Sync page → OpenAI card → paste key

Keys are encrypted with AES-256-GCM locally. Never logged, never sent anywhere.

---

## Dashboard Pages

| Page | What It Shows |
|------|---------------|
| **Overview** | Total spend, daily trends, provider breakdown, budget status, most expensive sessions |
| **Sessions** | Every AI session — sortable by cost, filterable by provider/model/project/type |
| **Agents** | Subagent tree views, agent type breakdown, per-agent cost KPIs |
| **Tools** | Cost by operation, tool frequency chart, redundant pattern detection |
| **Apps** | Per-application cost attribution (requires network monitor) |
| **Sync** | Provider API key management and sync status |
| **Wrapped** | Monthly/yearly reports with insights and shareable cards |
| **Settings** | Session sources, per-app tracking toggle, budget management |

---

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `LLM_OBSERVER_PORT` | `8089` | Dashboard and API port |
| `LLM_OBSERVER_HOST` | `127.0.0.1` | Bind address |
| `LLM_OBSERVER_DATA_DIR` | `~/.llm-observer` | Database and config location |
| `LLM_OBSERVER_PROXY_PORT` | `8090` | Proxy port (when enabled) |

### CLI

```bash
llm-observer                    # Start dashboard
llm-observer --port 3000        # Custom port
llm-observer --no-browser       # Don't auto-open browser
llm-observer proxy              # Start proxy mode
llm-observer status             # Show tracking status
```

### Auto-Detected Session Files

| Tool | Location | Format |
|------|----------|--------|
| Claude Code | `~/.claude/projects/` | JSONL |
| Cursor IDE | `~/.cursor/ai-tracking/ai-code-tracking.db` | SQLite |
| Aider | `~/.aider/analytics.jsonl` | JSONL |

All files are read in **read-only mode**. LLM Observer never modifies any AI tool's data.

---

## What LLM Observer Does NOT Do

- **Does not store your prompts or responses** — Database contains token counts, costs, and metadata only
- **Does not intercept traffic by default** — Proxy is optional and off by default
- **Does not send data anywhere** — No telemetry, no cloud, no analytics
- **Does not require root privileges** — Runs as your user account
- **Does not modify AI tool behavior** — Unless you explicitly enable proxy with kill switch

---

## Tech Stack

- **Runtime**: Node.js 22 + Express
- **Database**: SQLite (`better-sqlite3`)
- **Frontend**: React 18 + Vite + Tailwind CSS
- **Language**: TypeScript (full stack)
- **Desktop** *(coming)*: Tauri
- **Monorepo**: npm workspaces

```
llm-observer/
├── packages/
│   ├── cli/           # CLI entry point
│   ├── proxy/         # API server + parsers + sync engine
│   ├── database/      # Schema, migrations, repositories
│   └── dashboard/     # React frontend
└── apps/
    └── tauri/         # Desktop app (v2.0.0)
```

---

## Development

```bash
git clone https://github.com/Ranjitbehera0034/llm-observer.git
cd llm-observer
npm install
npm run build
npm run dev          # Dev mode with hot reload
npm test             # Run all tests
```

---

## Comparison

| Capability | LLM Observer | BurnRate | Helicone | Langfuse |
|:-----------|:---:|:---:|:---:|:---:|
| Zero-config session parsing | ✅ | ✅ | ❌ | ❌ |
| Billing-accurate costs (API sync) | ✅ | ❌ | ❌ | ❌ |
| Budget enforcement (kill switch) | ✅ | ❌ | ❌ | ❌ |
| Network-level app detection | ✅ | ❌ | ❌ | ❌ |
| Subagent observability | ✅ | ✅ | ❌ | ❌ |
| Tool usage analytics | ✅ | ✅ | ❌ | ❌ |
| Fully open source | ✅ | ❌ | Partial | ✅ |
| 100% local (no cloud) | ✅ | ✅ | ❌ | Self-host |
| No code changes required | ✅ | ✅ | ❌ | ❌ |
| Shareable spending reports | ✅ | Basic | ❌ | ❌ |

---

## Roadmap

### Shipped

| Version | Feature |
|---------|---------|
| v1.1.0 | Anthropic Usage API sync |
| v1.2.0 | OpenAI Usage API sync |
| v1.3.0 | Unified dashboard + subscription tracking |
| v1.4.0 | Per-provider budgets + alerts + notifications |
| v1.5.0 | Network monitor (per-app attribution) |
| v1.7.0 | Budget Guard v2 (pre-estimation) |
| v1.8.0 | AI Wrapped (monthly/yearly reports) |
| v1.9.0 | Session file parser + session explorer |
| v1.10.0 | Subagent observability + tool analytics |
| v1.11.0 | ROI analysis (git correlation) + spend forecasting |

### Coming Next

| Version | Feature |
|---------|---------|
| v1.12.0 | Optimization engine (20+ rules) |
| v1.13.0 | Rate limit tracking + activity heatmap |
| v1.14.0 | Team dashboard + per-developer tracking |
| v2.0.0 | Desktop app (Tauri) + Homebrew + 7-tool parsers |
| v2.1.0 | Enterprise (SSO, audit logging, cost allocation) |
| v2.2.0 | Agent platform (per-customer attribution, guardrails) |

---

## FAQ

<details>
<summary><strong>Does it slow down my AI tools?</strong></summary>
<br />
No. The session parser reads files that already exist — it doesn't intercept traffic. The API sync polls every 60 seconds in the background. Neither adds latency.
</details>

<details>
<summary><strong>Do I need to change how I use my tools?</strong></summary>
<br />
No. LLM Observer reads data your tools already produce. No SDK, no config changes, no base URL changes (unless using the optional proxy).
</details>

<details>
<summary><strong>How accurate are cost estimates?</strong></summary>
<br />
Session-estimated costs are within ~5% of actual billing. For exact numbers, add your Admin API key — the Usage API sync matches your invoice.
</details>

<details>
<summary><strong>Is my data safe?</strong></summary>
<br />
Everything stays in a local SQLite database. No cloud, no telemetry, no account. Admin keys are AES-256-GCM encrypted. The database stores costs and metadata — never prompts or responses.
</details>

<details>
<summary><strong>Can I use this at work?</strong></summary>
<br />
Yes. Everything runs locally with no data leaving your machine. Team features with shared dashboards are coming in v1.14.0.
</details>

<details>
<summary><strong>What if Claude Code changes its file format?</strong></summary>
<br />
The parser handles format variations gracefully — malformed files are skipped, other sessions load normally. Patches are published quickly when format changes are detected.
</details>

---

## Contributing

Contributions welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

**Help needed with:**
- Session file parsers (Windsurf, Cline, Codex, Copilot)
- Optimization rules
- Dashboard UI improvements
- Test coverage

---

## License

[MIT](LICENSE)

---

<p align="center">
  Every feature answers at least one of:<br />
  <strong>How much am I spending?</strong> · <strong>Can I stop overspending?</strong> · <strong>Where can I spend less?</strong> · <strong>Is it worth it?</strong>
</p>