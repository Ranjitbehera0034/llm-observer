# Release checklist

Manual steps that CI cannot cover. Work through them before tagging a release.

## Admin-API billing sync: live-key validation (manual, required)

The Anthropic and OpenAI pollers (`packages/proxy/src/sync/`) are tested only against SYNTHETIC
fixtures written from the vendors' published API docs (`packages/proxy/src/__tests__/fixtures/`,
see its README). No test has ever seen a real admin-key response, so the "reconciles to your
invoice" claim is unproven until this step passes. Do not describe sync as invoice-accurate in
release notes or marketing until it has.

Admin keys exist only for organisation accounts, so this needs someone with one.

1. Use a throwaway data dir: `LLM_OBSERVER_DATA_DIR=$(mktemp -d) HOME=$LLM_OBSERVER_DATA_DIR`.
2. Capture one real response of each kind with your admin key (replace dates with a recent range):
   - Anthropic usage: `GET https://api.anthropic.com/v1/organizations/usage_report/messages?starting_at=...&bucket_width=1d&group_by[]=model`
   - Anthropic cost: `GET https://api.anthropic.com/v1/organizations/cost_report?starting_at=...&group_by[]=description`
     (headers `x-api-key: <admin key>`, `anthropic-version: 2023-06-01`)
   - OpenAI usage: `GET https://api.openai.com/v1/organization/usage/completions?start_time=...&bucket_width=1d&group_by[]=model`
   - OpenAI costs: `GET https://api.openai.com/v1/organization/costs?start_time=...&bucket_width=1d&group_by[]=line_item`
     (header `Authorization: Bearer <admin key>`)
3. Store the raw bodies in `packages/proxy/src/__tests__/fixtures/recorded/` (for example
   `anthropic-usage-report.json`). Scrub org, user, workspace and key IDs first. Never commit a key.
4. Run the pollers' normalisers over each recording
   (`normalizeAnthropicUsage`, `normalizeAnthropicCost`, `normalizeOpenAIUsage`, `normalizeOpenAICost`
   in `packages/proxy/src/sync/response-shapes.ts`). Each must accept the real shape without a
   `SyncShapeError`. Add a conformance test that loads the recordings so a future change cannot break
   them. If a normaliser rejects a real response, fix it before releasing.
5. Check the two things the synthetic fixtures cannot settle:
   - OpenAI cost `line_item` values: confirm how they name models (the poller strips a trailing
     `", input"` style qualifier and matches the rest to the usage `model`). If real line items do
     not match usage models, costs are never stamped on the rows.
   - Anthropic cost `amount` units: confirm it is cents (the poller divides by 100).
6. Connect the key in the dashboard (Sync page), let it poll at least three times, then compare
   the Sync totals for a fully elapsed day with the Anthropic Console cost page and the OpenAI
   usage/costs dashboard. The totals must match and must not grow between polls.
   - SQL check: `SELECT provider, model, bucket_start, COUNT(*) FROM usage_records GROUP BY 1,2,3 HAVING COUNT(*) > 1;` returns no rows.
7. Record the date, tester and result below.

| Date | Tester | Anthropic | OpenAI | Notes |
|------|--------|-----------|--------|-------|
| _not yet validated_ | | | | |
