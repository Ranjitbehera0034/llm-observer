# Contributing to LLM Observer

Thank you for your interest in contributing! This guide will help you get started.

## Development Setup

### Prerequisites

- Node.js >= 18
- npm >= 9
- Git

### Getting Started

```bash
# Fork and clone the repo
git clone https://github.com/<your-username>/llm-observer.git
cd llm-observer

# Install all dependencies (monorepo)
npm install

# Start development mode
npm run dev
```

### Project Structure

This is a monorepo using npm workspaces:

```
packages/
  proxy/       → Core proxy engine (Node.js)
  database/    → SQLite database layer
  dashboard/   → React dashboard (Vite + Tailwind)
  cli/         → CLI interface (Commander.js)
apps/
  tauri/       → Desktop app (Phase 2)
```

### Development Commands

```bash
npm run dev           # Start all packages in dev mode
npm run build         # Build all packages
npm run lint          # Run ESLint across all packages
npm run test          # Run tests across all packages
npm run typecheck     # TypeScript type checking
```

## How to Contribute

### Reporting Bugs

1. Check [existing issues](https://github.com/Ranjitbehera0034/llm-observer/issues) first
2. Create a new issue with:
   - Clear title describing the bug
   - Steps to reproduce
   - Expected vs actual behavior
   - Your environment (OS, Node version, npm version)

### Suggesting Features

1. Open a [feature request issue](https://github.com/Ranjitbehera0034/llm-observer/issues/new)
2. Describe the problem you're trying to solve
3. Describe your proposed solution
4. We'll discuss before implementation

### Submitting Pull Requests

1. Fork the repo and create a branch from `develop`
2. Follow the branch naming convention: `feature/description`, `fix/description`, or `docs/description`
3. Write clear commit messages (see below)
4. Add tests if applicable
5. Ensure all checks pass: `npm run lint && npm run test && npm run typecheck`
6. Open a PR against `develop` (not `main`)

### Commit Message Convention

We follow [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add Mistral provider support
fix: correct token counting for streaming responses
docs: update CLI reference in README
refactor: extract cost calculation into separate module
test: add budget guard unit tests
chore: update dependencies
```

### Code Style

- TypeScript strict mode enabled
- ESLint + Prettier for formatting
- Prefer functional patterns over classes
- Write descriptive variable/function names
- Add JSDoc comments for public APIs

## Code of Conduct

Be respectful, constructive, and inclusive. We're all here to build something great together.

## Questions?

Open an issue or reach out to [@Ranjitbehera0034](https://github.com/Ranjitbehera0034).
