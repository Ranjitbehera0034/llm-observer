# LLM Observer 🚀

**The open-source Observability, Budgeting, and Rate-Limiting Proxy for LLM developers.**

Run everything locally. Keep your API keys private. Never overspend again.

![LLM Observer Banner](https://raw.githubusercontent.com/llm-observer/llm-observer/main/assets/banner.png)

## Quick Start (No Install Required)

```bash
npx llm-observer start
```

This command:
1. Spawns your local **Proxy Server** (Port 4000)
2. Launches your **Dashboard UI** (Port 4001)
3. Initializes your local SQLite database

## Key Features

### 🛡️ Budget Guards
Set daily, weekly, or monthly spend limits at the project or provider level. The proxy automatically blocks requests once your limit is hit, preventing "wake-up-to-a-$1000-bill" surprises.

### ⚡ Performance & Cost Tracking
Real-time dashboards showing your token usage, latency, and cost across OpenAI, Anthropic, and Google Gemini.

### 🕵️ Anomaly Detection
Background checks that monitor your spend velocity. If we detect a spike >5x your rolling average, you'll get an immediate alert.

### 📦 Privacy First
LLM Observer runs entirely on your machine. Your requests, API logs, and project settings never leave your local environment.

## CLI Usage

| `start` | Boot up the Proxy and Dashboard |
| `status` | Check service health and today's spend |
| `logs` | View or tail (`-f`) recent LLM requests |
| `pricing` | View current token rates for all models |

## 🔌 SDK Integration

Just change your `baseURL` to point to `localhost:4000`.

### OpenAI (Node.js)
```javascript
const openai = new OpenAI({
  apiKey: 'YOUR_API_KEY',
  baseURL: 'http://localhost:4000/v1/openai'
});
```

### Anthropic (Node.js)
```javascript
const anthropic = new Anthropic({
  apiKey: 'YOUR_API_KEY',
  baseURL: 'http://localhost:4000/v1/anthropic'
});
```

### Google Gemini (Node.js)
```javascript
const { GoogleGenerativeAI } = require("@google/generative-ai");
const genAI = new GoogleGenerativeAI("YOUR_API_KEY");
// Custom baseURL is currently managed in the provider config
```

## License

- **Free Tier**: 1 Project, 7-day log retention.
- **Pro Tier**: Unlimited projects, 90-day retention, Priority support.

To activate Pro, add your license key in the Dashboard Settings.

---
Built with ❤️ by the LLM Observer Team.
