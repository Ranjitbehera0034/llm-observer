# LLM Observer 🛡️

**Privacy-First, Local-Only LLM Cost Intelligence.**

Stop sending your prompt data to SaaS observability tools. LLM Observer is a developer-centric proxy and dashboard that lives entirely on your machine. Track spend, audit logs, and set budget guards without your data ever leaving your perimeter.

![LLM Observer Hero](https://raw.githubusercontent.com/llm-observer/llm-observer/main/assets/hero.gif)

## 🚀 Zero-Friction Setup

Launch the full stack (Proxy + Dashboard + DB) with a single command:

```bash
npx llm-observer start
```

## 💎 Why LLM Observer?

- **🔒 100% Private**: Your prompts, completions, and API keys are stored in a local SQLite database. No telemetry. No middle-man.
- **🛡️ Budget Guards**: Automatically block requests if a project hits its budget. Stop "wake-up-to-a-$1000-bill" surprises.
- **⚡ Unified Proxy**: One endpoint to rule them all. Switch between OpenAI, Anthropic, and Gemini with simple config.
- **🕵️ Anomaly Alerts**: Real-time webhook notifications if we detect a 5x spike in spend velocity.

## 🔌 One-Line Integration

Just point your `baseURL` to the local proxy.

### OpenAI (Node.js)
```javascript
const openai = new OpenAI({
  apiKey: 'sk-proj-locally-unused-but-needed', // Keys are configured in Dashboard
  baseURL: 'http://localhost:4000/v1/openai'
});
```

### Anthropic (Node.js)
```javascript
const anthropic = new Anthropic({
  apiKey: 'unused-local-key',
  baseURL: 'http://localhost:4000/v1/anthropic'
});
```

## 📊 Comparison: Hobbyist vs Pro

| Feature | Hobbyist (Free) | Pro ($19/mo) |
| :--- | :--- | :--- |
| **Projects** | 1 Project | **Unlimited** |
| **Log Retention** | 7 Days | **90 Days** |
| **Budget Guards** | ✅ Yes | ✅ Yes |
| **Anomaly Alerts** | ✅ Yes | ✅ Yes |
| **Data Residency** | Local | Local |

[Get a Pro License Key](https://llmobserver.com/pricing)

## 🛠️ Development

LLM Observer is a monorepo built with React, Express, and Vite.

```bash
# Clone and install
git clone https://github.com/Ranjitbehera0034/llm-observer
npm install

# Start development flow
npm run dev:all
```

---
Built with ❤️ for AI developers who care about privacy.
