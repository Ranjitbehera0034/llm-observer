# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [2.0.0] - 2026-07-18

**Upgrading from 1.14.0 is safe and automatic.** There are no breaking changes:
`npm install -g llm-observer@latest` (or download the new desktop build), then run
it as usual — the local SQLite schema migrates itself in place on next start (two
new migrations, both additive: a `model_pricing` uniqueness fix and the new
`response_drift_baselines` table), your existing sessions and settings are
untouched, and `PROXY_PORT`/`DASHBOARD_PORT` env vars still work alongside the
newer `LLM_OBSERVER_*` names. No manual migration step, no re-auth, no config
changes required to keep using what you already had.

### Added
- **PII redaction** (opt-in, off by default) — regex + Luhn-validated detection for
  email, phone, SSN, credit card, AWS keys, and API tokens on proxied traffic
- **Response drift detection** (opt-in) — flags when a project's responses start
  statistically diverging from their own historical baseline
- **A/B comparison** (new **Compare** dashboard page) — statistically honest
  comparison (two-sample/two-proportion z-tests) between models, projects, or time
  windows, built from data you already have
- **Reasoning-chain debugger** — step-by-step tool-call reconstruction for any
  request in Request Detail, for both Anthropic- and OpenAI-shaped payloads
- **Ollama as a first-class provider** — local models route through the proxy and
  are always tracked at $0 cost, no API key required
- **AI Analyst** (opt-in, bring-your-own-key) — Claude-generated plain-English
  spend summary and recommendations, built only from aggregated metadata; your
  prompts and responses are never sent
- **Real ROI / plan-value** — the Health Score now shows an actual "×your $19/mo
  plan cost" multiple instead of a placeholder
- **Team auth backend** (Phase 1 of SSO, on `team-server`) — password + OIDC
  login and team membership; API-only in this release, no dashboard UI yet
- `scripts/verify-costs.js` — an independent script anyone can run to recompute
  their own token counts/cost straight from raw session files and diff against
  what the app stored, without trusting the app's own code to grade itself
- `parser-format-drift` CI job — recorded fixtures of real Claude Code JSONL
  formats (current and legacy), checked against a golden manifest on every push,
  so an upstream editor format change is caught before it ships as a $0 session
- Signed release infrastructure: `CHECKSUMS.txt` attached to every npm release;
  a real Tauri updater signing keypair is now generated and stored (see
  `packages/desktop/SIGNING.md`), so `release.yml` produces desktop builds
  the in-app auto-updater can actually verify
- A proper post-payment `/thanks` page on the landing site for the Razorpay
  checkout callback
- **Update notifications** — the CLI now checks the public npm registry in the
  background and prints a short heads-up when a newer version is published, so
  a global-install user actually discovers releases like this one instead of
  silently staying on 1.14.0 forever. Opt out with `NO_UPDATE_NOTIFIER=1` or
  `--no-update-notifier`; auto-skipped in CI. Sends nothing but the package
  name — no telemetry, no usage data.

### Changed
- Refreshed pricing across every supported provider (Anthropic, OpenAI, Google,
  xAI, DeepSeek, Mistral) and added two new providers (Zhipu GLM, Moonshot Kimi)
- Rewrote `README.md`, `packages/cli/README.md` (the npm registry page), and
  `CONTRIBUTING.md` to match actual current behavior — corrected the CLI command
  reference, the dashboard page list, and the repo structure

### Fixed
- **Claude Code parser was reading usage from a legacy top-level field shape only**
  — the current Claude Code log format nests it under `message`, so real sessions
  were silently showing $0. This was the most impactful fix in this release.
- `publish.yml`'s npm auth token was wrapped in escaped `\$\{\{ \}\}` and would
  never have resolved to the real secret
- India pricing in `packages/cli/README.md` (₹1,499) didn't match what checkout
  actually charges (₹1,599)
- `packages/desktop/src-tauri/tauri.conf.json`'s version was stuck at `1.0.0`
  while the rest of the monorepo had moved on, which would have mistagged
  automated desktop releases
- `release.yml`'s Ubuntu build installed `libwebkit2gtk-4.0-dev` (Tauri v1's
  dependency, bundles libsoup2) instead of `libwebkit2gtk-4.1-dev` (Tauri v2's,
  bundles libsoup3) — this app is on Tauri v2, so the Linux desktop build had
  likely never actually succeeded
- The desktop app's proxy "sidecar" was never actually buildable in CI: the
  build script tried to snapshot the whole server (including better-sqlite3's
  native binding) into a single file via `pkg`, whose embedded Node runtime
  is capped at Node 18 and which doesn't reliably bundle native modules at
  all — it silently baked in a reference to the build machine's absolute
  filesystem path instead. A macOS ARM64 sidecar had been built locally once
  and committed directly to git as a 69MB binary to paper over this, which
  meant real desktop builds were silently running whatever proxy code
  existed back then, missing everything since. Rewrote
  `packages/proxy/scripts/build-sidecar.js` to bundle the real Node binary
  that built it (guaranteed ABI match, no cross-version packaging) alongside
  the built server and exactly the runtime dependencies actually
  required — traced by really booting the server rather than a
  hand-maintained list — removed the stale committed binaries, and wired the
  build into `release.yml` for all three platforms
- `packages/proxy` and `packages/cli`'s build scripts used POSIX-only shell
  syntax (`mkdir -p`, `cp -r`, `2>/dev/null`), which fails outright on
  Windows ("The syntax of the command is incorrect") — surfaced when the
  v2.0.0 Windows desktop build failed with a missing `dist/migrations`.
  Replaced both with small cross-platform Node scripts
  (`scripts/postbuild.js`) using `fs.cpSync`, no shell involved
- `publish.yml` ran `npm run build --workspaces --if-present`, which has no
  dependency ordering — `packages/cli`'s build copies
  `packages/proxy/dist/server.js`, so it needs proxy built first. This
  failed the actual v2.0.0 npm publish (`llm-observer` build ran before
  `proxy`'s, ENOENT on the copy). Switched to the already-correctly-ordered
  `npm run build:ci`, and added a `workflow_dispatch` trigger so this
  workflow can be re-run against an already-published release without
  cutting a new one

### Removed
- The dead, pre-restructure `apps/tauri/` duplicate of the desktop app (including
  a 74MB compiled binary that shouldn't have been committed) — `packages/desktop`
  is the only Tauri app in this repo now
- `desktop-release.yml`, a broken CI workflow pointing at the removed path above

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
