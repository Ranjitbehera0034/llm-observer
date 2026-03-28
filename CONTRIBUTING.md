# Contributing to LLM Observer

Thank you for your interest in contributing to LLM Observer!

## Monorepo Structure

- `packages/proxy`: The core interception engine (Node.js/Express).
- `packages/database`: Shared database layer (SQLite/better-sqlite3).
- `packages/cli`: Command-line interface.
- `packages/dashboard`: React-based observability dashboard (Vite).

## Development Setup

1. **Install Dependencies**:
   ```bash
   npm install
   ```

2. **Initialize Database**:
   ```bash
   npx llm-observer init
   ```

3. **Run in Development**:
   ```bash
   npm run dev
   ```

## Testing

We use Jest for testing. Please ensure all tests pass before submitting a PR.

```bash
npm test
```

## Architecture Overview

LLM Observer works as a transparent proxy. It intercepts LLM API calls, calculates costs in real-time, and logs them to a local SQLite database for observability.

- **Proxy**: Intercepts `POST /v1/chat/completions` etc.
- **Budget Guard**: Blocks requests if project limits are exceeded.
- **Sync Manager**: Optionally polls native provider APIs for "official" usage data.
