# LLM Observer — Release v1.3.0 Complete Plan

## Unified Dashboard + Manual Subscription Tracking

**Version type:** Minor (new feature, fully backward compatible)
**Previous release:** v1.2.0 (OpenAI Usage API Sync)
**Estimated effort:** 5-6 days
**Risk level:** Medium (data merging logic, response shape changes on existing sync routes)

---

## 1. What this release does — in plain language

Before v1.3.0, a developer's AI spending is scattered across three disconnected views inside LLM Observer itself:

- The Projects/Logs page shows requests that went through the proxy
- The Sync page shows API spend pulled from Anthropic and OpenAI
- Subscription costs (Cursor Pro $20/month, GitHub Copilot $10/month) are invisible entirely

After v1.3.0, there is one Overview page that shows everything:

"Total AI spend this month: $147 — $95 tracked via API (Anthropic $62, OpenAI $33) + $52 subscriptions (Cursor Pro $20, Copilot $10, ChatGPT Plus $20, Claude Pro $2 [prorated])"

The developer sees their complete AI budget in one place for the first time. This is the release that makes LLM Observer worth talking about.

---

## 2. The three data sources and how they merge

### 2.1 Source 1: Sync data (from v1.1.0 and v1.2.0)

Stored in `usage_records` and `daily_costs` tables. This is the primary source of truth for API spend. It comes directly from the provider (Anthropic/OpenAI) and reflects actual billing. Updated every 60 seconds.

**What it contains:** Token counts, request counts, model names, daily cost in USD.
**What it doesn't contain:** Per-request details (prompts, responses, latency).

### 2.2 Source 2: Proxy data (from v1.0.x)

Stored in `request_logs` table. This is the source of truth for request-level detail. It comes from requests that physically passed through LLM Observer's proxy.

**What it contains:** Full request/response details, exact latency, exact token counts, computed cost.
**What it doesn't contain:** Requests that bypassed the proxy (Claude Code, Cursor, etc.).

### 2.3 Source 3: Manual subscriptions (new in v1.3.0)

Stored in a new `subscriptions` table. These are fixed monthly costs the user enters manually for tools where LLM Observer has no visibility.

**What it contains:** Service name, monthly cost, billing cycle.
**What it doesn't contain:** Any usage detail — just a flat dollar amount.

### 2.4 The deduplication problem

A request that goes through the proxy appears in BOTH the proxy logs (Source 2) AND the sync data (Source 1). If we naively sum them, we double-count.

**The rule:** For the unified dashboard, sync data is the source of truth for cost. We NEVER add proxy cost to sync cost for the same provider. The unified view shows:

