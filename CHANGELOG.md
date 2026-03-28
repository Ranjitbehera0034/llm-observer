# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
