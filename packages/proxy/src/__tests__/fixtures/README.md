# Admin-API fixtures

These files are SYNTHETIC. They were written by hand from the vendors' published API
reference, not captured from a live admin key:

- Anthropic usage report: https://platform.claude.com/docs/en/api/beta/organization/usage_report/retrieve_messages
- Anthropic cost report: https://platform.claude.com/docs/en/api/beta/organization/cost_report/retrieve
- OpenAI usage (completions) and costs: https://github.com/openai/openai-openapi (manual_spec/openapi.yaml,
  paths `/organization/usage/completions` and `/organization/costs`)

Field names, nesting, units (Anthropic cost `amount` is a decimal string in cents, OpenAI cost
`amount.value` is dollars) and pagination (`has_more`, `next_page`, passed back as `page`) follow those
documents. Token counts and amounts are invented.

- `*.nested.json` - the documented time-bucket shape.
- `*.flat.json` - the older flat shape the pollers originally assumed. Kept because it may be what
  some deployments already ingested, and the pollers tolerate it.

`recorded/` is reserved for real responses captured with a live admin key (see
`docs/RELEASE_CHECKLIST.md`). Nothing in it is synthetic. Do not put synthetic data there.
