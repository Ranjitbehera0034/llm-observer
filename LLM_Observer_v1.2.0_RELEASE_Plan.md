# LLM Observer — Release v1.2.0 Complete Plan

## OpenAI Usage API Sync

**Version type:** Minor (new feature, fully backward compatible)
**Previous release:** v1.1.0 (Anthropic Usage API Sync)
**Estimated effort:** 3-4 days
**Risk level:** Low-Medium (same pattern as v1.1.0, lower risk due to proven architecture)

---

## 1. What this release does — in plain language

v1.1.0 added Anthropic tracking. This release adds OpenAI. After v1.2.0, a developer who uses both Claude and GPT models across various tools can see ALL their API spend in a single dashboard — without changing anything in their IDEs or applications.

The sync infrastructure (manager, encryption, database tables, dashboard page) already exists from v1.1.0. This release adds a second poller for OpenAI and updates the existing Sync page to show both providers.

---

## 2. What the OpenAI API actually provides

### 2.1 Endpoints we use

**Usage report (completions):** `GET /v1/organization/usage/completions`
Returns token counts per time bucket — input tokens, output tokens, cached input tokens, number of requests. Supports grouping by model, project_id, user_id, and api_key_id. Supports bucket widths of 1m, 1h, or 1d. Time parameters use Unix timestamps in seconds (NOT ISO 8601 like Anthropic).

**Usage report (other product types):** OpenAI exposes separate endpoints for different product types:
- `/v1/organization/usage/completions` — chat completions and responses
- `/v1/organization/usage/embeddings` — embedding requests
- `/v1/organization/usage/images` — DALL-E image generation
- `/v1/organization/usage/audio` — Whisper transcription and TTS

