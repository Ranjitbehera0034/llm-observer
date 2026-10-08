# Team tier (beta)

> **Beta.** Part 1 (licence plan, team-server policy and rollup APIs) is described here. The app side
> (fetching and enforcing policy locally, a Team page in the dashboard) is not built yet. Nothing in this
> page has been run against a production deployment.

## Design

**Thesis.** Enforcement stays local. Every developer's app keeps all of its data on their machine. The
team server is a thin policy plane: it stores *daily aggregates* that the app already syncs, it hands
out a budget policy, and it shows admins per-member rollups. Prompts, responses, file paths, session
content and API keys never go to the server (the existing sync payload carries only date, provider,
model, project name, and request/token/cost/latency/error counters).

**What part 1 builds**

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
- Not covered in part 1: the team server does not check licences (whoever runs it decides who may use it),
  there is no team creation / signup flow in the server (teams are created directly in the database), and
  the app does not yet poll or enforce the policy.
- A `team` key does **not** work in app versions that predate this change: they only accept `plan: 'pro'`
  and will report the key as unverifiable. Ship the app release before issuing team keys.

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
