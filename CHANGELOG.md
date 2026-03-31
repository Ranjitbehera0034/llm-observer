# Changelog

All notable changes to LLM Observer are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

### In Progress
- Optimization engine v2 with 20+ rules (v1.12.0)

---

## [1.11.0] - 2026-03-30

### Added
- **ROI analysis** — Correlate AI sessions with git commits to measure
  cost per commit, lines per dollar, and an efficiency score (0-100).
  Per-project ROI comparison reveals which codebases get the best return.
- **Spend forecasting** — Projected monthly spend based on weekday/weekend
  patterns, with best/worst/current-pace scenarios. Outlier days excluded
  for accurate projections.
- **Migration calculator** — "What if" analysis showing cost impact of
  switching models or providers. Includes quality warnings for aggressive
  downgrades.
- Git repository auto-detection from project paths in sessions table
- Configurable correlation window (5, 15, 30, 60 minutes) for ROI precision
- Forecast accuracy tracking (compare predictions vs actual spend over time)
- Per-project ROI comparison table with efficiency scoring
- Scenario analysis: current pace, best case, worst case, trend-adjusted
- Per-provider spend projections (Anthropic and OpenAI independently)
- Model equivalency mapping for cross-provider migration calculations
- Four migration scenarios: model switch, provider migration, plan comparison,
  task-type downgrade
- Quality warnings on aggressive model downgrades
- Forecast card on Overview page with sparkline projection
- ROI and forecast insights in AI Wrapped monthly reports
- Author emails stored as SHA-256 hashes (never plaintext)
- Commit messages are NOT stored in the database (privacy by design)

### Changed
- Overview page includes spend forecast card and efficiency score badge
- AI Wrapped includes ROI metrics and migration suggestions

---

## [1.10.0] - 2026-03-29

### Added
- **Subagent observability** — See every subagent Claude Code spawns,
  what it costs, what tools it uses, and how long it runs. Visual tree
  view in the session detail expansion.
- **Agent type classification** — Automatic labeling of subagents as
  Explore, Plan, Execute, Validate, or General based on behavior patterns.
- **Tool usage analytics** — See which operations (Read, Write, Bash,
  Search) consume the most tokens and cost the most money.
- **Redundant pattern detection** — Automatic detection of wasteful
  patterns like reading the same file 100+ times or running the same
  test command repeatedly.
- New "Agents" dashboard page with KPI cards, type breakdown, and
  most expensive agents table
- New "Tools" dashboard page with cost by operation chart, tool
  frequency analysis, and redundant pattern cards
- Agent activity mini-card on Overview page
- Agent and tool insights in AI Wrapped monthly reports
- Pre-aggregated tool_usage_daily table for fast dashboard loading
- Subagent parsing integrated with parsed_files_registry for incremental updates
- Consistency validation between parent session cost and subagent cost totals

### Changed
- Session detail expansion now shows agent tree for agentic sessions
- Sessions table includes parent_cost and total_subagent_cost columns

---

## [1.9.0] - 2026-03-29

### Added
- **Session file parser (Engine 4)** — Zero-config parsing of local AI session
  files. Automatically detects Claude Code, Cursor, and Aider installations.
- **Session explorer** — Browse every AI session with full metadata: tokens,
  cost, duration, tools used, project, and model. Sort by cost to find your
  most expensive sessions instantly.
- Auto-detection of installed AI tools on startup
- Incremental parsing via file registry (only new/modified files after first run)
- Session type classification (interactive vs agentic)
- Tool call breakdown per session
- Cache hit rate per session
- Progress indicators during initial parse for large histories
- Cross-referencing with Usage API sync for billing-verified costs
- "Most expensive sessions" widget on Overview page
- Session-level insights in AI Wrapped reports
- Settings page shows detected session sources with status
- Cursor 5-minute proximity grouping for session reconstruction
- Privacy mandate: prompts and responses are never stored in the database

### Changed
- AI Wrapped now includes session-level insights (most expensive session,
  average session cost, agentic vs interactive ratio)

---

## [1.8.0] - 2026-03-28

### Added
- **AI Wrapped** — Monthly and yearly AI spending reports with insights
- Shareable visual card (1200×630px) optimized for Twitter/LinkedIn
- Four insight algorithms: model optimization opportunities, cache efficiency,
  subscription value assessment, budget compliance review
- Per-app breakdown in reports (when network monitor is enabled)
- Period selector for browsing historical reports
- Card privacy controls (toggle individual stats on/off before sharing)
- Report caching for fast repeated access
- Day-of-week spending pattern analysis
- Month-over-month comparison

### Changed
- Navigation adds "Wrapped" page

---

## [1.7.0] - 2026-03-26

### Added
- **Pre-estimation** — Budget guard estimates request cost before sending to
  the provider. Expensive requests blocked before money is spent.
- **Safety buffer** — Configurable cushion ($0.05 default) prevents overshoot
  by blocking requests before the exact limit is reached
- Three estimation presets: Conservative, Balanced, Aggressive
- Enhanced 429 responses with detailed breakdown (estimated cost, remaining
  budget, suggested actions)
- Soft warning response headers (X-Budget-Warning) for near-budget requests
- Buffer zone visualization on budget progress bars

### Changed
- Budget guard runs three layers: existing spend check, buffer check,
  and pre-estimation (cheapest first for performance)
- Pre-estimation only activates above 60% budget utilization

### Fixed
- Budget overshoot when a request passes at $9.99 but costs $0.50+

---

## [1.6.0] - 2026-03-26