For v1.2.0, we start with completions only (this is 90%+ of most developers' spend). Image, audio, and embedding tracking can be added in a future patch.

**Costs report:** `GET /v1/organization/costs`
Returns daily spend in USD. Supports grouping by project_id and line_item. Bucket width is only 1d (daily). Returns amount as an object with currency ("usd") and a numeric value.

**Organization info:** There is no direct equivalent to Anthropic's `/v1/organizations/me`. To validate the key, we list admin keys using `GET /v1/organization/admin_api_keys?limit=1`. If this returns 200, the key is valid. If 401, the key is invalid.

### 2.2 Authentication — different from Anthropic

OpenAI uses `Authorization: Bearer <key>` (not `x-api-key`). No version header required. No additional headers needed beyond Content-Type.

Admin keys are created at: platform.openai.com/settings/organization/admin-keys. Only Organization Owners can create Admin keys. The key prefix is `sk-admin-` (not `sk-ant-admin` like Anthropic).

### 2.3 Critical API differences from Anthropic

| Aspect | Anthropic | OpenAI |
|--------|-----------|--------|
| Auth header | `x-api-key: <key>` | `Authorization: Bearer <key>` |
| Version header | `anthropic-version: 2023-06-01` (required) | Not required |
| Admin key prefix | `sk-ant-admin...` | `sk-admin-...` |
| Admin key creation URL | console.anthropic.com → Settings → Admin Keys | platform.openai.com/settings/organization/admin-keys |
| Who can create admin keys | Organization admins | Organization owners only |
| Time format in requests | ISO 8601 (`2026-03-22T00:00:00Z`) | Unix timestamp in seconds (`1711324800`) |
| Usage endpoint | `/v1/organizations/usage_report/messages` | `/v1/organization/usage/completions` |
| Cost endpoint | `/v1/organizations/cost_report` | `/v1/organization/costs` |
| "organizations" vs "organization" | Plural: `/v1/organizations/...` | Singular: `/v1/organization/...` |
| Group by options | model, workspace_id, api_key_id, service_tier | model, project_id, user_id, api_key_id |
| Pagination cursor field | `next_page` | `next_page` (same) |
| Cost bucket width | 1d (daily) | 1d only (same) |
| Connection test endpoint | `GET /v1/organizations/me` | `GET /v1/organization/admin_api_keys?limit=1` |
| Data delay | ~5 minutes | Near real-time |

These differences mean we CANNOT just copy-paste the Anthropic poller and change the URL. The request construction, response parsing, and time handling are all different.

---

## 3. What this release tracks and what it doesn't

### 3.1 Fully tracked (billed to user's OpenAI account)

| Tool | Why it's tracked |
|------|-----------------|
| Custom scripts using OpenAI SDK | Uses the user's API key |
| Continue extension (VSCode/IntelliJ) with OpenAI key | User configures their own key |
| Aider with OpenAI backend | User configures their own key |
| Cursor BYOK — Chat/Agent with OpenAI models | When user enters their OpenAI key, some requests use it |
| Any app calling the OpenAI API with the user's key | Direct API usage |
| LLM Observer's own proxy (when forwarding to OpenAI) | Uses the user's key |

### 3.2 NOT tracked

| Tool | Why not |
|------|---------|
| Cursor subscription (all plans) | Uses Cursor's own OpenAI keys |
| GitHub Copilot | Uses GitHub's own API keys and infrastructure |
| ChatGPT Plus/Pro/Teams | This is a subscription, not API usage |
| ChatGPT desktop/mobile app | Subscription-based |
| Any tool using its own OpenAI key | Their account, not yours |

### 3.3 OpenAI-specific nuance: Projects

OpenAI has a concept of "Projects" within an organization. Each project can have its own API keys and rate limits. The Usage API supports `group_by=project_id`, which means we can show the user a breakdown by project — something Anthropic doesn't offer.

For v1.2.0, we group by model (consistent with the Anthropic view). Project-level breakdown is a nice-to-have for a future patch release.

---

## 4. Proposed changes — component by component

### 4.1 Database changes

**No new migration needed.** The `usage_records`, `usage_sync_configs`, and `poll_checkpoints` tables from v1.1.0 already support multiple providers via the `provider` column. OpenAI data is stored in the same tables with `provider = 'openai'`.

The only addition: a schema version update in `_db_meta` to '1.2.0' for tracking purposes. This can go in a minimal migration file or be handled at startup.

### 4.2 OpenAI Poller

**New module alongside the Anthropic poller.**

The poller follows the same lifecycle pattern as the Anthropic poller (managed by UsageSyncManager), but with OpenAI-specific request construction and response parsing.

**What happens on each poll cycle:**

**Phase 1 — Determine time range.** Read the checkpoint from `poll_checkpoints` for provider 'openai'. If no checkpoint, use 24 hours ago. Convert to Unix timestamps (OpenAI requires seconds, not ISO 8601).

**Phase 2 — Fetch completions usage.** Call `GET /v1/organization/usage/completions` with parameters:
- `start_time` = checkpoint Unix timestamp
- `bucket_width` = "1d"
- `group_by` = ["model"]
- Auth: `Authorization: Bearer <admin-key>`

Handle pagination: if `has_more` is true, use `next_page` cursor in subsequent requests.

For each usage bucket, upsert into `usage_records` with provider='openai'. Map OpenAI's field names to our schema:
- `input_tokens` → input_tokens
- `output_tokens` → output_tokens
- `input_cached_tokens` → cache_read_tokens
- `num_model_requests` → num_requests
- `model` → model
- `project_id` → workspace_id (we reuse this column; it serves the same conceptual purpose)

**Phase 3 — Fetch costs.** Call `GET /v1/organization/costs` with parameters:
- `start_time` = checkpoint Unix timestamp
- `bucket_width` = "1d"
- `group_by` = ["line_item"]

Store daily cost in `daily_costs` table with provider='openai'. Extract `amount.value` (USD) from the response.

**Phase 4 — Update checkpoint.** Write the latest bucket's end_time to poll_checkpoints for provider 'openai'.

**Phase 5 — Schedule next poll.** Wait for configured interval (default 60 seconds), then repeat.

### 4.3 Key validation and onboarding flow

**New API route: `POST /api/sync/providers/openai/key`**

Same flow as Anthropic but with OpenAI-specific validation:

1. **Client-side prefix check:**
   - Starts with `sk-admin-` → proceed
   - Starts with `sk-proj-` → reject: "This is a project API key, not an Admin key. Admin keys start with sk-admin- and are created at platform.openai.com/settings/organization/admin-keys."
   - Starts with `sk-` (but not `sk-admin-` or `sk-proj-`) → reject: "This appears to be a regular OpenAI API key. LLM Observer needs an Admin API key. Create one at platform.openai.com/settings/organization/admin-keys. Note: only Organization Owners can create Admin keys."
   - Starts with `sk-ant-` → reject: "This is an Anthropic key, not an OpenAI key. To add your Anthropic key, use the Anthropic card instead."

2. **Server-side connection test.** Call `GET /v1/organization/admin_api_keys?limit=1` with the provided key.
   - 200 → key is valid, proceed to encrypt and store
   - 401 → reject: "This key was rejected by OpenAI. It may be expired, revoked, or invalid."
   - 403 → reject: "Access denied. Only Organization Owners can use Admin API keys. Check your role at platform.openai.com/settings/organization/general."

3. **Encrypt and store.** Same encryption flow as Anthropic. Store in `usage_sync_configs` with id='openai'.

4. **Start the poller.** First poll fetches last 24 hours.

### 4.4 Dashboard changes

**Modify the existing Sync page (not a new page).**

The Sync page currently shows one provider card (Anthropic). After v1.2.0, it shows two cards side by side: Anthropic and OpenAI. Each card has its own status, setup flow, and data display.

**New additions to the Sync page:**

**Provider selector at top:** "Showing: All providers | Anthropic | OpenAI" — lets the user filter the charts and tables by provider.

**Aggregated view (default):** Today's total spend combines both providers. The daily cost chart shows stacked bars (Anthropic in one color, OpenAI in another). The model breakdown table shows both Claude and GPT models together, sorted by spend.

**Per-provider view (filtered):** When the user selects a specific provider, the page shows only that provider's data. Same layout as v1.1.0 but filtered.

**OpenAI provider card:** Same four states as the Anthropic card (not configured, active, error, zero usage). The onboarding flow guides the user to platform.openai.com/settings/organization/admin-keys.

### 4.5 Existing API route modifications

**Modify: `GET /api/sync/usage/today`**
Currently returns only Anthropic data. After v1.2.0, it returns aggregated data from all active providers, plus a per-provider breakdown.

Response shape changes from:
```
{ total: 4.20, models: [...] }
```
To:
```
{ total: 6.42, providers: { anthropic: 4.20, openai: 2.22 }, models: [...] }
```

This is a response shape change, but since the Sync API routes were brand new in v1.1.0 and have no external consumers yet, this is safe.

**Modify: `GET /api/sync/usage/daily`**
Same change — aggregate across providers, include provider breakdown.

**Modify: `GET /api/sync/usage/by-model`**
Same change — include both Claude and GPT models in the response.

**New: `GET /api/sync/providers`**
Returns a list of all configured providers with their status. Used by the dashboard to render the provider cards.

### 4.6 UsageSyncManager modification

The sync manager currently starts only the Anthropic poller. After v1.2.0, it starts pollers for all providers with active keys. On startup, it reads all rows from `usage_sync_configs` where status is "active" and starts the corresponding poller for each.

---

## 5. Error handling — OpenAI-specific scenarios

All the general error handling from v1.1.0 applies (backoff, circuit breaker, crash recovery). These are the OpenAI-specific additions:

| What goes wrong | What user sees | What the system does |
|---|---|---|
| User pastes a project key (sk-proj-...) | "This is a project key, not an Admin key. Admin keys start with sk-admin-." | Rejects before any API call |
| User pastes an Anthropic key into the OpenAI card | "This is an Anthropic key. Use the Anthropic card instead." | Rejects before any API call |
| User is not an Organization Owner | API returns 403. "Only Organization Owners can use Admin keys. Check your role." | Does not store key |
| OpenAI Costs API returns 404 | This has been reported by some users in the OpenAI community. | Log the error, skip cost fetching, continue with usage data only. Show: "Cost data unavailable. Token usage is still tracked." |
| OpenAI changes the response format | Parsing fails for some fields | Store raw JSON. Show partial data with warning. |
| The user has multiple OpenAI organizations | Admin key is scoped to one org. Only that org's data is returned. | Document: "If you have multiple OpenAI organizations, you'll need to add a separate Admin key for each one." |
| OpenAI rate limits the usage endpoint | 429 with Retry-After header | Backoff using Retry-After value, same as Anthropic |

### The OpenAI Costs API 404 problem

Multiple developers have reported that OpenAI's `/v1/organization/costs` endpoint sometimes returns 404 for valid Admin keys. This appears to be an intermittent issue on OpenAI's side.

**Our approach:** Treat the Costs API as optional. The Usage API (token counts) is the primary data source. If the Costs API fails:
1. Log the error
2. Compute approximate cost from token counts using our pricing tables (already exist in pricing.ts)
3. Mark the cost as "estimated" in the database (source='computed' instead of source='api')
4. Dashboard shows cost with a small "estimated" indicator
5. When the Costs API starts working again, overwrite estimated costs with actual costs

This ensures the user always sees cost data, even if OpenAI's Costs endpoint is flaky.

---

## 6. Security considerations

Same encryption model as v1.1.0. The OpenAI Admin key is encrypted with AES-256-GCM, machine-bound, and never logged or returned in API responses.

**OpenAI-specific permission risk:** OpenAI Admin keys have broader permissions than Anthropic Admin keys. They can manage users, projects, and API keys across the organization. Our documentation must clearly state: "LLM Observer uses your OpenAI Admin key ONLY to read usage and cost data. It calls two endpoints: /v1/organization/usage/completions and /v1/organization/costs. It never creates, modifies, or deletes any resources in your OpenAI organization."

---

## 7. Positive scenarios

### 7.1 Developer using both Claude and GPT

A developer uses Claude Code for terminal work and GPT-4o for quick tasks via custom scripts. After adding both Admin keys, the dashboard shows: "Total today: $6.42 — Anthropic $4.20 (65%), OpenAI $2.22 (35%)." The model breakdown reveals they're spending $1.80 on GPT-4o when GPT-4o-mini would handle the same tasks for $0.12. They switch and save $50/month.

### 7.2 Team discovers hidden OpenAI project spend

A team lead adds the OpenAI Admin key. The dashboard shows $45/day. They're expecting $20/day. Using the API key breakdown (if grouped by api_key_id), they discover an API key that was created for a hackathon project 6 months ago is still active and running automated tests against GPT-4 Turbo. They deactivate the key and cut spend by $25/day.

### 7.3 Single dashboard for all AI spend

A developer has been manually checking the Anthropic console and the OpenAI platform dashboard separately. After v1.2.0, they have one local page showing everything. They set up a morning routine: open LLM Observer, check yesterday's spend, verify it's within expectations, then start coding. Total time: 10 seconds instead of 2 minutes logging into two separate dashboards.

---

## 8. Negative scenarios

### 8.1 User is not an Organization Owner

Developer goes to platform.openai.com/settings/organization/admin-keys but doesn't see the option to create a key. They're a "Reader" or "Member" in the organization, not an Owner.

**What happens:** They can't create an Admin key. LLM Observer's onboarding explains this clearly: "Only Organization Owners can create Admin API keys. If you're not the owner, ask your organization owner to either create a key for you, or promote you to Owner in Organization Settings → Members."

**Impact:** The developer cannot use OpenAI sync until they get Owner access. Anthropic sync still works independently.

### 8.2 OpenAI Costs API is down but Usage API works

The Costs API returns 404 (known issue), but the Usage API returns data normally.

**What happens:** Dashboard shows token counts and request counts accurately. Cost is computed from our pricing tables and marked as "estimated." A small note appears: "OpenAI costs are estimated from token counts. Actual billing may differ slightly."

**Impact:** The user gets 95% accuracy instead of 100%. This is far better than showing nothing.

### 8.3 User adds OpenAI key first, Anthropic key later

The Sync page shows only OpenAI data for a week. Then the user adds their Anthropic key. The Anthropic poller starts and fetches the last 24 hours.

**What happens:** The dashboard shows a combined view: one week of OpenAI data plus one day of Anthropic data. The daily chart has 7 bars with only OpenAI, then the current day has both.

**Impact:** This looks correct but could confuse users who expect retroactive Anthropic data. The chart should NOT show the Anthropic line as zero for the previous 6 days — it should simply be absent (the line starts when data starts).

### 8.4 Both pollers fail simultaneously (internet outage)

Network goes down. Both Anthropic and OpenAI pollers start failing.

**What happens:** Both enter independent exponential backoff. Dashboard shows: "Anthropic: last synced 5 minutes ago. Retrying. OpenAI: last synced 5 minutes ago. Retrying." When network returns, both resume independently. If one recovers before the other (e.g., OpenAI API comes back but Anthropic is still down), that poller resumes while the other continues retrying.

**Impact:** Independent failure and recovery. One provider's outage doesn't affect the other.

### 8.5 User accidentally adds the same key to both providers

User pastes their Anthropic admin key into the OpenAI card.

**What happens:** Client-side prefix check catches this: "This key starts with sk-ant-admin. This is an Anthropic key, not an OpenAI key. Use the Anthropic card instead." The key is rejected.

**The reverse:** User pastes their OpenAI admin key into the Anthropic card. Prefix check catches it: "This key starts with sk-admin. This is an OpenAI key, not an Anthropic key. Use the OpenAI card instead."

**Impact:** Cross-contamination is impossible because key prefixes are checked first.

---

## 9. Testing requirements

### 9.1 Regression tests (must all pass unchanged)

- All v1.0.12 regression tests (proxy, budget guard, dashboard)
- All v1.0.13 tests (error forwarding)
- All v1.1.0 tests (Anthropic poller, encryption, key management, sync API routes)

**Critical:** The Anthropic poller must continue to work identically. Run the full Anthropic sync test suite to confirm no interference from the OpenAI poller addition.

### 9.2 New tests for v1.2.0

**Key validation tests:**
- POST /api/sync/providers/openai/key with valid `sk-admin-...` key → mock 200 → key stored, poller starts
- POST with `sk-proj-...` prefix → rejected with "project key" message
- POST with `sk-ant-admin-...` prefix → rejected with "this is an Anthropic key" message
- POST with `sk-...` (regular key, not admin) → rejected with explanation
- POST with valid prefix but OpenAI returns 401 → rejected with "invalid key" message
- POST with valid prefix but OpenAI returns 403 → rejected with "not an Owner" message
- DELETE /api/sync/providers/openai/key → poller stops, key removed, historical data preserved

**OpenAI poller tests (mock OpenAI API):**
- Mock 200 with completions usage data → records appear in usage_records with provider='openai'
- Mock 200 with paginated response (has_more: true) → all pages fetched
- Mock 200 with empty data → success, no records inserted, no error
- Mock 429 with Retry-After → poller waits the specified duration
- Mock 503 → exponential backoff
- Mock 503 ten times → circuit breaker trips
- Checkpoint recovery: insert checkpoint, create fresh poller, verify it starts from checkpoint
- No duplicate records on re-poll (upsert behavior)
- Costs API returns 404 → cost computed from tokens, marked as "estimated"
- Costs API returns 200 → actual cost stored, overrides any previous estimate

**Multi-provider tests:**
- Both pollers running simultaneously → no conflict in database writes
- Usage records from Anthropic and OpenAI coexist in same table without collision (different provider column values)
- GET /api/sync/usage/today returns aggregated data from both providers
- GET /api/sync/usage/today with only Anthropic configured → returns only Anthropic data (no OpenAI zeros)
- GET /api/sync/usage/by-model returns both Claude and GPT models
- Removing one provider's key doesn't affect the other provider's poller or data

**Dashboard API tests:**
- GET /api/sync/providers returns list of both providers with correct statuses
- Provider status shows has_key: false for unconfigured provider

**Security tests:**
- GET /api/sync/providers does NOT return key material for either provider
- Admin key is not present in any log output (search full log for key substrings)

### 9.3 Manual verification

1. Run `npm run dev:all`
2. Navigate to Sync page → verify both Anthropic and OpenAI cards appear
3. Add OpenAI Admin key → test connection → verify success
4. Wait 60 seconds → verify OpenAI usage data appears alongside existing Anthropic data
5. Verify the daily cost chart shows both providers' data (stacked or side-by-side)
6. Verify the model breakdown table shows both Claude and GPT models
7. Verify provider filter works (All / Anthropic / OpenAI)
8. Check SQLite database → verify OpenAI admin key is encrypted (not plaintext)
9. Remove the OpenAI key → verify OpenAI poller stops → verify Anthropic poller continues unaffected
10. Verify all existing proxy functionality works unchanged
11. If possible: test with a real OpenAI Admin key for at least a few hours to validate real-world data flow

---

## 10. What this release does NOT include

| Feature | Deferred to | Why |
|---------|-------------|-----|
| Unified dashboard (proxy + sync merged) | v1.3.0 | Requires deduplication strategy |
| Manual subscription tracking | v1.3.0 | Depends on unified dashboard |
| OpenAI embeddings/image/audio usage tracking | Future patch (v1.2.1) | Completions is 90%+ of developer spend |
| Per-project breakdown (OpenAI projects) | Future patch | Nice-to-have, not essential for MVP |
| Google Gemini sync | v1.3.0+ | Different auth model, lower priority |
| Budget alerts based on sync data | v1.4.0 | Separate feature |

---

## 11. Release checklist

**Before development:**
- [ ] Read OpenAI Admin API documentation (confirmed current)
- [ ] Create a personal OpenAI Admin API key for testing (must be Org Owner)
- [ ] Verify all v1.1.0 tests pass on current main branch

**During development:**
- [ ] OpenAI poller implemented with all error handling paths
- [ ] Key validation with prefix checks for all key types (admin, project, regular, cross-provider)
- [ ] Costs API 404 fallback implemented (compute cost from tokens)
- [ ] Dashboard updated with second provider card and aggregated views
- [ ] Provider filter works on the Sync page
- [ ] API routes return multi-provider aggregated data
- [ ] UsageSyncManager starts both pollers on startup
- [ ] No console.log or logger call contains admin keys (verify with grep)

**Testing:**
- [ ] All regression tests pass (v1.0.12, v1.0.13, v1.1.0)
- [ ] All new OpenAI-specific tests pass
- [ ] All multi-provider interaction tests pass
- [ ] Anthropic sync continues working identically (explicit regression)
- [ ] Manual verification steps 1-11 completed

**Release:**
- [ ] Version bumped to 1.2.0 in package.json
- [ ] CHANGELOG.md updated
- [ ] README updated with OpenAI sync description
- [ ] Git tag created: v1.2.0
- [ ] npm publish
- [ ] Verify clean install and smoke test
- [ ] Both providers configured → data flows → one removed → other unaffected

---

## 12. Changelog

```markdown
## [1.2.0] - 2026-XX-XX

### Added
- **OpenAI Usage API Sync** — Add your OpenAI Admin API key to see all OpenAI
  spending across all your tools. Same zero-config experience as Anthropic sync.
- Multi-provider aggregated dashboard view — see total spend across Anthropic
  and OpenAI in one place
- Provider filter on Sync page — view all providers, or filter to one
- Automatic cost estimation fallback when OpenAI Costs API is unavailable
- Cross-provider key prefix detection (prevents pasting Anthropic key into
  OpenAI card and vice versa)

### Changed
- Sync API routes now return multi-provider aggregated data
- Sync page layout updated to accommodate multiple provider cards
- UsageSyncManager now manages multiple pollers independently

### Fixed
- None

### Breaking changes
- None (Anthropic sync works identically, proxy works identically,
  all existing features unchanged)
```