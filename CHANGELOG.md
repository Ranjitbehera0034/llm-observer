# Changelog

All notable changes to this project will be documented in this file.

## [1.5.0] - 2026-03-24

### Added
- **Network Monitor — Per-App Attribution** — Passively monitor AI API connections to attribute costs to specific applications (Cursor, VS Code, Claude Code, etc.)
- **Apps Dashboard** — New page with per-app cost breakdowns, connection timelines, and application renaming/aliasing
- **Electron & Generic Process Resolution** — Smart detection of actual app names for generic processes like `Electron`, `Node.js`, or `Python`
- **Subscription Mode Detection** — Automatically identifies tools using fixed licenses (e.g., Cursor Pro) even when proxy usage is $0
- **Network Status Diagnostics** — Live view of monitor status, known AI endpoints, and scan frequency adjustments
- **Automatic Frequeny Scaling** — Gracefully reduces scan frequency if system load is high or scans are slow
- **Privacy-First Design** — Monitor is OFF by default; only process names and destination IPs are tracked (no packet inspection)
- **Top Apps Today Panel** — Integrated mini-view on the main Control Room dashboard
- **Pre-populated Aliases** — Built-in support for 12+ common AI coding tools and utilities
- **Data Retention for Connections** — Automatic 30-day purge of old connection logs to maintain performance

### Changed
- Improved `AppCorrelator` engine with proportional cost attribution (estimated ~85-90% accuracy)
- Enhanced `UsageSyncManager` to support higher concurrency during initial data ingestion

### Fixed
- Fixed DNS resolution to correctly handle both IPv4 and IPv6 (AAAA) records for AI providers
- Improved error handling and log rate-limiting for network scanning tools (`lsof`/`ss`)

## [1.4.0] - 2026-03-24

### Added
- **Per-provider and per-model budgets** — Set daily, weekly, or monthly spend
  limits for any provider or specific model
- **Alerts system** — Get notified at 80%, 90%, and 100% of budget thresholds
- **Kill switch** — Optionally hard-block proxy requests when a budget is exceeded
- Alert deduplication (each threshold fires at most once per budget period)
- Budget progress bars on Overview page
- Bell icon with unread alert count in dashboard navigation
- Alert dropdown panel with acknowledge/dismiss controls
- Simplified pre-estimation to prevent budget overshoot on proxy requests
- Safety buffer (configurable, default $0.05) creates a cushion before the hard limit
- Budget presets for common configurations ($5/day Global, $3/day OpenAI)
- Inline kill-switch toggle on budget cards
- Real-time current spend progress bars in budget management

### Changed
- budgetGuard middleware now checks both old project-level budgets AND new
  provider/model budgets. Both must pass for a request to proceed.

### Breaking changes
- None (existing project-level budgets continue to work identically)
 
## [1.3.1] - 2026-03-24
 
### Added
- **Multi-Period KPI Toggle** — Switch between Today, Week, and Month views on the Control Room dashboard.
- **Precise Subscription Proration** — Automated cost calculation now respects `start_date` and `end_date` for mid-month subscriptions.
- **Visual Data Source Indicators** — Clear "● Verified Sync" vs. "◌ Proxy Logs" labels to help users understand data provenance.
- **Duplicate Subscription Guard** — Prevents adding the same service multiple times through a safety check in the Add Modal.
 
### Fixed
- Fixed a math error in subscription proration where the last day of the month could be double-counted.
- Standardized data aggregation logic to handle empty states and fallback scenarios more gracefully.
- Improved integration test coverage for the Unified Overview API.

## [1.3.0] - 2026-03-24
 
### Added
- **Unified Control Room Dashboard** — A single pane of glass for all AI spend, merging Sync data, Proxy logs, and Manual Subscriptions.
- **Manual Subscription Tracking** — Track fixed monthly costs (Cursor, Copilot, ChatGPT Plus, etc.) with automated daily burn calculation.
- **Smart Spend Deduplication** — Automatically prioritizes API Sync data over Proxy logs for the same provider to ensure $0 double-counting.
- **Subscription Presets** — Quick-add templates for 10+ common AI services with latest pricing.
- **Spending Trajectory Chart** — Stacked visualization showing tracked API costs vs. fixed subscription overhead.
 
### Changed
- Refactored `OverviewPage` to be the primary landing page (renamed to Control Room).
- Updated Sidebar navigation to prioritize the Control Room view.
- Improved cost aggregation logic to handle multi-source data merging.

## [1.2.0] - 2026-03-24

### Added
- **OpenAI Usage API Sync** — Add your OpenAI Admin API key to see all OpenAI spending across all your tools. Same zero-config experience as Anthropic sync.
- **Multi-provider aggregated dashboard view** — see total spend across Anthropic and OpenAI in one place.
- **Provider filter on Sync page** — view all providers combined, or filter to a specific one.
- **Automatic cost estimation fallback** — computed from token counts when the OpenAI Costs API is unavailable.
- **Cross-provider key prefix detection** — prevents configuration errors by validating key formats for each provider.

### Changed
- Refactored `SyncPage` dashboard to support multiple provider cards and aggregated analytics.
- Updated Sync API routes (`/usage/today`, `/usage/daily`, `/usage/by-model`) to support multi-provider aggregation.
- `UsageSyncManager` now supports concurrent background pollers for multiple providers.

## [1.1.0] - 2026-03-22

### Added
- **Anthropic Usage API Sync** — Support for syncing message usage and costs directly from the Anthropic Organization API.
- **Sync Dashboard** — Unified interface for managing API sync providers.
- **Secure Key Storage** — Encrypted, machine-bound storage for Admin API keys.

## [1.0.0] - 2026-03-10
- Initial release with local proxy, budget guards, and basic analytics.