### Added
- Custom feature implementation

---

## [1.5.0] - 2026-03-24

### Added
- **Per-app AI spend attribution** — See which applications (Cursor, Claude Code,
  VS Code, scripts) are driving your AI costs. No IDE changes needed.
- Network monitor that passively detects connections to AI API endpoints
- Proportional cost attribution based on connection frequency
- Subscription-mode detection for tools using their own API keys
- New "Apps" page in the dashboard with breakdown chart and detail views
- Custom app naming (rename "node" to "My Batch Script")
- "Top apps today" summary on the Overview page
- Network Status diagnostic panel
- Pre-populated aliases for 12+ common AI development tools

### Changed
- Overview page includes a "Top apps" mini-panel when network monitor is enabled

---

## [1.4.0] - 2026-03-24

### Added
- **Per-provider and per-model budgets** — Set daily, weekly, or monthly spend
  limits for any provider or specific model
- **Alerts system** — Notifications at 80%, 90%, and 100% of budget thresholds
- **Kill switch** — Optionally hard-block proxy requests when a budget is exceeded
- Alert deduplication (each threshold fires at most once per budget period)
- Budget progress bars on Overview page
- Bell icon with unread alert count in dashboard navigation
- Alert dropdown panel with acknowledge/dismiss controls
- Desktop notifications via native OS notification system
- Daily summary notification (configurable time)
- Slack webhook integration for team alerts
- Budget presets for common configurations

### Changed
- budgetGuard middleware checks both project-level and provider/model budgets

---

## [1.3.1] - 2026-03-24

### Fixed
- Unified Control Room polishing and precise subscription proration

---

## [1.3.0] - 2026-03-24

### Added
- **Unified Overview dashboard** — One page showing your complete AI budget:
  API spend (tracked automatically) + subscriptions (added manually)
- **Manual subscription tracking** — Add Cursor Pro, GitHub Copilot, ChatGPT Plus,
  and other AI subscriptions to see your full monthly AI cost
- Pre-populated subscription templates for 10+ common AI services
- Smart deduplication: sync data takes priority over proxy data for the same provider
- Data source indicators showing where each cost number comes from
- Day-over-day and week-over-week spending comparisons
- First-time setup wizard for new users
- Subscription proration for partial months

### Changed
- Dashboard landing page is now the unified Overview (previously Projects)
- Navigation order updated

---

## [1.2.0] - 2026-03-24

### Added
- **OpenAI Usage API Sync** — Add your OpenAI Admin API key to see all OpenAI
  spending. Same zero-config experience as Anthropic sync.
- Multi-provider aggregated dashboard view — total spend across Anthropic
  and OpenAI in one place
- Provider filter on Sync page
- Automatic cost estimation fallback when OpenAI Costs API is unavailable
- Cross-provider key prefix detection (prevents pasting wrong key type)

### Changed
- Sync API routes return multi-provider aggregated data
- Sync page layout accommodates multiple provider cards
- UsageSyncManager manages multiple pollers independently

---

## [1.1.0] - 2026-03-24

### Added
- **Anthropic Usage API Sync** — Add your Anthropic Admin API key to see
  billing-accurate spend across all your tools automatically
- Admin key encryption (AES-256-GCM, machine-bound)
- Background polling (every 60 seconds)
- Sync dashboard page with provider status cards
- Connection testing and key validation
- Daily cost chart and model breakdown

---

## [1.0.13] - 2026-03-22

### Added
- Provider error forwarding — 402 (payment required) and 429 (rate limited)
  errors from providers are passed through with `_source` field identifying
  the origin

---

## [1.0.12] - 2026-03-22

### Added
- Foundation release
- Database migrations system
- AES-256-GCM encryption for sensitive data
- Comprehensive test suite
- Proxy with request logging
- Budget guard middleware
- Dashboard with Projects and Logs pages

---

[Unreleased]: https://github.com/Ranjitbehera0034/llm-observer/compare/v1.11.0...HEAD
[1.11.0]: https://github.com/Ranjitbehera0034/llm-observer/compare/v1.10.0...v1.11.0
[1.10.0]: https://github.com/Ranjitbehera0034/llm-observer/compare/v1.9.0...v1.10.0
[1.9.0]: https://github.com/Ranjitbehera0034/llm-observer/compare/v1.8.0...v1.9.0
[1.8.0]: https://github.com/Ranjitbehera0034/llm-observer/compare/v1.7.0...v1.8.0
[1.7.0]: https://github.com/Ranjitbehera0034/llm-observer/compare/v1.6.0...v1.7.0
[1.6.0]: https://github.com/Ranjitbehera0034/llm-observer/compare/v1.5.0...v1.6.0
[1.5.0]: https://github.com/Ranjitbehera0034/llm-observer/compare/v1.4.0...v1.5.0
[1.4.0]: https://github.com/Ranjitbehera0034/llm-observer/compare/v1.3.1...v1.4.0
[1.3.1]: https://github.com/Ranjitbehera0034/llm-observer/compare/v1.3.0...v1.3.1
[1.3.0]: https://github.com/Ranjitbehera0034/llm-observer/compare/v1.2.0...v1.3.0
[1.2.0]: https://github.com/Ranjitbehera0034/llm-observer/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/Ranjitbehera0034/llm-observer/compare/v1.0.13...v1.1.0
[1.0.13]: https://github.com/Ranjitbehera0034/llm-observer/compare/v1.0.12...v1.0.13
[1.0.12]: https://github.com/Ranjitbehera0034/llm-observer/releases/tag/v1.0.12