- Sync cost for each provider (accurate, from the provider's own billing data)
- PLUS manual subscription costs
- Proxy data is available as a "detail view" — if the user clicks into a specific time bucket, they can see which requests went through the proxy, with full prompt/response details. But the proxy cost is NOT added to the total.

**What about providers that have sync enabled but also get proxy traffic?**
If a user has Anthropic sync active AND routes some requests through the proxy to Anthropic, the total Anthropic spend comes from sync only. The proxy requests are a subset of what sync reports. No double-counting.

**What about providers that have proxy data but NO sync?**
If a user routes requests to Mistral through the proxy but doesn't have Mistral sync (because Mistral has no Usage API), then proxy data IS the only source. In this case, proxy cost is included in the total. The rule: for each provider, use sync cost if available, else use proxy cost.

**Priority order per provider:**
1. If sync data exists for this provider → use sync cost (ignore proxy cost for this provider)
2. If only proxy data exists for this provider → use proxy cost
3. If only manual subscription exists → use manual cost
4. If none exists → $0 (provider not tracked)

---

## 3. Proposed changes — component by component

### 3.1 Database changes

**New migration: `002_subscriptions.sql` (or next sequence number)**

**New table: `subscriptions`**
Stores manually entered subscription costs.

| Column | Purpose |
|--------|---------|
| id (auto-increment) | Row identifier |
| service_name | Display name: "Cursor Pro", "GitHub Copilot", "ChatGPT Plus" |
| provider | Optional link to a known provider: "cursor", "github", "openai", "anthropic", or NULL for custom |
| monthly_cost_usd | Monthly cost in USD |
| billing_cycle | "monthly" or "yearly" (yearly is divided by 12 for monthly view) |
| is_active | Whether the subscription is currently active (1 = yes, 0 = cancelled) |
| start_date | When the subscription started (for prorating partial months) |
| end_date | When the subscription ended (NULL if still active) |
| notes | Optional user note: "Shared with team" or "Cancelling next month" |
| created_at | When this entry was created |
| updated_at | When this entry was last modified |

No other tables are modified. The existing `usage_records`, `request_logs`, `daily_costs`, and `usage_sync_configs` tables remain unchanged.

### 3.2 Subscription management API routes

**New routes:**

`GET /api/subscriptions` — List all subscriptions (active and inactive).

`POST /api/subscriptions` — Create a subscription entry. Accepts: service_name, monthly_cost_usd, billing_cycle, start_date, notes. Returns the created subscription.

`PUT /api/subscriptions/:id` — Update a subscription (change cost, deactivate, add notes).

`DELETE /api/subscriptions/:id` — Remove a subscription entry entirely.

**Pre-populated templates.** When the user opens the "Add subscription" dialog, offer common presets they can click to auto-fill:

| Preset | Service name | Monthly cost | Notes |
|--------|-------------|-------------|-------|
| Cursor Pro | Cursor Pro | $20 | IDE with AI features |
| Cursor Pro+ | Cursor Pro+ | $60 | Higher usage limits |
| Cursor Ultra | Cursor Ultra | $200 | Maximum usage |
| GitHub Copilot Individual | GitHub Copilot | $10 | AI pair programming |
| GitHub Copilot Business | GitHub Copilot Business | $19 | Per seat |
| ChatGPT Plus | ChatGPT Plus | $20 | Web and mobile access |
| ChatGPT Pro | ChatGPT Pro | $200 | Unlimited access |
| Claude Pro | Claude Pro | $20 | Web and mobile access |
| Claude Max | Claude Max | $100 | Higher limits |
| JetBrains AI | JetBrains AI Assistant | $10 | IDE plugin |
| Custom | (user enters) | (user enters) | (user enters) |

The user clicks a preset, it fills the form, they can modify the amount if it's different (team pricing, annual discount, etc.), and then save.

### 3.3 Unified Overview API routes

**New routes (the core of this release):**

`GET /api/overview` — The main dashboard data endpoint. Returns:

```
{
  total_today_usd: 6.42,
  total_this_week_usd: 31.80,
  total_this_month_usd: 147.00,

  tracked_api: {
    total_usd: 95.00,
    providers: {
      anthropic: { total_usd: 62.00, source: "sync", models: [...] },
      openai: { total_usd: 33.00, source: "sync", models: [...] },
      mistral: { total_usd: 0.00, source: "proxy", models: [...] }
    }
  },

  subscriptions: {
    total_usd: 52.00,
    active: [
      { id: 1, service_name: "Cursor Pro", monthly_usd: 20.00 },
      { id: 2, service_name: "GitHub Copilot", monthly_usd: 10.00 },
      { id: 3, service_name: "ChatGPT Plus", monthly_usd: 20.00 },
      { id: 4, service_name: "Claude Pro", monthly_usd: 2.00, note: "prorated" }
    ]
  },

  comparison: {
    vs_yesterday: { amount: 0.82, pct: 12.7, direction: "up" },
    vs_last_week: { amount: -3.20, pct: -5.1, direction: "down" }
  }
}
```

`GET /api/overview/timeline?days=30` — Daily cost time series for the chart. Each day has:
- tracked_api_usd: actual API spend from sync (or proxy if no sync)
- subscriptions_daily_usd: monthly subscriptions divided by days in month
- total_usd: sum of above

`GET /api/overview/by-model?days=7` — Model breakdown across all providers. Shows both Claude and GPT models sorted by spend.

`GET /api/overview/by-provider?days=7` — Provider-level breakdown.

`GET /api/overview/by-source` — Breakdown by data source: "sync" (from Usage APIs), "proxy" (from request_logs), "manual" (from subscriptions). This helps users understand where their data comes from.

### 3.4 Existing Sync routes — backward compatible changes

The existing `/api/sync/*` routes continue to work. They still return only sync data (no proxy data, no subscription data). The new `/api/overview/*` routes handle the unified view.

This means:
- The Sync page still works exactly as in v1.2.0
- The Projects/Logs pages still work exactly as before
- The new Overview page uses the new routes
- No existing API consumer breaks

### 3.5 Dashboard changes

**New: Overview page becomes the landing page.**

When the user opens LLM Observer's dashboard, they now land on the Overview page (not Projects). The navigation changes to:

`[Overview ★NEW] [Projects] [Logs] [Sync] [Settings]`

**Overview page layout:**

**Top section — headline numbers:**
Three cards side by side:
- "Today: $6.42" (with comparison to yesterday)
- "This week: $31.80" (with comparison to last week)
- "This month: $147.00" (with comparison to last month)

**Middle section — cost chart:**
A daily bar chart for the last 30 days. Each bar is split into two segments:
- Solid fill: tracked API spend (from sync or proxy)
- Hatched/striped fill: subscription costs (daily average)

The visual distinction between tracked and manual data is critical. Users must never confuse estimated subscription costs with precise API tracking.

**Bottom section — breakdown tables:**
Two side-by-side panels:

Left panel — "API spend by model":
| Model | Provider | Requests | Cost | % |
|-------|----------|----------|------|---|
| claude-sonnet-4 | Anthropic | 1,240 | $38.40 | 40% |
| gpt-4o | OpenAI | 890 | $22.10 | 23% |
| claude-haiku-3.5 | Anthropic | 2,100 | $12.60 | 13% |
| ... | ... | ... | ... | ... |

Right panel — "Subscriptions":
| Service | Monthly cost | Status |
|---------|-------------|--------|
| Cursor Pro | $20.00 | Active |
| GitHub Copilot | $10.00 | Active |
| ChatGPT Plus | $20.00 | Active |
| Claude Pro | $2.00 | Active (prorated) |
| + Add subscription | | |

**Data source indicators:**
Throughout the page, small labels indicate where data comes from:
- A solid dot (●) next to "Anthropic: $62" means "Tracked — data from Usage API"
- A dashed dot (◌) next to "Cursor Pro: $20" means "Manual — entered by you"
- A half-filled dot (◐) next to "Mistral: $5" means "Proxy only — from proxied requests"

### 3.6 Onboarding for new users

When a user opens the Overview page for the first time and has NO data (no sync keys, no proxy traffic, no subscriptions), show a setup wizard:

**Step 1:** "Track your API spending"
"Add your provider Admin API keys to see usage from all your tools automatically."
→ [Add Anthropic key] [Add OpenAI key] [Skip for now]

**Step 2:** "Track your subscriptions"
"Do you pay for any of these AI tools? Add them to see your complete AI budget."
→ Checklist: [ ] Cursor Pro ($20/mo) [ ] GitHub Copilot ($10/mo) [ ] ChatGPT Plus ($20/mo) [ ] Claude Pro ($20/mo) [ ] Other → custom entry
→ [Save selected] [Skip for now]

**Step 3:** "You're all set"
Shows the Overview page with whatever data sources were configured. Even if only subscriptions were added, the user sees: "Total AI spend: $50/month (subscriptions only). Add your API keys in Settings to see usage-level detail."

---

## 4. Error handling and edge cases

### 4.1 Data merging edge cases

| Scenario | What happens |
|----------|-------------|
| Sync active for Anthropic, proxy also routes to Anthropic | Overview shows sync cost only (no double-count). Proxy details available via drill-down. |
| Sync active for OpenAI but no proxy traffic to OpenAI | Overview shows sync cost for OpenAI. Normal. |
| No sync for Mistral, but proxy routes to Mistral | Overview shows proxy-computed cost for Mistral. |
| No sync, no proxy, only manual subscription for Cursor | Overview shows manual $20/month for Cursor. No API detail. |
| User removes sync key but historical data exists | Historical sync data remains in overview. Future days show $0 for that provider. |
| User deletes a subscription | Subscription disappears from the overview. Historical months that included it show the reduced total retroactively. Alternative: keep deleted subscriptions in history with end_date set. |
| User has sync + proxy + subscription for the same provider | Example: Anthropic sync active ($62 API) + Claude Pro manual ($20 subscription). Both appear in overview but are clearly separated: API spend = $62, subscription = $20. These are genuinely different costs and should NOT be deduplicated. |

### 4.2 The subscription proration question

User adds "Cursor Pro $20/month" on March 15. In the March overview:
- Should it show $20 (full month) or $10 (half month)?
- Decision: prorate. If start_date is March 15 and the month has 31 days, the March cost is $20 × (17/31) = $10.97.
- The daily average for the chart: $20 / 31 = $0.645 per day, but only for days from the 15th onward.

User cancels the subscription on March 25 (sets end_date):
- March cost: $20 × (10/31) = $6.45 (March 15-25)
- April cost: $0

### 4.3 Currency handling

All costs are in USD. Subscription prices in other currencies must be entered as the USD equivalent by the user. The form should note: "Enter the amount in USD. If you pay in another currency, use the approximate USD equivalent."

Future enhancement: currency conversion. Not in v1.3.0.

---

## 5. Positive scenarios

### 5.1 Developer sees complete picture for the first time

A developer has been using LLM Observer since v1.1.0 for Anthropic tracking. They add their OpenAI key in v1.2.0. After v1.3.0, they add their subscriptions: Cursor Pro ($20), Copilot ($10), ChatGPT Plus ($20).

The Overview shows: "March 2026 total: $167 — API tracked: $97 (Anthropic $64, OpenAI $33) + Subscriptions: $70 (Cursor $20, Copilot $10, ChatGPT Plus $20, Claude Pro $20)."

They're shocked. They didn't realize they were spending $167/month on AI. They decide to cancel ChatGPT Plus (they barely use it now that they have Claude Code) and switch Continue from Opus to Sonnet. Projected savings: $35/month.

### 5.2 Team lead justifies AI budget

A team lead uses the Overview page to export a monthly summary. They present it to management: "Our team spends $420/month on AI tools. Here's the breakdown by tool and provider. Here's where we can optimize." The data backing this came from LLM Observer's unified view — no manual spreadsheet needed.

### 5.3 Developer discovers redundant subscriptions

A developer has both Claude Pro ($20/month) and Anthropic API credits. After adding both to LLM Observer, the Overview shows: Claude Pro $20/month but their API spend (which includes Claude Code) is $65/month. The subscription is redundant — they're paying for API access anyway. They cancel Claude Pro and save $20/month.

---

## 6. Negative scenarios

### 6.1 User expects subscription tracking to show usage detail

User adds "Cursor Pro $20/month." They click on it expecting to see request counts, model breakdown, tokens used. Instead they see: "$20/month — manual entry. No usage detail available for subscription services."

**Mitigation:** Set expectations upfront. When adding a subscription, the form explains: "This adds a fixed cost to your total AI budget. Usage details are not available for subscription services. For detailed tracking, add your provider Admin API keys in the Sync section."

### 6.2 Subscription price changes and user doesn't update

Cursor changes pricing from $20 to $25/month. The user doesn't update their LLM Observer entry. The overview shows $20/month for months, underreporting by $5.

**Mitigation:** On the subscriptions panel, show a "last verified" date for each entry. After 90 days without modification, show a subtle note: "Price last verified 90+ days ago. Tap to confirm it's still $20/month." This doesn't auto-update (we can't know the current price), but it nudges the user to check.

