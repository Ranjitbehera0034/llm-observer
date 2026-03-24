# LLM Observer 🛡️

**Privacy-First, Local-Only LLM Cost Intelligence.**

Stop sending your prompt data to SaaS observability tools. LLM Observer is a developer-centric proxy and dashboard that lives entirely on your machine. Track spend, audit logs, and set budget guards without your data ever leaving your perimeter.

![LLM Observer Hero](https://raw.githubusercontent.com/llm-observer/llm-observer/main/assets/hero.gif)

## 💎 Why LLM Observer?

- **🔒 100% Private**: Your prompts, completions, and API keys are stored in a local SQLite database. No telemetry. No middle-man.
- **🛡️ Budget Guards**: Automatically block requests if a project hits its budget. Stop "wake-up-to-a-$1000-bill" surprises.
- **⚡ Unified Proxy**: One endpoint to rule them all. Switch between OpenAI, Anthropic, and Gemini with simple config.
- **🔄 Zero-Config Usage Sync**: One-click connect to Anthropic and OpenAI.
- **Unified Control Room**: See Sync, Proxy, and Manual costs in a single dashboard.
- **Subscription Tracking**: Manage fixed costs for Cursor, Copilot, and Claude Pro.
- **Smart Deduplication**: Zero double-counting between sync and proxy data.
- **Budget Guards**: Auto-kill requests when limits are exceeded.
- **🕵️ Anomaly Alerts**: Real-time webhook notifications if we detect a 5x spike in spend velocity.

## 🚀 Getting Started (How to Use)

LLM Observer is designed to be frictionless. Here is how a new user can get up and running in minutes:

### 1. Launch the Stack
Start the proxy, dashboard, and local database with a single command. You don't need to configure a separate database or complex environment.
```bash
npx llm-observer start
```

### 2. Configure Your Dashboard
Once launched, open the LLM Observer dashboard in your browser.
- Create a new **Project**.
- Add your actual Provider API keys (e.g., your real OpenAI or Anthropic keys). These are saved securely in your *local* database.
- *(Optional)* Set up budget limits or anomaly alert webhooks for the project to protect against unexpected spend.

### 3. Update Your Application Code
Change your application's LLM initialization to point to the local LLM Observer proxy endpoint. You can use any dummy string for the API key in your code, as the proxy will systematically inject your real API key from its local database before forwarding the request to the provider.

**OpenAI (Node.js Example)**
```javascript
const openai = new OpenAI({
  apiKey: 'sk-proj-locally-unused-but-needed', // Provide a dummy key
  baseURL: 'http://localhost:4000/v1/openai' // Point to the local Proxy
});
```

**Anthropic (Node.js Example)**
```javascript
const anthropic = new Anthropic({
  apiKey: 'unused-local-key', // Provide a dummy key
  baseURL: 'http://localhost:4000/v1/anthropic' // Point to the local Proxy
});
```

### 4. Monitor and Analyze
Start using your application as normal! All your LLM requests will now route securely through the proxy.
Go back to your local dashboard to view live logs, track cost accumulation per project/model, and ensure your budgets are protected.

## 📊 Pricing

| Feature | Hobbyist (Free) | Pro (India) | Pro (International) |
| :--- | :--- | :--- | :--- |
| **Price** | $0/mo | ₹299/mo | $9/mo |
| **Projects** | 1 Project | **Unlimited** | **Unlimited** |
| **Log Retention** | 7 Days | **90 Days** | **90 Days** |
| **Budget Guards** | ✅ Yes | ✅ Yes | ✅ Yes |
| **Anomaly Alerts** | ✅ Yes | ✅ Yes | ✅ Yes |
| **Data Residency** | Local | Local | Local |

[Get a Pro License Key](https://llmobserver.com/pricing)

## 🛠️ Development

LLM Observer is a monorepo built with React, Express, and Vite.

```bash
# Clone and install
git clone https://github.com/Ranjitbehera0034/llm-observer.git
cd llm-observer
npm install

# Start development flow (compiles all packages and starts dev servers)
npm run dev:all
```

---
Built with ❤️ for AI developers who care about privacy.
