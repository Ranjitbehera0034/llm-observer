# LLM Observer — Release v1.8.0 Complete Plan

## AI Wrapped — Monthly & Yearly Spending Reports

**Version type:** Minor (new feature, fully backward compatible)
**Previous release:** v1.7.0 (Budget Guard v2)
**Estimated effort:** 3-4 days
**Risk level:** Low (read-only feature — queries existing data, doesn't modify anything)

---

## 1. What this release does — in plain language

Every developer asks the same question at the end of the month: "How much did I spend on AI?" Today they open 3-4 different dashboards (Anthropic console, OpenAI platform, Cursor billing, etc.) and manually add numbers. Or they look at LLM Observer's Overview page and try to remember what changed.

After v1.8.0, LLM Observer generates a complete spending report for any month or year — one page, with insights the developer didn't know they wanted:

- "You made 14,293 AI requests in March 2026"
- "Total spend: $147.40 — $97 tracked API + $50 subscriptions"
- "Most expensive day: March 14 ($12.80) — a Friday"
- "Most used model: Claude Sonnet 4 (67% of requests)"
- "Top app: Cursor (68% of spend)" (if network monitor was enabled)
- "Potential savings: $43/month if you switch autocomplete from Opus to Haiku"
- "Your spend increased 18% vs February"

The report generates a shareable visual card that the developer can download and post. This is the viral loop — developers love comparing AI spending stats the same way they share Spotify Wrapped.

---

## 2. Where the data comes from

AI Wrapped is a pure read-only feature. It queries existing tables and computes aggregations. It creates no new data — it only presents what's already collected across five releases:

| Data point | Source table | Available since |
|------------|-------------|-----------------|
| API spend by provider | usage_records, daily_costs | v1.1.0 (Anthropic), v1.2.0 (OpenAI) |
| API spend by model | usage_records | v1.1.0 |
| Token counts (input, output, cached) | usage_records | v1.1.0 |
| Request counts | usage_records | v1.1.0 |
| Subscription costs | subscriptions | v1.3.0 |
| Per-app attribution | app_connections (correlated) | v1.5.0 |
| Budget alerts fired | alerts | v1.4.0 |
| Proxy request details | request_logs | v1.0.x |

The more features the user has enabled, the richer the report. A user with only Anthropic sync gets a basic report. A user with both providers, subscriptions, and network monitor gets a comprehensive one.

---

## 3. Report structure — section by section

### 3.1 Headline summary

The top of the report shows the big numbers:

**"March 2026 — Your AI Spending Report"**

- Total spend: $147.40
- Total requests: 14,293
- Total tokens processed: 28.4 million
- Days active: 23 of 31 (you took 8 days off from AI)

### 3.2 Spend breakdown

**By source:**
- Tracked API: $97.40 (66%)
- Subscriptions: $50.00 (34%)

**By provider (API only):**
- Anthropic: $64.20 (66% of API spend)
- OpenAI: $33.20 (34% of API spend)

**By model (top 5):**
1. claude-sonnet-4: $38.40 (39%) — 8,240 requests
2. gpt-4o: $22.10 (23%) — 3,890 requests
3. claude-haiku-3.5: $12.60 (13%) — 2,100 requests
4. claude-opus-4: $8.50 (9%) — 420 requests
5. gpt-4o-mini: $6.20 (6%) — 1,643 requests

### 3.3 Trends and patterns

**Daily spend chart:** A mini bar chart showing each day of the month. Color-coded: green for below-average days, red for above-average.

**Most expensive day:** "March 14 (Friday) — $12.80. This was 2.8x your daily average of $4.56."

**Cheapest day:** "March 2 (Sunday) — $0.45"

**Day of week pattern:** "You spend the most on Thursdays ($6.20 avg) and the least on Sundays ($1.10 avg)."

**Month-over-month:** "Total spend increased 18% vs February ($124.80). API spend was up 22%, subscriptions unchanged."

### 3.4 Per-app breakdown (if network monitor was enabled)

**"Where your AI dollars went:"**
1. Cursor: $42.80 (44%) — 9,800 connections
2. Claude Code: $28.40 (29%) — 2,100 connections
3. VS Code (Continue): $18.20 (19%) — 1,890 connections
4. Node.js scripts: $8.00 (8%) — 503 connections

If the network monitor was not enabled or was enabled partway through the month, show: "Per-app breakdown available for [N] of 31 days this month. Enable per-app tracking in Settings for a complete breakdown next month."

### 3.5 Efficiency insights

This is the section that provides actionable value, not just numbers.

**Insight 1 — Model optimization opportunity:**
"62% of your Claude Opus requests had fewer than 200 output tokens. These short responses suggest simple tasks that could use Haiku instead. Potential savings: ~$43/month."

How this is calculated: Look at usage_records for claude-opus-4. If the average output tokens per request is low (below a threshold like 500), the tasks are likely simple. Calculate: (opus_requests × opus_cost_per_request) - (opus_requests × haiku_cost_per_request) = savings.

**Insight 2 — Cache efficiency:**
"Your Anthropic cache hit rate was 34%. Improving cache usage could reduce input token costs by ~$8/month."

How this is calculated: cache_read_tokens / (cache_read_tokens + input_tokens) = cache hit rate. Higher is better. Compare to a target of 50%+.

**Insight 3 — Subscription value assessment:**
"Your Cursor Pro subscription costs $20/month. Based on network monitoring, Cursor made ~15,000 API connections this month. Estimated equivalent API cost: ~$42/month. Your subscription saves you ~$22/month."

How this is calculated: Use connection count × average cost per connection from BYOK tools.

**Insight 4 — Budget compliance:**
"You exceeded your daily budget 3 times this month (March 7, 14, 22). Consider raising your limit from $5 to $7 to reduce false alarms while still catching genuine spikes."

How this is calculated: Count budget_exceeded alerts from the alerts table for this month.

### 3.6 Year-in-review (for yearly report)

Same structure as monthly but aggregated over 12 months. Additional sections:

- "Total AI spend in 2026: $1,487"
- "Monthly trend: started at $89/month in January, peaked at $167 in October, ended at $142 in December"
- "Models used: 12 different models across 3 providers"
- "If you'd used the cheapest appropriate model for every request, you could have saved ~$340 (23%)"

---

## 4. The shareable card

### 4.1 What it looks like

A visually clean card (1200×630 pixels — optimized for Twitter/LinkedIn sharing) with:

- LLM Observer branding (small, non-intrusive)
- Month/year title
- 3-4 headline stats (total spend, total requests, top model, top app)
- A mini daily spend sparkline
- One highlight insight ("Saved $43 this month by following model recommendations")

The card is generated as an SVG (rendered in the dashboard) that can be downloaded as PNG.

### 4.2 What it does NOT contain

The card is designed to be shareable publicly. It must NOT contain:

- API key identifiers or fragments
- Organization names or IDs
- Exact IP addresses or process paths
- Project names that might be confidential
- Prompt content or response content
- Exact timestamps of specific requests
- Any data that could identify the user's employer or clients

It contains ONLY aggregate numbers: total spend, request count, model names (public information), app names (generic — "Cursor" not "Acme Corp's Cursor instance"), and percentages.

### 4.3 Preview before sharing

Before the user downloads the card, show a preview: "This is what your AI Wrapped card will look like. Review it before sharing." The user can toggle individual stats on/off if they want to hide specific numbers (e.g., hide total spend but show model breakdown).

---

## 5. Proposed changes — component by component

### 5.1 Database changes

**No new tables needed.** AI Wrapped is purely a read-only aggregation over existing data. 

One small addition: a preferences record for report settings.

**New table: `wrapped_preferences`**

| Column | Purpose |
|--------|---------|
| id (primary key) | Always 1 (singleton) |
| show_total_spend | Whether the card shows total dollar amount (default: true) |
| show_per_app | Whether the card shows per-app breakdown (default: true) |
| show_subscriptions | Whether the card includes subscription costs (default: true) |
| show_insights | Whether the card includes the savings insight (default: true) |
| updated_at | When preferences were last changed |

### 5.2 Report generation engine

**New module: wrapped report generator.**

A stateless function that takes a time period (month or year) and returns a structured report object. It performs multiple database queries, aggregates the results, and computes insights.

**Query sequence:**

1. **Total spend:** Sum daily_costs for the period (by provider). Add prorated subscription costs.
2. **By model:** Group usage_records by model, sum tokens and compute costs.
3. **Request counts:** Sum num_requests from usage_records.
4. **Daily breakdown:** Group usage_records by date for the sparkline chart.
5. **Peak and trough days:** Find max and min daily spend.
6. **Day-of-week pattern:** Average daily spend grouped by weekday.
7. **Per-app attribution:** If app_connections data exists, run the correlation engine from v1.5.0 for the full period.
8. **Month-over-month comparison:** Query the previous period's totals for comparison.
9. **Budget alerts count:** Count alerts from the alerts table for this period.
10. **Insights generation:** Run the four insight algorithms (model optimization, cache efficiency, subscription value, budget compliance).

**Performance consideration:** These are aggregate queries over potentially large datasets (a month of per-minute usage data). Ensure the SQLite indexes from earlier releases cover these query patterns. If a monthly report takes more than 3 seconds to generate, consider pre-computing daily aggregates.

### 5.3 Insights engine

**Insight 1 — Model optimization:**

Algorithm:
1. For each expensive model (Opus, GPT-4), find the average output tokens per request
2. If avg_output < 500, classify as "likely simple tasks"
3. Find the cheapest model in the same provider's lineup (Haiku, GPT-4o-mini)
4. Calculate: savings = requests × (expensive_cost_per_request - cheap_cost_per_request)
5. Only show if savings > $5/month (don't bother for trivial amounts)

**Insight 2 — Cache efficiency:**

Algorithm:
1. Sum cache_read_tokens and total input_tokens across the period
2. cache_hit_rate = cache_read_tokens / (cache_read_tokens + input_tokens)
3. If cache_hit_rate < 0.3, suggest improvement
4. Estimate savings: additional cacheable tokens × input_price_saved
5. Only show if Anthropic sync is active (OpenAI doesn't expose cache data the same way)

**Insight 3 — Subscription value:**

Algorithm:
1. For each subscription (from subscriptions table), check if app_connections data exists
2. If yes: count connections from that app to AI providers
3. Estimate API equivalent: connections × average_cost_per_connection (derived from BYOK apps)
4. Compare: if API equivalent > subscription cost → "Good value"
5. If API equivalent < subscription cost → "Consider downgrading or cancelling"
6. Only show if network monitor was enabled for at least 50% of the month

**Insight 4 — Budget compliance:**

Algorithm:
1. Count budget_exceeded alerts from the alerts table for this period
2. If count > 3: "You exceeded your budget frequently — consider raising the limit"
3. If count = 0 and average spend is < 50% of limit: "Your budget is generous — consider lowering it to get earlier warnings"
4. Only show if at least one budget is configured

### 5.4 API routes

**New routes:**

`GET /api/wrapped/monthly?month=2026-03` — Returns the full structured report for a specific month. If the month is the current month, data is up to today.

`GET /api/wrapped/yearly?year=2026` — Returns the yearly report. If the year is current, data is up to today.

`GET /api/wrapped/card?period=2026-03&format=svg` — Returns the shareable card as SVG. Respects wrapped_preferences for which stats to show/hide.

`GET /api/wrapped/card?period=2026-03&format=png` — Returns the shareable card as PNG (rendered from SVG server-side if possible, or client-side in the dashboard).

`GET /api/wrapped/preferences` — Returns current card preferences.

`PUT /api/wrapped/preferences` — Updates card preferences (which stats to show/hide).

`GET /api/wrapped/available-periods` — Returns a list of months/years that have data available. This prevents the user from requesting a report for a month with no data.

### 5.5 Dashboard changes

**New "Wrapped" page in the navigation.**

`[Overview] [Apps] [Projects] [Logs] [Sync] [Wrapped ★NEW] [Settings]`

**Wrapped page layout:**

**Period selector at top:**
A row of month pills: "Jan Feb Mar Apr ..." with the current month highlighted. Clicking a month generates that month's report. A "Year" toggle switches to yearly view.

**Report body:**
Renders the full report as described in Section 3 — headline numbers, breakdowns, charts, insights. This is the detailed view the user reads on their machine.

**Shareable card section at bottom:**
Shows a preview of the card. Toggle switches for each stat (show/hide). "Download as PNG" button. "Copy to clipboard" button (copies the PNG to system clipboard for quick paste into Twitter/Slack/LinkedIn).

**Empty state:**
If the selected month has no data: "No AI usage data for [month]. Reports are available for months where at least one provider sync or proxy request was recorded."

**Partial data state:**
If data is only available for part of the month (e.g., user added their Anthropic key on March 15): "This report covers March 15-31. For a complete monthly report, keep your sync keys active for the full month."

---

## 6. Positive scenarios

### 6.1 Developer discovers they're spending more than they thought

Developer opens the March report. Headline: "$147.40." They expected around $80-90 (that's what they pay attention to on the API billing pages). The extra $50 is subscriptions they forgot to count (Cursor Pro + Copilot + ChatGPT Plus). This is the first time they've seen their TRUE total AI cost. They cancel ChatGPT Plus (barely used it) and save $20/month going forward.

### 6.2 The model optimization insight saves real money

The report shows: "62% of your Claude Opus requests had fewer than 200 output tokens. Potential savings: ~$43/month by switching to Haiku for these tasks." Developer checks their Continue extension settings — it was defaulting to Opus for autocomplete. They switch to Haiku. Next month's report shows: "Spend decreased 28%. Opus usage dropped from 420 to 85 requests. Haiku handled the remaining 335 requests at 95% lower cost."

### 6.3 The shareable card goes viral

Developer shares their March AI Wrapped card on Twitter: "I spent $147 on AI tools this month. Cursor was 44% of my spend. Claude Sonnet was my most-used model. LLM Observer found me $43/month in savings."

Other developers see it and think: "Wait, I should know how much I'm spending too." They install LLM Observer. Organic growth.

### 6.4 Team lead uses the report for budget planning

Team lead generates yearly reports for 3 team members. Presents to management: "Our team spent $4,200 on AI in 2026. Here's the breakdown by tool and provider. Here's where we optimized. Here's the projected 2027 budget based on growth trends."

---

## 7. Negative scenarios

### 7.1 Report for a month with sparse data looks empty

Developer installed LLM Observer on March 28. They request the March report. It shows 3 days of data with $8.40 total spend. The report looks underwhelming — no meaningful trends, no insights.

**Mitigation:** The report header shows: "Report covers March 28-31 (3 days)." Insights that require more data are hidden with a note: "Model optimization insights require at least 7 days of data. Check back next month for a complete analysis."

Don't show misleading insights from insufficient data. A "62% of Opus requests were short" insight based on 5 requests is noise, not signal.

### 7.2 Shareable card accidentally reveals confidential information

Developer shares the card without reviewing it. The card mentions a specific project name or workspace that's confidential.

**Mitigation:** The card never shows project names, workspace names, organization names, or API key identifiers. It only shows generic categories: model names (public), app names (generic: "Cursor", "Claude Code"), and aggregate numbers. The preview step before download gives the user a chance to review and toggle off any stat they don't want shared.

### 7.3 Savings insight is misleading

The report says: "Switch Opus to Haiku for simple tasks — save $43/month." The developer tries it and finds Haiku's quality is too low for their autocomplete use case. They switch back.

**Mitigation:** Frame insights as suggestions, not commands. Use language like: "Potential savings: ~$43/month if short Opus requests can use Haiku. Quality may vary — test with your specific use case." Add a caveat: "Savings estimates assume the cheaper model produces acceptable results. Your experience may differ."

### 7.4 Report generation is slow for heavy users

A developer with 50,000 requests/month triggers a report. The queries take 10+ seconds because they're aggregating large datasets.

**Mitigation:**
1. Show a loading indicator: "Generating your March report..."
2. Cache the generated report for 1 hour (invalidate if new data arrives)
3. If generation exceeds 5 seconds, return partial results (headline numbers first, insights computed in background)
4. Long-term: pre-compute daily aggregates that monthly reports can query instead of raw per-minute data

### 7.5 Year-end report for a user who started mid-year

Developer installed LLM Observer in August. They request the 2026 yearly report. It shows only 5 months of data.

**Mitigation:** Report header: "2026 Year in Review (August - December, 5 months)." All comparisons and averages are based on the available months, not 12. Monthly trend chart shows data starting from August with blank space for Jan-Jul (clearly marked as "no data").

---

## 8. Testing requirements

### 8.1 Regression tests (must all pass unchanged)

- All tests from v1.0.12 through v1.7.0
- No existing features are modified in this release

### 8.2 New tests for v1.8.0

**Report generation tests:**
- Generate monthly report with full data (sync + proxy + subscriptions + app connections) → verify all sections populated
- Generate monthly report with sync data only (no proxy, no subscriptions, no apps) → verify API sections populated, others show appropriate empty state
- Generate monthly report with zero data → verify empty state message, no errors
- Generate report for current month (partial) → verify it shows data up to today
- Generate report for future month → verify empty state
- Generate yearly report → verify it aggregates 12 months correctly
- Generate yearly report for partial year → verify header shows actual coverage

**Insights tests:**
- Model optimization: 100 Opus requests averaging 150 output tokens → suggest Haiku, calculate savings
- Model optimization: 100 Opus requests averaging 2,000 output tokens → no suggestion (complex tasks)
- Model optimization: 3 Opus requests total → no suggestion (insufficient data)
- Cache efficiency: 40% hit rate → no suggestion (above 30% threshold)
- Cache efficiency: 15% hit rate → suggest improvement, estimate savings
- Subscription value: Cursor Pro $20/month, 15,000 connections, equivalent API cost $42 → "Good value"
- Subscription value: Cursor Pro $20/month, 500 connections, equivalent API cost $6 → "Consider downgrading"
- Budget compliance: 5 exceeded alerts → suggest raising limit
- Budget compliance: 0 alerts, average spend 30% of limit → suggest lowering limit

**Card generation tests:**
- Generate SVG card → valid SVG returned, contains headline stats
- Card does NOT contain: API key fragments, org names, workspace IDs, exact timestamps
- Card respects preferences: hide total spend → total spend not in card
- Card with all stats toggled off → minimal card with just the period title

**API route tests:**
- GET /api/wrapped/monthly?month=2026-03 → returns structured report
- GET /api/wrapped/monthly with no month param → defaults to current month
- GET /api/wrapped/yearly?year=2026 → returns yearly report
- GET /api/wrapped/available-periods → returns list of months with data
- GET /api/wrapped/card?period=2026-03&format=svg → returns SVG
- PUT /api/wrapped/preferences → updates successfully
- GET /api/wrapped/preferences → returns current preferences

### 8.3 Manual verification

1. Open Wrapped page → verify period selector shows months with data
2. Click a month with full data → verify complete report renders (all sections)
3. Click a month with partial data → verify partial coverage noted in header
4. Click a month with no data → verify empty state
5. Check the insights section → verify suggestions are reasonable and caveated
6. Preview the shareable card → verify it shows clean stats without sensitive data
7. Toggle off "show total spend" → verify card updates without that stat
8. Download card as PNG → verify the file is valid and looks correct
9. Verify report generates in under 5 seconds for a month with moderate data
10. Verify all existing features unchanged

---

## 9. What this release does NOT include

| Feature | Deferred to | Why |
|---------|-------------|-----|
| Email delivery of monthly reports | Future | Requires email infrastructure |
| Automatic monthly report generation (cron) | Future | User should discover and control the feature first |
| Team reports (aggregate across multiple users) | Future | Single-user focus for now |
| PDF export of full report | Future | SVG/PNG card covers the shareable use case |
| Comparison with industry benchmarks | Future | Would need aggregate anonymized data from other users |
| Smart recommendations beyond model switching | Future | E.g., "You should batch these requests" — complex to implement well |

---

## 10. Release checklist

**Before development:**
- [ ] Verify all v1.7.0 tests pass on current main branch
- [ ] Confirm you have at least one month of sync data for testing with real numbers

**During development:**
- [ ] Report generator queries all relevant tables (usage_records, daily_costs, subscriptions, app_connections, alerts)
- [ ] All four insight algorithms implemented with minimum data thresholds
- [ ] Shareable card SVG generation implemented
- [ ] Card excludes all sensitive/identifying information
- [ ] Card preview with toggle controls implemented
- [ ] Wrapped page with period selector, report body, and card section
- [ ] Empty state and partial data states handled gracefully
- [ ] Report caching for performance

**Testing:**
- [ ] All regression tests pass (v1.0.12 through v1.7.0)
- [ ] All new report generation tests pass
- [ ] All insight algorithm tests pass (including edge cases with insufficient data)
- [ ] Card privacy tests pass (no sensitive data leaked)
- [ ] Manual verification steps 1-10 completed

**Release:**
- [ ] Version bumped to 1.8.0 in package.json
- [ ] CHANGELOG.md updated
- [ ] README updated: "Get your monthly AI Wrapped — see where every dollar went"
- [ ] Git tag created: v1.8.0
- [ ] npm publish
- [ ] Smoke test: generate report → review insights → download card → verify content

---

## 11. Why this release matters for growth

v1.1.0 through v1.7.0 built a useful product. v1.8.0 builds a shareable product.

The difference matters. A useful product grows linearly (one user tells one friend). A shareable product grows exponentially (one user posts a card, 100 developers see it, 10 install LLM Observer, 3 of those share their own cards).

Spotify Wrapped works because it gives people something to talk about. AI Wrapped works the same way — developers are naturally curious and competitive about their tool usage. "I spent $147 on AI this month" starts a conversation. "Claude Sonnet was my most-used model" starts a debate. "I saved $43 by switching from Opus" starts a recommendation chain.

The card is the distribution mechanism. The insights are the value. The dashboard is where users come back every month.

---

## 12. Changelog

```markdown
## [1.8.0] - 2026-XX-XX

### Added
- **AI Wrapped** — Monthly and yearly AI spending reports with insights
- Shareable visual card optimized for Twitter/LinkedIn (1200×630px)
- Four insight algorithms: model optimization opportunities, cache efficiency,
  subscription value assessment, budget compliance review
- Per-app breakdown in reports (when network monitor is enabled)
- Period selector for browsing historical reports
- Card privacy controls (toggle individual stats on/off before sharing)
- Report caching for fast repeated access
- Day-of-week spending pattern analysis
- Month-over-month comparison

### Changed
- Navigation adds "Wrapped" page

### Fixed
- None

### Breaking changes
- None
```