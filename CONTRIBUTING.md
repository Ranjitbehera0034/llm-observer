# Contributing to LLM Observer

Thank you for your interest in contributing to LLM Observer!

## Monorepo Structure

- `packages/proxy`: The core interception engine + session-log parsers + optimization/analysis engines (Node.js/Express).
- `packages/database`: Shared database layer (SQLite/better-sqlite3).
- `packages/cli`: Command-line interface, published to npm as `llm-observer`.
- `packages/dashboard`: React-based observability dashboard (Vite).
- `packages/desktop`: Tauri desktop app wrapping the proxy + dashboard (see [SIGNING.md](packages/desktop/SIGNING.md) for release signing).
- `packages/license-server`: Vercel-hosted payment webhook relay and license key issuance (Razorpay / Lemon Squeezy).
- `packages/team-server`: Express + MongoDB team auth backend (password + OIDC login, team membership) — API-only today, no dashboard UI yet.
- `landing-page`: Marketing site source (llm-observer.com).
- `scripts/verify-costs.js`: Independent cost-verification script — recomputes token counts/cost straight from raw session files and diffs against the app's own database, without calling any of the app's own code.

## Development Setup

1. **Install Dependencies**:
   ```bash
   npm install
   ```
   The local SQLite database is created and migrated automatically the first time the proxy or CLI starts — no separate init step.

2. **Run in Development**:
   ```bash
   npm run dev
   ```

## Testing

We use Jest for testing. Please ensure all tests pass before submitting a PR.

```bash
npm test
```

If you're touching a session-log parser (`packages/proxy/src/parsers/`), also see
[`formatMatrix.test.ts`](packages/proxy/src/parsers/__tests__/formatMatrix.test.ts) —
recorded real-shaped fixture files checked against a golden-output manifest,
specifically to catch upstream log-format changes. Add a fixture + manifest
entry rather than only testing against an inline mock when you can.

## Architecture Overview

LLM Observer has four independent data-collection paths — most contributions touch one of them:

- **Session Parser** (`packages/proxy/src/parsers/`): reads session-log files editors already write (`~/.claude/`, `~/.cursor/`, etc.) — zero-config, the primary path most users rely on.
- **Proxy** (`packages/proxy/src/proxy.ts`, `server.ts`): an optional transparent proxy — intercepts `POST /v1/<provider>/...`, calculates costs in real time, logs to SQLite. Off by default.
- **Usage API Sync** (`packages/proxy/src/sync/` / rate-limits poller): polls provider admin APIs for billing-accurate usage.
- **Network Monitor**: OS-level connection detection for per-app cost attribution.

Cutting across all four: **Budget Guard** (blocks/warns when project limits are exceeded) and the analysis engines under `packages/proxy/src/analysis/` and `packages/proxy/src/optimization/` (response drift, A/B comparison, ROI/plan-value, reasoning-chain reconstruction).
