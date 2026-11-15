# Model access and commerce

## Implemented first step

`Model access` gives users one place to choose official chat or API account setup for ChatGPT/OpenAI, Claude/Anthropic, Gemini/Google, DeepSeek, Kimi/Moonshot, and OpenRouter. Payment and plan activation happen on the provider's own site. The user can then connect a personal API key in Observer and track supported proxy calls, local logs, or account sync. Chat subscriptions can be recorded manually on Overview, using the customer's actual monthly charge. A recorded cost is not purchase verification or API credit.

## What direct payment in Observer would require

A true one-checkout product for model usage is a **new hosted API service**, separate from Observer Pro licensing. Before collecting money, establish provider or aggregator contracts allowing this distribution, an approved merchant and supported countries, agreed retail prices and tax/refund terms, and a user account that owns credits. Then implement a transactional credit ledger: webhook-verified funding; idempotent reservations and settled usage; provider-specific exact billing amounts; spending limits; balance checks; refunds/chargebacks; concurrency and abuse protection; receipts and customer support; audit/reconciliation against merchant and provider invoices. Never sell shared API keys or grant access from a browser-side payment redirect. Provider chat subscriptions would require explicit reseller/affiliate agreements and provider-issued entitlements; a payment to Observer alone cannot activate a user's ChatGPT, Claude, Gemini or Kimi account.

A lower-friction alternative is to evaluate an authorized multi-model aggregator integration. OpenRouter currently offers a multi-provider credit account, but those credits remain purchased and billed by OpenRouter until an authorized commerce integration exists.

## Evidence

- [OpenAI billing separation](https://help.openai.com/en/articles/9039756-managing-billing-for-chatgpt-and-the-api-platform)
- [OpenAI Services Agreement](https://openai.com/policies/services-agreement/) (customer applications permitted; account access/key resale restricted)
- [Anthropic chat/API billing separation](https://support.anthropic.com/en/articles/9876003-i-subscribe-to-a-paid-claude-ai-plan-why-do-i-have-to-pay-separately-for-api-usage-on-console)
- [Gemini API billing](https://ai.google.dev/gemini-api/docs/billing)
- [OpenRouter credit model](https://openrouter.ai/support/)
