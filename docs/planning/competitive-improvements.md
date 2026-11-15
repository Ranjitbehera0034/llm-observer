# Competitive improvement work

## Milestone 1: trustworthy numbers — initial implementation

- Shared session pricing now returns an unpriced value instead of inventing $1/M pricing for unknown models. Null survives SQLite persistence; Sessions shows Unpriced and warns when its total excludes unpriced sessions.
- Shared pricing distinguishes Anthropic uncached input from OpenAI inclusive input and accounts for cache writes. With no TTL supplied, five-minute cache writes remain explicitly estimated. This does not add one-hour TTL support to Cline.
- Overview and timeline replace proxy estimates only for matching provider/model/time buckets with a non-null synced cost. Zero is valid coverage. Mixed sources are labelled. UTC timeline day keys now agree with SQLite grouping.
- Migration 014 schedules one reparse of existing Codex/Cline/Copilot/Windsurf sources. Missing original files cannot be repriced; existing Claude and Aider pricing paths are separate follow-up work.
- Unimplemented team join/manual sync now fail explicitly without saving credentials or claiming membership.

### Limits and remaining trust work

Provider/model/time matching is not account-level reconciliation: requests need organization/account identity before separate accounts can safely be merged. Synced cost rows also need explicit provenance (provider-reported vs locally estimated), completeness, and last-success metadata. Poller response schemas and pagination need their own audit; this change does not establish invoice accuracy. The overview uses local-day periods while its timeline uses UTC day buckets.

Unknown-price handling in the shared parser does not yet cover every engine. Audit Claude, Aider, proxy pricing, optimization and export surfaces before claiming complete price coverage. Add versioned pricing and automatic revaluation when prices change. Validate model aliases and mixed-model sessions.

## Milestone 2: integration reliability

1. Validate Claude and Codex against sanitized recorded current/legacy fixtures, including nested Codex events, cumulative usage, cache counts and project attribution.
2. Define parser support by version and OS. Expose skipped records, malformed files, and last successful import.
3. Replace assumed quota schemas with validated adapters; isolate provider failures, preserve fresh/stale observations and respect retry limits.
4. Investigate Cursor billing/export sources separately from session reconstruction.

## Milestone 3: everyday utility and demonstrated savings

- Put verified quota/reset information in the existing desktop tray.
- Separate activity, API-equivalent value, subscription payments and observed provider spend.
- Attach evidence, assumptions, period and confidence to optimization recommendations.
- Deduplicate overlapping savings opportunities; track suggested/applied/observed outcomes. Do not label hypothetical opportunities as realized ROI.

## Milestone 4: teams and distribution

- Implement authenticated membership, end-to-end aggregate sync, permissions and reporting before enabling team commands.
- Validate signed desktop installation/update workflows.
- Replace broad competitor checkmarks with dated, linked, workflow-specific comparisons.

Reference competitors: https://github.com/ccusage/ccusage, https://github.com/steipete/CodexBar, https://github.com/ClaudeCodeUsage/ClaudeCodeUsage, https://langfuse.com/docs, https://docs.helicone.ai/features/advanced-usage/custom-rate-limits.
