---
layout: home

hero:
  name: "LLM Observer"
  text: "Privacy-First LLM Cost Intelligence"
  tagline: Stop sending your prompt data to SaaS observability tools.
  actions:
    - theme: brand
      text: Get Started
      link: /guide/installation
    - theme: alt
      text: View on GitHub
      link: https://github.com/Ranjitbehera0034/llm-observer

features:
  - title: 100% Private
    details: Your prompts, completions, and API keys stay on your machine in a local SQLite database.
  - title: Budget Guards
    details: Block a request before it is sent when recorded, queued and in-flight estimated spend would exceed the budget (best effort: the estimate check only starts once spend reaches 60% of the limit, so below that one request can overshoot by its whole cost; above it, overshoot is bounded by the difference between a request's estimated and actual cost, for proxy traffic of one process; it cannot promise to prevent a bill).
  - title: Unified Proxy
    details: One endpoint for OpenAI, Anthropic, Gemini, Mistral, and Groq.
---
