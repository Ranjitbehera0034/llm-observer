# Team tier (beta)

> **Beta.** Parts 1 and 2 are built: the licence plan and the team server (policy, rollups), and the app
> side (policy enforcement, `llm-observer team` commands, the dashboard Team page). All of it is tested
> against in-memory fakes of the team server and its MongoDB models, never against a real MongoDB or a
> production deployment; see [What is not built or not verified](#what-is-not-built-or-not-verified).

## Design

**Thesis.** Enforcement stays local. Every developer's app keeps all of its data on their machine. The
team server is a thin policy plane: it stores *daily aggregates* that the app already syncs, it hands
out a budget policy, and it shows admins per-member rollups. Prompts, responses, file paths, session
content and API keys never go to the server (the existing sync payload carries only date, provider,
model, project name, and request/token/cost/latency/error counters).

**Part 1 (server and licence)**

1. **Licence plans.** A signed `LLMO1` key payload gains `plan: 'pro' | 'team'` and an optional integer
   `seats`. The app and the licence server accept both; Pro limits apply to both; `LicenseInfo` gains
   `plan` (`'free' | 'pro' | 'team'`) and `seats`. Existing `pro` keys and legacy `PRO_` keys are
   unchanged. The payment webhooks issue a `team` key when the purchased Lemon Squeezy variant id /
   Razorpay plan id is listed in `LEMONSQUEEZY_TEAM_VARIANT_IDS` / `RAZORPAY_TEAM_PLAN_IDS` (comma
   lists; anything else is `pro`). Plan and seats are recorded on the customer record shown in `/admin`.
   `seats` is informational: it cannot be enforced offline, so nothing blocks an extra install.
2. **Team-server policy.** A `TeamPolicy` document per team (a versioned list of budgets
   `{scope: daily|weekly|monthly, limitUsd, provider?, action: alert|block}`).
   - `PUT /api/team/:teamSlug/policy` and `GET /api/team/:teamSlug/policy`: team admin (cookie JWT, role
     admin or owner). Every successful PUT bumps `version`.
   - `GET /api/team/policy`: a member's app, authenticated like `POST /api/team/sync` (team API key plus
     the member's email, which must be a signed-in member of that team). Returns the policy and version.
3. **Rollups.** `GET /api/team/:teamSlug/rollup?from&to` (admin): totals per member, per day, per
   member-per-day, per provider and per model, computed from `TeamDailyStats`.
4. **Gaps closed on the way:** member removal (`DELETE /api/team/:teamSlug/members/:memberId`) and team
   API key rotation (`POST /api/team/:teamSlug/api-key/rotate`, owner), so a "revoked" key is possible.

**Trust model (what this does and does not protect)**

- Humans (admins) authenticate with the existing cookie JWT and a per-team role; an admin of one team
  gets 403 on every other team's routes. Members cannot write policy.
- Machines authenticate with the team API key, which is shared by the whole team. The member email sent
  with it is *claimed*, not proven: anyone holding the key who knows a teammate's email can sync or
  fetch policy as that teammate. Per-member attribution and the rollups are therefore only as trustworthy
  as the team's own members; this is a cooperative model, not protection against a malicious member.
  Per-member tokens are future work.
- Rotating the key locks out every old copy of it immediately; removing a member stops that email from
  syncing or fetching policy (their history stays in the rollup, shown as a removed member).
- Policy is *advice the app chooses to follow*. A developer can edit their local app, so `block` is best
  effort exactly like the local kill switch, which already overshoots because spend is written in
  batches. This is a cost-control tool, not a security boundary.
- The server learns, per member and day: which providers/models/projects were used and how much. That is
  already true of sync today; part 1 adds no new data collection.
- Not covered: the team server does not check licences (whoever runs it decides who may use it), and there
  is no team creation or signup-to-team flow in the server (see [Setting up a team server](#setting-up-a-team-server)).
- An app only follows a team's policy while its own licence is a Team plan; that check is local and
  offline-capable (the signed key), it is not a server-side seat check.
- A `team` key does **not** work in app versions that predate this change: they only accept `plan: 'pro'`
  and will report the key as unverifiable. Ship the app release before issuing team keys.

## Part 2: what the app does

**Joining.** `llm-observer team join` saves the server URL, team id (the team's slug), team API key and your
email in the local settings, after checking them once with `GET /api/team/policy`. Nothing is sent until the
running app has a **Team** licence.

**Each sync cycle** (the running app, first 30 seconds after start and then every 15 minutes, or "Sync now"
on the Team page / `llm-observer team sync`):

1. Read the licence plan. If it is not `team`: send nothing, fetch nothing, delete every team-sourced budget.
   Your join settings are kept, so everything resumes if a Team licence is activated again.
2. Push the daily aggregates (see [What leaves the machine](#what-leaves-the-machine)).
3. Pull `GET /api/team/policy` (team API key as `Authorization: Bearer`, your email as `X-Team-Member-Email`;
   never in the URL) and **reconcile** it into the local `budgets` table.

**Reconciliation** (`packages/proxy/src/services/teamPolicy.ts`):

- Policy budgets become rows with `source = 'team'` (migration 017 adds the column; every existing budget is
  `'local'`). A policy budget `{scope: daily, limitUsd: 25, provider: anthropic, action: block}` becomes a
  provider budget on `anthropic`, daily period, $25, with the kill switch on. `action: alert` leaves the kill
  switch off, and the budget raises alerts through the existing evaluation (run after each pull).
- It creates, updates (same row id, so alert history stays) and deletes **team-sourced rows only**. A local
  budget is never read as a match, updated or deleted, even if it looks identical.
- It is idempotent (applying the same policy changes nothing, not even `updated_at`) and runs in one
  transaction (all of a policy or none of it).
- It is failure-tolerant: offline, a timeout, a 4xx/5xx or a malformed answer keeps the last policy in force
  and records the reason (`llm-observer team status`, Team page). That includes a 401/403 (rotated key,
  removed member): the policy is kept and the reason shown; run `team leave` to drop it.
- The settings `team_policy_version`, `team_policy_synced_at`, `team_policy_error`, `team_sync_error`,
  `team_license_plan` and `last_team_sync_at` record the state. The `team_*` settings cannot be changed
  through `PUT /api/settings`.

**Enforcement.** There is no second code path. A `block` budget is a kill-switch budget, so the same
`BudgetService` / `budgetGuard` checks that handle a local budget return the 429 (with "This limit was set by
your team."). As with every kill switch it is best effort: it counts recorded, queued and in-flight estimated
spend, and covers only traffic sent through that developer's own proxy (see the README's Kill Switch entry for the
exact bound). A developer can also edit their own copy of the app, so a team budget is a guardrail, not a control.

**Read-only.** `PUT`/`DELETE /api/budgets/:id` on a team budget answer 403; the Budgets tab shows a lock and
"set by your team" and offers no edit, delete or toggle.

**Licence lapse.** When the stored key stops being a verified Team key (subscription ended, key cleared) the
next cycle removes the team budgets and stops syncing. The licence plan is cached for a minute, and the
24-hourly revalidation decides when a cancelled subscription is noticed.

### CLI

```
llm-observer team join --url https://team.example.com --team-id acme --api-key <key> --email you@example.com
llm-observer team status
llm-observer team sync       # asks the running app to sync now (needs `llm-observer start`)
llm-observer team leave
```

- `join` verifies the credentials against the server first and saves nothing if they are refused. Flags:
  `--no-verify` (save without checking, for a server you cannot reach yet), `--allow-http` (plain `http://`
  to a non-local host; otherwise only https, or http to localhost, is accepted). The key can be passed as
  `LLM_OBSERVER_TEAM_API_KEY` instead of `--api-key` so it stays out of shell history. Joining a different
  team or server removes the previous team's budgets.
- `status` reads local state only (no network). The licence plan is the one **the running app last
  recorded**, with its time, because the plan check lives in the app; if the app has never run since joining
  it says "not yet checked".
- `leave` deletes the team settings and every team budget. Your own budgets, licence and usage data stay.
  Data already sent to the team server stays there.
- The API key is stored in the local database like other secrets and is only ever printed as its last four
  characters. `GET /api/settings` shows only its first and last four characters.

### Dashboard Team page

`/team` (beta badge in the navigation). Shows, with a Team licence and a joined team: the connection and
last syncs, the active policy with this period's spend (read-only), this device's contribution (30-day totals
and the most recent rows, exactly the fields that are sent), and, for admins, the member rollup.

- Without a Team licence it shows an explanation of the plan instead of data; the API returns nothing about
  a team in that case.
- Not joined: the `team join` command to run.
- **Admin rollup.** A team admin pastes a team-server session token (the `llmo_access_token` cookie value
  from signing in to the team server; it expires after 15 minutes). It is kept in the browser tab's
  `sessionStorage` only, sent only to the local `GET /api/team/rollup` route as `Authorization: Bearer`, and
  forwarded by that route as the team server's session cookie to the **configured** team-server URL. The
  route never takes a URL, team or host from the request, does not store or log the token, and the Host/
  Origin guard sits in front of it like every other local route. A 401 from the team server forgets the
  token.

### What leaves the machine

Once joined and with a Team licence, each sync sends **one row per day, provider, model and project**:

| Sent | Not sent |
|---|---|
| the date | prompts |
| provider and model names | responses |
| the project name | file paths |
| request, token and cost totals | sessions or conversation content |
| error count, blocked-request count, average latency | your provider API keys |
| your email address (the one you were invited with) | |

The team API key travels with the request as a credential. Everything else stays in the local SQLite
database. The Team page repeats this statement and lists the most recent rows that would be sent.

## Setting up a team server

Nothing here has been run against a real MongoDB by the author of this item: the commands follow the code
and models in `packages/team-server`, and the `mongosh` snippets in particular are untested.

**Requirements.** Node 18+, MongoDB, and HTTPS in front of the server for anything beyond a trial (the team
API key and session cookies cross the network; the app refuses plain `http://` to a non-local host unless told
otherwise).

**Environment variables**

| Variable | Meaning |
|---|---|
| `MONGODB_URI` | Connection string. Default `mongodb://localhost:27017/llm-observer-team`. |
| `PORT` | Listen port. Default `4002`. |
| `JWT_SECRET` | Signs the session tokens. **Required when `NODE_ENV=production`** (the server refuses to sign without it); outside production an insecure development default is used and a warning is printed. |
| `NODE_ENV` | `production` makes session cookies `Secure` (HTTPS only). |
| `TEAM_DASHBOARD_URL` | Origin allowed for cookie-carrying CORS requests; unset allows any origin. |
| `TEAM_SERVER_PUBLIC_URL` | Public base URL, used to build the SSO callback. Default `http://localhost:4002`. |

```
npm run build --workspace=@llm-observer/team-server
JWT_SECRET=... NODE_ENV=production MONGODB_URI=... node packages/team-server/dist/index.js
```

**Creating the first admin.** The server has no team-creation flow. Create the user through the API, then
create the team and the owner membership in MongoDB:

```
curl -X POST https://team.example.com/api/auth/signup -H 'content-type: application/json' \
  -d '{"email":"admin@example.com","password":"at least 10 characters","name":"Admin"}'
```

```js
// mongosh <MONGODB_URI>. Collection names are Mongoose's pluralised model names.
const owner = db.users.findOne({ email: 'admin@example.com' });
const team = db.teams.insertOne({
  name: 'Acme', slug: 'acme', owner_id: owner._id, plan: 'team', max_seats: 10,
  team_api_key: 'tk_' + UUID().toString().replace(/-/g, '') + UUID().toString().replace(/-/g, ''),
  created_at: new Date(),
});
db.teammembers.insertOne({
  team_id: team.insertedId, user_id: owner._id, role: 'owner',
  invited_email: 'admin@example.com', invited_at: new Date(), joined_at: new Date(),
});
db.teams.findOne({ _id: team.insertedId }, { team_api_key: 1 });   // the key to give to members
```

`POST /api/auth/signup` is open to anyone who can reach the server, and the user it creates has no team
rights until a membership exists; still, do not expose an unneeded signup endpoint publicly.

**Inviting members.** An admin calls `POST /api/team/<slug>/invite` with `{"email","role"}` (cookie session).
An invite alone does not let a member sync or fetch policy: `GET /api/team/policy` and `POST /api/team/sync`
require a membership that is linked to a user. **Only the SSO callback links an invitation to a user.**
Signing up with a password does not (the server does not verify email addresses, so linking on signup would
let anyone claim an invitation). For a password-only team, link members yourself after they sign up:

```js
const u = db.users.findOne({ email: 'dev@example.com' });
db.teammembers.updateOne({ team_id: team.insertedId, invited_email: 'dev@example.com' },
                         { $set: { user_id: u._id, joined_at: new Date() } });
```

**Writing the policy.** `PUT /api/team/<slug>/policy` as an admin (see the API table). There is no policy
editor in the dashboard.

**Getting an admin token for the Team page.** Sign in with the cookie jar and copy the value:

```
curl -s -i -X POST https://team.example.com/api/auth/login -H 'content-type: application/json' \
  -d '{"email":"admin@example.com","password":"..."}' | grep -i 'set-cookie: llmo_access_token'
```

**Joining from an app.** Give members the URL, the team slug, the team API key and tell them to use the email
they were invited with, then `llm-observer team join ...` on a machine with a Team licence.

## Server API (beta)

Human routes use the session cookie (`llmo_access_token`) and the caller's role in the team named by
`:teamSlug`. Machine routes use the team API key.

| Route | Who | Notes |
|---|---|---|
| `PUT /api/team/:teamSlug/policy` | admin, owner | Body `{"budgets":[{"scope":"daily\|weekly\|monthly","limitUsd":25,"provider":"anthropic","action":"alert\|block"}]}`. Replaces the list, bumps `version`. At most 50 budgets, `limitUsd` > 0, unknown keys rejected, `provider` is lower-cased and optional (omitted = all providers). |
| `GET /api/team/:teamSlug/policy` | admin, owner | Same shape plus `updatedBy`. `version: 0` and `budgets: []` until first saved. |
| `GET /api/team/policy` | a member's app | `Authorization: Bearer <team api key>` and `X-Team-Member-Email: <email>`. 401 unknown or missing key, 400 bad email, 403 not a signed-in member. Returns `{version, budgets, updatedAt, beta}`. |
| `GET /api/team/:teamSlug/rollup?from=YYYY-MM-DD&to=YYYY-MM-DD` | admin, owner | Inclusive UTC days, default last 30, at most 366. Returns `totals`, `members`, `days`, `memberDays`, `providers`, `models`; each with requests, tokens, costUsd, errors, blocked and a request-weighted `avgLatencyMs`. Former members' usage is kept and flagged `removed`. |
| `DELETE /api/team/:teamSlug/members/:membershipId` | admin, owner | Admins remove members and pending invites; only the owner removes an admin; the owner cannot be removed. |
| `POST /api/team/:teamSlug/api-key/rotate` | owner | Returns the new key once; the old key stops working at once. |

Limits worth knowing: the rollup reads the matching `TeamDailyStats` rows and folds them in the server
process (fine for a beta-sized team, not for thousands of members); `block` is a request to the app, not
a guarantee; sync and policy fetch trust a claimed member email (see the trust model above).

## Licence plans

The licence server issues `team` keys only for purchases whose Lemon Squeezy variant id or Razorpay plan
id is listed in `LEMONSQUEEZY_TEAM_VARIANT_IDS` / `RAZORPAY_TEAM_PLAN_IDS`; `seats` is the subscription
quantity. `/admin` shows plan and seats per customer. These webhook fields (`variant_id`,
`first_subscription_item.quantity`, `plan_id`, `quantity`) have not been checked against a live payload.

## What is not built or not verified

Not built (all of these are plain gaps, not hidden features):

- **SSO UI.** The server has an OIDC sign-in (`/api/auth/oidc/...`) and an admin route that stores the OIDC
  settings, but no screen for either, and neither has been tried against a real identity provider. The SSO
  callback is also the only thing that links a member to an invitation.
- **Seat billing.** `seats` on the licence and `max_seats` on the team are informational. Nothing counts
  installs, enforces a seat limit on sync or bills per seat.
- **Invitations.** There is an invite API but no invitation email, accept page, resend or expiry, and local
  (password) sign-up does not link an invitation (see above).
- **Audit log.** The server records no who-changed-what history; `updated_by` on the policy keeps only the last
  editor.
- Also missing: team creation and signup flow, a policy editor, per-member tokens (the member email is
  claimed, not proven), a licence check on the server, a key-rotation UI, and server-side data deletion for a member
  who leaves.

Not verified:

- Everything above was tested with fakes. No real MongoDB, no production team server, no payment-provider
  webhook payloads, no Windows or macOS run, and the dashboard page was rendered to HTML in tests but never
  opened in a browser.
- Policy refresh is every 15 minutes (or on demand); a policy change is not instant.
- Existing behaviour worth knowing: the aggregate push re-sends every daily row older than an hour on each
  cycle (the server upserts, so the result is correct but the payload grows with history).
