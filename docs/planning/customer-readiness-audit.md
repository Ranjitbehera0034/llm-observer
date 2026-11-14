# Customer readiness audit — 2026-11-14

## Live experience observed

Visited https://www.llm-observer.com/ in a browser. Free CTA leads to installation docs, not account creation. The advertised Pro URL https://llmobserver.lemonsqueezy.com/checkout/buy/pro-monthly returned “404: Page Not Found.” No purchase, real customer account, or live license was created. India checkout on the live site advertises ₹1,599/mo; local code and revised landing page implement ₹799 for a non-renewing 30-day pass. Live Pro copy is $19/mo; revised local copy is $9/mo. Pricing and configured payment variants must be reconciled before deployment.

## What an owner can know

| Question | Current release proposal | Limits |
|---|---|---|
| Who paid? | Hosted billing snapshots from verified payment events and license validation; owner-only customer report | Requires database, payment credentials, webhook delivery and existing-customer backfill |
| Who is trialing? | Verified Lemon Squeezy `on_trial` is distinct from paid Pro | No trial is advertised/provisioned automatically; configure a real checkout trial policy first |
| Who uses the app? | Explicit opt-in installation heartbeat at startup and daily while running | Measures reported running, not actions or person-level engagement; no report means unknown |
| Who uses Free? | Anonymous installation ID when reporting is enabled | No-account local users cannot be individually identified; one person can have multiple installations |
| Who stopped using it? | Owner can inspect last-seen timestamp | Offline, opted-out and inactive cannot be reliably distinguished |

The customer report is at the license service `/customers.html`. It requires a separate owner token; the token stays in page memory. The demo button creates three **synthetic browser-only actors** (free, trial, premium). These are not customer accounts, revenue, production records or issued licenses. Automated tests exercise the server flows with mocked payment and database services. No live gateway or hosted Postgres integration has been verified.

## Promise versus implementation

| Landing promise observed | Actual evidence | Resolution |
|---|---|---|
| SOC 2 compliant | Security page disclaims certification; no certification evidence | Removed hero claim in landing source |
| Stop hallucinations / semantic ground truth | `responseDrift.ts` compares lexical term frequencies | Describe response drift and its limits |
| Automatic PII masking / zero overhead | Explicit opt-in regex matching; best effort | Describe opt-in scope; remove zero-overhead claim |
| Full reasoning replay | Captured request/session detail cannot reveal hidden reasoning | Describe request inspection |
| 1.2B tokens, 99.97% uptime, 500+ tokens/s | Hard-coded example marketing values | Remove aggregate claims; label sample log stream |
| All seven tools, including Cursor | Cursor import remains unsupported | Supported-format wording; retain status warning |
| CSV/PDF | CSV request export implemented; PDF not implemented | Remove PDF promise |
| Unlimited projects | Pro currently permits 100 projects | Landing copy says 100 |
| Team sync | CLI join/sync intentionally unavailable until complete | Team remains unavailable/in progress |
| All new models / tools | Provider-specific proxy and local-format adapters | New compatible model IDs tracked without allowlist; absent rates stay unpriced; no universal capture claim |

## Implemented in this proposal

- Server-created international Lemon Squeezy checkout (monthly/annual), alongside Razorpay for India. The landing page has an active upgrade form with actionable setup/network errors. Merchant configuration remains required.
- Optional hosted customer ledger and owner report with authenticated access, separate free/trial/Pro snapshots and test-mode labeling.
- Opt-in metadata-only activity reporting, secret-protected installation updates, stop/delete retry, no default telemetry.
- Persistent local task inbox for manual, optimizer and saved AI recommendations; deduplication and user-controlled statuses. This is a supervised recommendation workflow, not an autonomous execution agent.
- Configurable Anthropic analyst model, one call per run, 4,096 output-token cap, validation of generated recommendations. API charges are separate from chat subscriptions.
- Moonshot/Kimi, DeepSeek, OpenRouter and xAI compatible routes, provider-specific keys, SSE usage and no model allowlist. Actual provider calls remain untested without supplied keys.
- Daily pricing catalog refresh, preserved custom rates, price revisions, and CLI registry/schema corrections. Adding a model to the registry does not prove all modalities or tool formats work.

## Deployment/release blockers

1. Configure real Lemon Squeezy checkout URLs, store/variant IDs and chosen price/trial policy. Smoke-test a gateway sandbox purchase, delivery, activation, renewal, cancellation, refund and expiry before selling.
2. Apply `packages/license-server/sql/customer-reporting.sql` to a dedicated Supabase database. Configure server-only store/service/admin secrets, deploy the license service and configure `LICENSE_SERVER_URL` at app build time. Verify SQL permissions and RPC behavior against staging. Add gateway rate limits to `/activity`, `/checkout/razorpay` and `/license/validate`; schedule the documented 90-day activity cleanup.
3. Import/backfill existing verified customers. Event snapshots do not enumerate older purchases automatically. Reconcile Razorpay refunds through validation/provider records; the existing webhook handles payment-link delivery, not a full refund reconciliation job.
4. Publish the landing-page PR after the payment configuration is verified. Local edits do not repair the live site until deployed.
5. Approve the release PR, resolve staging checks, then publish the prerelease to npm's **beta** tag. Do not move `latest` or create a production release before approval. Desktop signing/notarization remains a separate check.

## Provider references

- Moonshot/Kimi configuration: https://moonshotai.github.io/kimi-code/en/configuration/providers
- DeepSeek API format/base URL: https://api-docs.deepseek.com/en/
- OpenRouter base URL: https://openrouter.ai/developers
- Analyst model IDs: https://platform.claude.com/docs/en/models/overview

“Kimi h3” was not verified as a model ID. Use the exact ID from your provider's model list; unknown IDs are recorded, not silently renamed or assigned invented prices.
