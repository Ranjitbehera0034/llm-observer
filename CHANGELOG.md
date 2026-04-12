# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.14.0] - 2026-04-11 (7-Tool Parser Parity)
### Added
- **GitHub Copilot parser** — Auto-detect and parse Copilot chat sessions from VS Code's extension storage. Token counts estimated from content length. Cost shown as API-equivalent for subscription value assessment.
- **Windsurf parser** — Full session tracking with exact token counts, cache metrics (read + create), and tool call extraction.
- **Cline / Roo Code parser** — Per-task session tracking from all three extension variants (claude-dev, roo-cline, roo-code). Full token counts, cache metrics, and tool call data per API request.
- **OpenAI Codex CLI parser** — JSONL session parsing with token counts, model tracking, and tool call extraction.
- Safe SQLite read-only access with `SQLITE_BUSY` concurrency fallback (copy-and-read).
- "Estimated" indicator (~) for sessions without direct token counts.
- 5 new app aliases for network monitor recognition.
- Settings → Session Sources now fully displays all 7 integrated auto-detected sources securely.

### Changed
- Session parser scans expanded dramatically accommodating new directories and extensions globally.
- Global spend aggregation properly unifies interactive and agentic tokens.
## [1.13.0] - 2026-04-05 (Rate Limit Tracking & Activity Heatmap)
### Added
- **Rate Limit Tracking Engine**: Active background poller using OS Keychain (macOS `security`, Linux `secret-tool`) to directly fetch Claude tokens and poll Anthropic API safely without storing credentials.
- **Provider Activity Monitor**: Estimates consumption tracking for providers like Cursor, OpenAI, and Aider where token fetching is not authorized.
- **Deduplication Engine**: Limits tracking utilizing a 2% database tolerance threshold to prevent excessive snapshot bloating.
- **Dashboard Heatmap**: Visualizes AI cost and sessions across a 24h-7d intensity matrix, empowering workload optimization.
- **Limits Page**: Primary dashboard center displaying current quotas, 24-hr utilization trend charts, and real-time live-updating countdown timers.
- **Alert Integrations**: Native notification bell tracking for approaching caps: `Warning` (custom threshold), `Critical` (95%), `Exceeded` (100%).
- **Optimization Updates**: Included RL1 (approaching rate limitations) and W2 (off-peak workload routing algorithms dependent on heatmap peaks) into the cost-optimizer loop.

## [1.12.0] - 2026-04-02

### Added
- **Optimization Engine v2** — 20+ rules analyze your AI usage patterns and
  produce specific, actionable recommendations with estimated dollar savings.
- Optimization score (0-100) showing how well-optimized your usage is
- Five rule categories: model selection (4 rules), context efficiency (5),
  provider optimization (3), workflow efficiency (4), agent optimization (4)
- Per-recommendation config snippets (copy-pasteable IDE settings)
- Category and impact level filtering on the Optimize page
- Savings-per-category breakdown chart
- Optimization result caching (1-hour TTL, invalidated on new data)
- Optimization score badge on Overview page
- Optimization insights in AI Wrapped monthly reports
- Tip indicators on Sessions page for sessions that trigger rules

### Changed
- Redundant pattern detection (from v1.10.0) consolidated into the
  optimization engine as rule C3
- Subscription value insight (from v1.8.0) consolidated as rule P2

### Breaking changes
- None


## [1.11.0] - 2026-03-30 (ROI Analysis & Forecasting)
### Added
- **ROI Analysis**: Git correlation to link AI sessions to git commits.
- **Spend Forecasting**: Predictive models to forecast API spend.
- **Migration Calculator**: Compare costs for migrating workflows to cheaper models.

## [1.10.0] - 2026-03-29 (Subagent Observability)
### Added
- **Subagent Observability**: New repository and migrations for tracking child process activity.
- **Improved Parsing**: Granular file tracking and cost consistency checks in the Claude code parser.
- **Dashboard Polish**: Refined empty states and integrated agent activity metrics in Overview and Wrapped pages.
- **New Components**: `AgentTree` for visualizing complex task hierarchies.
- **Automated Tool Tracking**: Aggregator for monitoring tool usage across sessions.

### Changed
- Standardized dashboard page naming: `SyncPage` -> `Sync`, `SessionsPage` -> `Sessions`.
- Consolidated tool usage logic into a dedicated service.

## [1.9.0] - 2026-03-29 (Session Explorer)
### Added
- **Session Explorer**: New dashboard page for granular conversation tracking.
- **Engine 4 (Parser)**: Zero-config tracking for Claude Code, Cursor, and Aider.
- **Automated Detection**: Background scanning of local session files (~/.claude, ~/.aider, etc).
- **Incremental Sync**: High-performance history scanning with modification tracking.
- **Billing Integration**: Verification of local token counts against Usage API data.

### Fixed
- Dashboard module resolution error for the Sessions page.
- impure React keys in list rendering.


## [1.8.0] - 2026-03-28 (Sprint 1)
### Added
- **AI Wrapped**: Monthly/Yearly spending reports and efficiency insights.
- **Shareable Cards**: SVG card generation with privacy controls.
- **Test Suite**: Comprehensive tests for Proxy, Database, and CLI (35+ tests).
- **CI/CD**: GitHub Actions workflow for automated testing and builds.
- **CONTRIBUTING.md**: Developer setup and architecture guide.

### Fixed
- **Streaming SSE**: Fixed buffering issues in proxy for `text/event-stream` responses.
- **Privacy**: Automatic redaction of sensitive identifiers in shareable cards.

### Removed
- Placeholder payment links for Pro features (moved to Sprint 6).

## [1.7.0] - 2026-03-20
### Added
- Budget Guard V2 with safety buffers and estimation multipliers.
- Per-project budget limits.

## [1.6.0] - 2026-03-10
### Added
- Network Monitor: OS-level app detection and connection tracking.

## [1.5.0] - 2026-02-28
### Added
- Multi-provider support (Mistral, Groq, Google).

## [1.0.0] - 2026-01-01
### Added
- Initial release: Proxy-based cost tracking for OpenAI/Anthropic.
