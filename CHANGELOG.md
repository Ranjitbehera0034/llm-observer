# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [2.0.2] - 2026-10-07

**Upgrade now if you installed 2.0.0 or 2.0.1 from npm: `llm-observer start` crashed on a clean install** with
`Cannot find module '@anthropic-ai/sdk'` (it only worked where the package happened to be installed
already). 2.0.2 fixes that and a long list of correctness, privacy and data-safety problems found in an
architecture review. Existing databases upgrade in place; a backup is taken first (see below).

### Fixed - first run and releases
- The npm package now starts on a clean machine. The AI Analyst no longer depends on the Anthropic SDK: it
  calls the Messages API directly, so it also works in the npm CLI, the desktop sidecar and Docker (it
  returned 501 everywhere except a developer checkout before). Retries are not attempted any more; a failed
  call returns one clear error.
- `scripts/smoke-pack.js` packs the CLI, installs it into an empty directory, starts it, checks
  `/health`, the dashboard and the AI Analyst endpoint, and shuts it down; CI and the publish workflow run it.
- Reproducible releases: `package-lock.json` is committed, workflows use `npm ci`, publishing requires green
  tests and typecheck, the tag must equal the package version, `npm` is pinned (OIDC publishing needs 11.x),
  and the publish job restores no cache. `react-is` is now a declared dashboard dependency.
- `llm-observer stop` checks the recorded pid is really this install's server before signalling it, and
  `llm-observer start` now forwards SIGTERM/SIGHUP (docker stop, systemd) instead of orphaning the server.

### Fixed - money
- Provider-scoped budgets (for example "$3/day on OpenAI") never matched because the guard did not know the
  provider. They now do, and the pre-flight estimate prices the right model, counts Anthropic `system` and
  `tools`, Gemini `contents` and OpenAI Responses `input`, and honours `max_tokens` instead of assuming a
  3x output (which caused false 429s at 60% utilisation).
- Admin-API sync no longer inserts a duplicate `usage_records` row on every 60-second poll (SQLite treats
  NULL key columns as distinct); migration 014 collapses existing duplicates, keeping the newest row. The
  pollers also accept the vendors' documented nested response shape, and an unrecognised shape now sets a
  visible sync error instead of silently inserting nothing. Anthropic's cost report now includes today.
- Budget spend read from sync data no longer reads as $0 for most of the day outside UTC.
- Claude parser: models missing from the price table are priced with a family fallback and flagged
  *estimated* instead of silently costing $0; cache reads on models with no cached rate use 0.1x the input
  rate and are flagged; usage is priced per model; agents under `<session>/subagents/` and
  `<session>/subagents/workflows/<id>/` are read and attributed to the parent; re-importing a session returns
  its true id. Migration 015 adds the provenance columns; the Sessions page shows the flag.
- Anomaly detector and rate-limit estimate compared ISO timestamps with SQLite's `datetime()` text, firing
  false critical alerts on most hourly runs; fixed (shared helper), with a per-project alert cooldown and a
  webhook timeout. Optimizer cache entries now expire after an hour, not at UTC midnight.
- The Cursor parser no longer inserts a mock `$0` session (which made the plan-value rule recommend dropping
  Cursor); Aider events get stable ids and are read from the `properties` object upstream actually writes.
- Optimizer: rules need real days and sessions of data before reporting savings; invented constants and the
  hard-coded accuracy string are gone.

### Fixed - security and privacy
- Both ports reject requests whose `Host` is not loopback (421) and cross-site `Origin`s (403), closing DNS
  rebinding and `localhost.evil.com` style bypasses. `LLM_OBSERVER_ALLOWED_HOSTS` / `LLM_OBSERVER_ALLOWED_ORIGINS`
  allow extra names (reverse proxy, LAN bind).
- The Wrapped card SVG reflected an unvalidated `period` (script execution in the dashboard origin); inputs
  are validated and escaped and the response carries a sandboxing CSP.
- Alerts and the live SSE stream no longer copy prompt/response bodies (alerts keep six metadata fields;
  migration 016 rewrites existing rows). Alert metadata and SSE events now carry the real request id.
- A hostname change can no longer downgrade a paying user and trigger deletion: signed (LLMO1) keys skip the
  machine-bound check, and while a licence is unresolved retention deletes nothing.
- The local payment-webhook endpoints were removed: the payment providers cannot reach a loopback server, the
  license server handles the real webhooks, and their body-parser bug had kept a forgeable-key path inert.
- Upgrade backups: written 0600, kept for at most 14 days (newest two), never replaced by a retry of a failed
  upgrade, removed by `llm-observer reset`. They contain a full copy of the database, including any stored
  proxy bodies. `LLM_OBSERVER_SKIP_MIGRATION_BACKUP=1` skips them.

### Fixed - data safety
- Migrations run in a transaction under `BEGIN IMMEDIATE` and take a `VACUUM INTO` backup first; a failed
  migration leaves the schema untouched and the next start retries. A missing migrations directory is an error.
- A `data.db` in the current directory can no longer overwrite your real database, and `--help` no longer
  opens one. The legacy-location copy now includes data still in the WAL.
- SIGTERM/SIGINT flush queued requests and close the database; a busy port exits with an actionable message.
- Retention keeps budget alerts (they are the dedupe rows) and compares timestamps consistently.

### Changed
- Budget days, weeks and months now start at local midnight (previously UTC for provider, model and global
  budgets). After upgrading outside UTC a budget alert for the current period may fire once more.
- The kill switch is described as best effort: spend is written in short batches (about 5 seconds or 10
  requests), so a burst can pass the limit. The UI says so.
