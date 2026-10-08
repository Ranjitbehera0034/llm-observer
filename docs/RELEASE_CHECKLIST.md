# Release checklist

Manual steps that CI cannot cover. Work through them before tagging a release.

## Admin-API billing sync: live-key validation (REQUIRED GATE for any release that claims billing reconciliation)

**This is the one thing in this repo that has never been verified against a real account.** The Anthropic and
OpenAI pollers (`packages/proxy/src/sync/`) are tested only against SYNTHETIC fixtures written from the vendors'
published API docs (`packages/proxy/src/__tests__/fixtures/`, see its README) and against a local fake vendor
server (`tests/integration/admin-sync-validator.test.ts`). No test has ever seen a real admin-key response, so
"reconciles to your invoice" is unproven until this step passes with live keys. Until a PASS row exists in the
table below, release notes and marketing must not describe sync as invoice-accurate, and a release may not claim
billing reconciliation.

Admin keys exist only for organisation accounts, so this needs someone with one. Keys are only ever put in
your own shell's environment: never in chat, a file, a command line or a commit.

1. Build: `npm ci && npm run build:ci`
2. Put the keys in the environment without writing them anywhere (either or both; a provider without a key is skipped):
   ```
   read -rs ANTHROPIC_ADMIN_KEY && export ANTHROPIC_ADMIN_KEY
   read -rs OPENAI_ADMIN_KEY && export OPENAI_ADMIN_KEY
   ```
3. Run the validator. It calls the same endpoints the pollers use (read-only), runs the real poller code twice into
   a throw-away SQLite database, and saves the redacted raw responses:
   ```
   node scripts/validate-admin-sync.js --days 14 --save
   ```
   `--days 14` is more than the vendors' default page of 7 daily buckets, so pagination is exercised (Anthropic
   documents that default; a one-page result is reported as "not exercised"). Add `--strict` to make warnings fail.
   It exits 0 on PASS, 1 on FAIL, 2 on bad usage, and prints a Markdown report. Nothing is read from the command
   line except options, the key is never printed or written, and the temp database is deleted (`--keep-db` keeps it).
4. Then `unset ANTHROPIC_ADMIN_KEY OPENAI_ADMIN_KEY`.
5. Read the report. A FAIL names the check; the usual causes are:
   - **Response shape recognised: FAIL** - a real response was rejected as an unrecognised shape. The report lists the exact
     top-level keys seen and (with `--save`) the redacted body is in `recorded/`. Fix `response-shapes.ts` against it.
   - **Cost stamped on every usage row / USD per day: FAIL** - OpenAI cost `line_item` values do not name the usage `model`s
     (the poller strips a trailing `", input"` style qualifier and matches the rest to the usage model; whether real line items
     look like that was never confirmed), or Anthropic `amount` is not cents (the poller divides by 100). The report names the
     unmatched line items.
   - **Requests succeeded: FAIL** - HTTP error. 401/403 means the key is not an admin key or lacks the role. A failed cost report
     is swallowed by the poller (no costs stored) and an OpenAI 404 makes it fall back to token-count estimates; both fail here.
   - **Second poll adds no rows: FAIL** - the duplicate-row bug is back, or bucket timestamps are unstable.
   WARN rows (no usage today so today's cost cannot be checked, cost lines with no model such as web search) do not fail but
   must be explained in Notes.
6. Commit the recordings once the run passes (after a shape FAIL, fix the normaliser first and re-run; the report prints the exact `git add` line). Check `git diff --cached` for anything identifying first;
   the redaction replaces ids, emails, key names and cursors with stable fakes and refuses to write a file that still holds one,
   but you are the last check. A conformance test (`recordedAdminConformance.test.ts`) then runs the real normalisers over every
   committed recording, so a future change cannot break them. A directory under `recorded/` must hold real vendor responses only.
7. Compare the report's per-day USD (Raw USD column) for a fully elapsed day with the Anthropic Console cost page and the
   OpenAI costs dashboard. The validator proves the app stored what the API said; only this comparison shows the API matches
   your invoice. Connecting the key in the dashboard Sync page and letting it poll a few times is a useful extra, and
   `SELECT provider, model, bucket_start, COUNT(*) FROM usage_records GROUP BY 1,2,3 HAVING COUNT(*) > 1;` must return no rows.
8. Paste the row from the report's "Lines to paste into docs/RELEASE_CHECKLIST.md" section below, fill in your name and any notes.
   A run with a base URL override (`LLM_OBSERVER_*_ADMIN_BASE_URL`) is marked NOT A LIVE-VENDOR RUN and prints no row: it does not count.

Re-run the whole step before any release that changes `packages/proxy/src/sync/` or if a vendor changes its API.

| Date | Tester | Anthropic | OpenAI | Notes |
|------|--------|-----------|--------|-------|
| _not yet validated_ | | | | |

## License server: post-deploy verification (manual, required after any deploy or env change)

The license server (`packages/license-server`) has been tested over real HTTP only against local fakes
(`tests/integration/license-e2e.test.ts`). Whether the Vercel deployment itself works is unproven until this
passes. Full set-up steps: `docs/DEPLOY_LICENSE_SERVER.md`.

1. `ADMIN_TOKEN=<token> node scripts/verify-license-server.js https://api.llm-observer.com --admin-token-env ADMIN_TOKEN`
   must exit 0 with no FAIL and no SKIP. It is read-only and never prints the token.
2. Make one test-mode purchase and confirm: email with an `LLMO1.` key arrives, the app activates it,
   `/admin.html` shows the customer with one device, a re-sent webhook sends no second email.
3. If the public key in `packages/proxy/src/licenseKeys.ts` changed in this release, confirm it matches
   `LICENSE_PRIVATE_KEY` (a key from step 2 activating proves it).
4. Record the date, tester and result below.

| Date | Tester | Verifier | Test purchase | Notes |
|------|--------|----------|---------------|-------|
| _not yet run against production_ | | | | |
