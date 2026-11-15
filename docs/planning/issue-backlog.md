# LLM Observer issue backlog

Known issues from the competitive review and implementation audit, 2026-11-14.
This is a local work queue, not a claim that the entire application has been audited.
Status: Done = implemented and targeted checks passed; Partial = narrower fix shipped locally; Open = remaining work.

| ID | Priority | Issue / required outcome | Status |
|---|---|---|---|
| T01 | P0 | Unknown shared-parser prices must remain unpriced in SQLite and Sessions | Done |
| T02 | P0 | Provider-specific cache accounting; explicit cache-write TTL and rates | Partial: shared accounting fixed; TTL/rate schema pending |
| T03 | P0 | Billing reconciliation by covered period, model and account | Partial: period/model fixed; account identity pending |
| T04 | P0 | Codex nested events, cumulative usage, cached input, model changes and real project metadata | Done for tested legacy/nested schemas; broader version validation remains T14 |
| T05 | P0 | Invalid/unknown Codex formats must not import as successful zero-cost sessions | Done: unsupported files fail; partial imports are unpriced |
| T06 | P0 | Provider polling failures must not prevent other providers from refreshing | Done: isolated failures, bounded calls, overlap guard |
| T07 | P0 | Replace assumed quota API shapes with validated adapters and bounded retries | Partial: Claude schema validation + 429 cooldown; live accounts and other adapters pending |
| T08 | P1 | Quota observations need accurate freshness, reset changes and per-window provenance | Done for existing snapshot pipeline; account identity remains T03 |
| T09 | P1 | Activity counts must not masquerade as remaining quota | Done: activity windows, session units and stale labels |
| T10 | P1 | Extend unknown-price handling to Claude, Aider, proxy, exports and aggregate views | Open |
| T11 | P1 | Version pricing; refresh historical valuations and handle model aliases | Open |
| T12 | P1 | Audit billing poller schemas, pagination, completeness, estimated-vs-reported costs | Open |
| T13 | P1 | Align timezones and subscription proration across overview and timeline | Partial: UTC timeline date-key bug fixed |
| T14 | P1 | Parser compatibility matrix and fixtures by tool/version/OS | Partial: Claude + synthetic Codex schema fixtures in CI; released-version validation pending |
| T15 | P1 | Surface skipped files, malformed records, partial imports and last successful parse | Partial: Codex diagnostics and provider-error banner; complete diagnostics UI pending |
| T16 | P1 | Cursor account/billing visibility; separately validate session import | Open: importer explicitly unsupported |
| T17 | P1 | Optimization model suggestions require evidence beyond output length | Open |
| T18 | P1 | Normalize savings periods and eliminate overlapping savings claims | Open |
| T19 | P1 | Track recommendation application and observed outcomes; distinguish opportunity from ROI | Open |
| T20 | P1 | Clearly separate API-equivalent usage, subscription payments, quota and billed spend | Partial: mixed sources labelled |
| T21 | P1 | Team join/sync must never claim success without backend completion | Done: unavailable commands fail without mutation |
| T22 | P2 | Implement authenticated team membership, sync, permissions and reporting | Open |
| T23 | P2 | Desktop tray should show verified quota/reset information | Open |
| T24 | P2 | Verify signed installation and auto-updates on supported desktop platforms | Open |
| T25 | P2 | Correct unsupported comparison/accuracy claims and missing release-document links | Open |
| T26 | P2 | Expand validated integrations only after core Claude/Codex reliability | Open |
| T27 | P0 | Claude credentials use nested OAuth JSON and the correct keychain service | Done in code/tests; live credential validation pending |

## Working order

T04/T05 → T06 → T08/T09 → T07 → T10–T15 → T17–T20 → T16 → T22–T26.
Finish implementation and focused verification before moving to the next item. Dependencies can change this order. Keep remaining work explicit; synthetic fixtures verify schema behavior but do not establish compatibility with every released editor version.

## Latest verification

- Codex schema/parser tests: 7 passing, including legacy format, duplicate snapshots, mixed models, unknown models, malformed and unsupported records, and unchanged-file skips.
- Quota, credential, failure-isolation and parser-manager suites: 38 passing together with Codex tests.
- Database suites: 6 passing, including freshness and deterministic latest-snapshot selection.
- Proxy TypeScript check passed. Dashboard production build passed after the final UI changes.
- CI parser command passed: 9 tests across Claude and Codex fixtures. In total, 46 distinct tests passed across the selected proxy and database suites.
- No real provider credentials were used and no live provider quota request was made. Private OAuth endpoints may change; account-scoped history, broader quota inventory and persistent cooldown across process restarts remain follow-up work.

## Customer-readiness follow-up (2026-11-14)

| ID | Issue | Status |
|---|---|---|
| C01 | Broken global Pro checkout link | Server-created Lemon Squeezy checkout and monthly/annual landing form implemented; merchant setup and sandbox verification pending |
| C02 | No owner customer/activity view | Optional hosted ledger, protected owner report and opt-in heartbeat implemented; database deployment/backfill pending |
| C03 | Free vs trial vs paid unclear | Separate verified plan states and isolated demo/test journeys; no automatic trial provisioning |
| C04 | Unsupported landing claims | Corrected in landing PR #2; global-checkout follow-up in progress |
| C05 | Advice has no task workflow | Local task inbox implemented with collection, deduplication and persistent status; autonomous execution/import integrations remain out of scope |
| C06 | Missing compatible provider routes | Moonshot/Kimi, DeepSeek, OpenRouter, xAI added; live provider calls pending credentials |
| C07 | Pricing catalog updates unreliable | Daily refresh, correct CLI feed/schema, custom-rate preservation and revisions implemented; historical/provider billing reconciliation remains partial |
| C08 | Unbounded/obsolete analyst configuration | Editable model ID, validated output, one call per run and 4,096 output cap; no actual model call used in QA |