- Parsers are labelled verified / experimental / unverified in Settings and the README. Claude Code is tested
  against a scrubbed excerpt of one real log (Claude Code 2.1.291, Linux) plus hand-written fixtures; the
  others have no real recording yet. Admin-API sync is documented as designed to reconcile with your invoice
  but not yet validated against a live account (`docs/RELEASE_CHECKLIST.md`).
- README accuracy claims for session estimates ("~95% accurate", "within ~5%") were removed: they were never
  measured.

### Known limitations
- Subscription tools (Cursor, Copilot, Windsurf) are not captured by the proxy, and the Cursor parser is
  detect-only until its local store is decoded.
- Kill-switch overshoot and the double count after a sync flips to `error` are not fixed; Team features,
  OpenTelemetry (OTLP) ingestion and an adapter contract for new parsers remain on the roadmap.

## [2.0.1] - 2026-10-06

### Security / Privacy
- **Removed Claude credential reading.** The rate-limit poller read Claude
  Code's OAuth token from the OS keychain (`security` / `secret-tool`) or
  `~/.claude/.credentials.json` every 5 minutes and sent it as a Bearer token
  to an undocumented `api.claude.ai` endpoint. That contradicted the
  "nothing leaves your machine" promise and is gone: Anthropic rate-limit
  usage is now always estimated from locally parsed sessions.
  (`packages/proxy/src/rate-limits/credentials.ts` deleted.)
- **Removed IP geolocation.** Opening Settings called `ipapi.co`, sending the
  user's IP to a third party just to choose a payment provider. It now uses
  the browser's time zone, locally.
- README now lists every outbound network request the app can make, when,
  and what is sent.
- **Closed the free-Pro bypass.** Any key starting with `PRO_` used to unlock
  Pro locally without being checked. Keys are now `LLMO1.` keys signed by the
  license server (Ed25519) and verified offline by the app, so they can't be
  forged and keep working when the server is unreachable. `PRO_` dev keys only
  work with `LLM_OBSERVER_DEV_LICENSE=1`. Legacy `PRO_LS_`/`PRO_RZP_` keys are
  verified with the license server.
- **Webhooks fail closed.** The LemonSqueezy and Razorpay webhooks skipped
  signature checks when their secret was unset — and `.env.example` named the
  LemonSqueezy secret differently from the code, so following the docs left it
  unset and anyone could POST a fake payment to get a key. Unsigned requests are
  now rejected; both secret names are accepted.
- **License signing secret mismatch.** `.env.example` documented
  `LICENSE_SECRET` but the code read `LICENSE_SIGNING_SECRET`, falling back to a
  secret published in the source. Both names are now read; keys signed with the
  public fallback are rejected unless `ALLOW_LEGACY_DEV_SECRET=true`.
- `PUT /api/settings` can no longer write `license_*` or telemetry ID settings.

### Added
- **Owner view.** `https://<license-server>/admin.html` (password: `ADMIN_TOKEN`)
  lists paying customers — email, provider, amount, status, devices activated —
  and opt-in active-install counts by plan, version and OS. Backed by Upstash
  Redis; see `packages/license-server/README.md`.
- Subscription lifecycle: cancellations and expiries from LemonSqueezy and
  Razorpay are recorded, and the app re-checks its key once a day, dropping to
  Free when a subscription has expired. Network errors never downgrade anyone.
- **Opt-in anonymous usage stats** (Settings → Share anonymous usage stats, off
  by default): once a day sends a random install ID, app version, OS and
  Free/Pro — nothing else. Turning it off deletes the install ID.

### Changed
- Pro is $9/mo or $79/yr (₹299/mo via Razorpay) everywhere: landing page,
  CLI README, docs, the plan-value calculation and the Razorpay checkout
  default (was $19 / ₹1,599 in some places).
- Default license server is `https://api.llm-observer.com` (was the parked
  `api.llmobserver.com`); override with `LLM_OBSERVER_LICENSE_SERVER`.
- LemonSqueezy renewals no longer email a fresh key every month, and
  `order_created` is ignored (it duplicated `subscription_created`).
- `llm-observer pricing update` downloads from this repository instead of
  `run-llama/llm-observer`.

### Fixed
- `packages/license-server`'s first real Vercel deploy attempt failed with
  `Function Runtimes must have a valid version` -- `vercel.json`'s
  `functions.runtime: "nodejs22.x"` was invalid syntax for that field
  (it selects between runtime families like nodejs/edge, not a Node.js
  version). Removed; not needed for anything else in this config.
- Several places used `llmobserver.com` (no hyphen) instead of the real
  `llm-observer.com` -- the wrong one resolves to an unrelated parked
  domain. Fixed in the license-key error message, the license email's
  "from" address fallback, and the email template's footer link.

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
- Publishing also failed against a real granular npm token with `EOTP`
  (npm's account-level 2FA required a one-time password that can't be
  supplied in CI). Switched `publish.yml` to npm's OIDC trusted
  publishing (`npm publish --provenance`, `id-token: write`, no
  `NPM_TOKEN`) with a trusted publisher configured for this repo/workflow
  on npmjs.com, and bumped the CI npm CLI to latest (trusted publishing
  needs npm >= 11.5.0; Node 20's bundled npm predates that)
- That npm CLI bump then failed on its own: `npm install -g npm@latest`
  pulled npm 12.0.1, which requires Node `^22.22.2 || ^24.15.0 || >=26` --
  Node 20 satisfied neither the trusted-publishing floor nor npm 12's own
  floor. Bumped `publish.yml`'s Node version to 22

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
