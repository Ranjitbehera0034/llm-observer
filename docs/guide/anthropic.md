# Using Anthropic Claude with LLM Observer

Route all Claude API calls through LLM Observer to get full cost tracking, budget alerts, and usage analytics.

## Prerequisites

- LLM Observer running: `npx llm-observer start`
- Anthropic API key from [console.anthropic.com](https://console.anthropic.com)

## Setup

Change just the **base URL** in your Anthropic client. Your API key stays on your machine.

### Python (anthropic SDK)

```python
import anthropic

client = anthropic.Anthropic(
    api_key="your-anthropic-api-key",
    base_url="http://localhost:4000/v1/anthropic",
)

message = client.messages.create(
    model="claude-opus-4-5",
    max_tokens=1024,
    messages=[{"role": "user", "content": "Hello, Claude!"}],
)
```

### Node.js / TypeScript

```typescript
import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
  baseURL: 'http://localhost:4000/v1/anthropic',
});

const response = await client.messages.create({
  model: 'claude-opus-4-5',
  max_tokens: 1024,
  messages: [{ role: 'user', content: 'Hello!' }],
});
```

## Supported Models

| Model | Input (per 1M) | Output (per 1M) |
|-------|---------------|-----------------|
| claude-opus-4-5 | $15.00 | $75.00 |
| claude-sonnet-4-5 | $3.00 | $15.00 |
| claude-haiku-4-5 | $0.80 | $4.00 |

## Streaming

Streaming works transparently — LLM Observer buffers SSE chunks to count tokens after the stream completes.

```python
with client.messages.stream(
    model="claude-opus-4-5",
    max_tokens=1024,
    messages=[{"role": "user", "content": "Write a story."}],
) as stream:
    for text in stream.text_stream:
        print(text, end="", flush=True)
```
