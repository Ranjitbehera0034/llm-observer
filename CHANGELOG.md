# Changelog

All notable changes to this project will be documented in this file.

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