### 6.3 Overview shows $0 because nothing is configured

New user installs LLM Observer v1.3.0. Opens the Overview. Sees $0.00 everywhere.

**Mitigation:** The first-time wizard (section 3.6) catches this. If no data sources are configured, show the setup wizard instead of an empty dashboard. After the wizard is dismissed (even if skipped), show: "No data sources configured yet. Add your API keys or subscriptions in Settings to start tracking."

### 6.4 Proxy data shows different cost than sync data for the same requests

A user routes requests through the proxy to Anthropic. The proxy computes cost using pricing.ts. The sync data shows cost from Anthropic's actual billing. These numbers differ slightly because:
- pricing.ts may be slightly outdated
- Anthropic may apply discounts or credits
- Rounding differences

**Mitigation:** The overview uses sync cost (it's the real bill). The proxy cost is only shown in the detail drill-down view. If they differ, a small note appears: "Proxy estimated: $61.40. Anthropic reported: $62.00. Difference: $0.60 (0.97%). Provider-reported cost is used in totals."

### 6.5 User adds same service twice

User accidentally adds "Cursor Pro $20" twice.

**Mitigation:** When adding a subscription, check for duplicates by service_name. If a match is found, show: "You already have 'Cursor Pro' as an active subscription ($20/month). Did you mean to update it instead?" Offer "Update existing" or "Add anyway" (for users who legitimately have two separate subscriptions to the same service).

---

## 7. Testing requirements

### 7.1 Regression tests (must all pass unchanged)

- All v1.0.12 proxy and budget guard tests
- All v1.0.13 error forwarding tests
- All v1.1.0 Anthropic sync tests
- All v1.2.0 OpenAI sync tests and multi-provider tests

### 7.2 New tests for v1.3.0

**Subscription CRUD tests:**
- POST /api/subscriptions → creates entry → verify it appears in GET /api/subscriptions
- PUT /api/subscriptions/:id → updates cost → verify change reflected
- DELETE /api/subscriptions/:id → removes entry
- POST with duplicate service_name → warning returned but creation still allowed
- POST with negative cost → rejected
- POST with zero cost → allowed (free tier subscriptions exist)
- Proration: subscription starting mid-month → monthly cost prorated correctly

**Overview API tests:**
- GET /api/overview with sync + proxy + subscriptions → correct totals, no double-counting
- GET /api/overview with sync active and proxy traffic to same provider → sync cost used, proxy cost excluded from total
- GET /api/overview with only proxy data (no sync) → proxy cost included
- GET /api/overview with only subscriptions (no sync, no proxy) → only subscription costs shown
- GET /api/overview with no data at all → returns zeros, not errors
- GET /api/overview/timeline returns correct daily breakdown with both tracked and subscription segments
- GET /api/overview/by-model returns models from all providers sorted by spend
- GET /api/overview/by-source correctly categorizes each cost as "sync", "proxy", or "manual"

**Deduplication tests (critical):**
- Insert sync records for Anthropic ($50) AND proxy logs for Anthropic ($48) → overview shows $50 (sync wins)
- Insert proxy logs for Mistral ($5, no sync available) → overview shows $5 (proxy used as fallback)
- Insert sync for Anthropic AND subscription "Claude Pro" → both appear (they're different costs — API vs subscription)
- Remove sync key for Anthropic → historical sync data used for past months, $0 for future
- Add sync key back → new data flows, historical gap remains until backfilled

**Dashboard tests:**
- Overview page loads with all three data sources visible
- Data source indicators (solid dot, dashed dot, half dot) render correctly
- Provider filter works
- Daily chart shows tracked vs subscription segments
- First-time wizard appears when no data sources configured
- Subscription presets auto-fill correctly

### 7.3 Manual verification

1. Run `npm run dev:all`
2. Overview page loads as the landing page
3. Add a manual subscription (Cursor Pro $20) → verify it appears in Overview total
4. Verify daily chart shows subscription as a separate visual segment
5. With both Anthropic sync and a subscription active → verify totals add correctly (no double-count between sync and subscription, both are legitimate separate costs)
6. With Anthropic sync active AND proxy traffic to Anthropic → verify Overview shows sync cost only (not sync + proxy)
7. Verify existing Projects/Logs pages work identically to v1.2.0
8. Verify existing Sync page works identically to v1.2.0
9. First-time user experience: clear all data → load Overview → verify setup wizard appears
10. Edit a subscription amount → verify Overview updates immediately
11. Delete a subscription → verify it disappears from Overview
12. Verify subscription presets offer common services at correct prices

---

## 8. What this release does NOT include

| Feature | Deferred to | Why |
|---------|-------------|-----|
| Per-provider budgets based on unified data | v1.4.0 | Budget system needs rethinking with three data sources |
| Network monitor (per-app attribution) | v1.5.0 | Separate feature, separate risk |
| Subscription price auto-update | Future | Would require scraping vendor pricing pages — fragile and unreliable |
| Currency conversion | Future | Low priority for v1 — most AI services bill in USD |
| Export/share monthly report | v1.7.0 | Part of AI Wrapped feature |
| Drill-down from overview to proxy request details | v1.3.1 patch | Nice-to-have, not blocking for initial release |

---

## 9. Release checklist

**Before development:**
- [ ] Verify all v1.2.0 tests pass on current main branch
- [ ] Confirm current pricing for subscription presets (Cursor, Copilot, ChatGPT, Claude Pro)

**During development:**
- [ ] New migration creates subscriptions table (no existing tables modified)
- [ ] Subscription CRUD API routes implemented
- [ ] Subscription presets with current pricing included
- [ ] Overview API routes implement deduplication logic correctly
- [ ] Overview page designed and implemented with all sections
- [ ] Data source indicators (solid/dashed/half dot) implemented
- [ ] First-time setup wizard implemented
- [ ] Navigation updated: Overview is now the landing page
- [ ] Proration logic handles mid-month starts and cancellations

**Testing:**
- [ ] All regression tests pass (v1.0.12 through v1.2.0)
- [ ] All new subscription tests pass
- [ ] All deduplication tests pass (most critical)
- [ ] All overview API tests pass
- [ ] Manual verification steps 1-12 completed
- [ ] Existing pages (Projects, Logs, Sync) work identically

**Release:**
- [ ] Version bumped to 1.3.0 in package.json
- [ ] CHANGELOG.md updated
- [ ] README updated: "See your complete AI budget — API spend tracked automatically, subscriptions added manually"
- [ ] Git tag created: v1.3.0
- [ ] npm publish
- [ ] Smoke test: add sync keys + subscriptions → overview shows unified total

---

## 10. Why this release matters for the product

v1.1.0 and v1.2.0 proved the technology works. v1.3.0 proves the product works.

Before v1.3.0, LLM Observer is a collection of separate tracking features. After v1.3.0, it's a unified AI spending dashboard. This is the release you put in the README screenshot. This is the release you demo to people. This is the release that answers the question every developer is asking: "How much am I actually spending on AI?"

The answer is one number on one page, with a clear breakdown of where every dollar goes.

---

## 11. Changelog

```markdown
## [1.3.0] - 2026-XX-XX

### Added
- **Unified Overview dashboard** — One page showing your complete AI budget:
  API spend (tracked automatically) + subscriptions (added manually)
- **Manual subscription tracking** — Add Cursor Pro, GitHub Copilot, ChatGPT Plus,
  and other AI subscriptions to see your full monthly AI cost
- Pre-populated subscription templates for 10+ common AI services
- Smart deduplication: sync data takes priority over proxy data for the same provider
- Data source indicators showing where each cost number comes from
- Day-over-day and week-over-week spending comparisons
- First-time setup wizard for new users
- Subscription proration for partial months

### Changed
- Dashboard landing page is now the unified Overview (previously Projects)
- Navigation order: Overview → Projects → Logs → Sync → Settings

### Fixed
- None

### Breaking changes
- None (Projects, Logs, and Sync pages work identically to v1.2.0)
```