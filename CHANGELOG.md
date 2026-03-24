# Changelog

All notable changes to this project will be documented in this file.
 
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
