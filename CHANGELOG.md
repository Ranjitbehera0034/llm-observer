# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
