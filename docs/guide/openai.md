# OpenAI Setup

Learn how to integrate OpenAI with LLM Observer.

## 1. Configure your API Key

Visit the **Settings > Upstream Providers** tab in the LLM Observer dashboard and enter your OpenAI API key.

Alternatively, you can set it via environment variable when starting the proxy:

```bash
OPENAI_API_KEY=sk-... npx llm-observer start
```

## 2. Update your Base URL

In your application code, change the `baseURL` (or `base_url` in Python) to point to the local proxy.

### Node.js (OpenAI SDK)

```javascript
import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: 'locally-unused', // Your key is managed by LLM Observer
  baseURL: 'http://localhost:4000/v1/openai'
});

const response = await openai.chat.completions.create({
  model: 'gpt-4o',
  messages: [{ role: 'user', content: 'Hello!' }],
});
```

### Python (OpenAI SDK)

```python
from openai import OpenAI

client = OpenAI(
    api_key="locally-unused",
    base_url="http://localhost:4000/v1/openai"
)

response = client.chat.completions.create(
    model="gpt-4o",
    messages=[{"role": "user", "content": "Hello!"}]
)
```

## 3. Verify in Dashboard

After making a request, head over to the **Request Logs** tab in the dashboard to see the real-time cost calculation and token usage.
