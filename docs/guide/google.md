# Using Google Gemini with LLM Observer

Route all Gemini API calls through LLM Observer for cost tracking, budget alerts, and usage analytics.

## Prerequisites

- LLM Observer running: `npx llm-observer start`
- Google AI Studio API key from [aistudio.google.com](https://aistudio.google.com)

## Setup

### Python (google-generativeai SDK)

```python
import google.generativeai as genai

# Point to LLM Observer proxy
genai.configure(
    api_key="your-google-api-key",
    client_options={"api_endpoint": "localhost:4000"}
)
```

### REST API (curl)

```bash
curl http://localhost:4000/v1/google/models/gemini-2.5-flash:generateContent \
  -H "Content-Type: application/json" \
  -d '{
    "contents": [{"parts": [{"text": "Hello, Gemini!"}]}]
  }'
```

> Pass your API key as `?key=YOUR_API_KEY` in the URL like the official Google API.

## Supported Models

| Model | Input (per 1M) | Output (per 1M) |
|-------|---------------|-----------------|
| gemini-2.5-pro | $3.50 | $10.50 |
| gemini-2.5-flash | $0.075 | $0.30 |
| gemini-1.5-pro | $3.50 | $10.50 |
| gemini-1.5-flash | $0.075 | $0.30 |
