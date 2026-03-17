# Installation

To get started with LLM Observer, you can either use it directly with `npx` or install it globally.

## Quick Start (npx)

The fastest way to try LLM Observer is using `npx`:

```bash
npx llm-observer start
```

This will:
1. Initialize the local database in `~/.llm-observer/data.db`
2. Start the proxy server on port 4000
3. Launch the dashboard UI on port 4001

## Global Installation

If you prefer to have the `llm-observer` command available everywhere:

```bash
npm install -g llm-observer
```

Then you can simply run:

```bash
llm-observer start
```

## Configuration

After starting, visit the dashboard at [http://localhost:4001](http://localhost:4001) to:
- Add your API keys (OpenAI, Anthropic, etc.)
- Create your first project
- Set a budget limit
