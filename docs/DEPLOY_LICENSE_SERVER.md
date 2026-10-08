# Deploying the license server

This is the checklist for putting `packages/license-server` on Vercel at `https://api.llm-observer.com`,
and for finding out whether it works.

**Status, stated plainly:** the production URL has never been exercised. The handlers are tested over
real HTTP against local fakes (`tests/integration/license-e2e.test.ts`), but nobody has run them on Vercel,
with a real Upstash database, a real Resend account or a real payment. Do not tell customers (or yourself)
that licensing works in production until step 8 (the verifier) is green and step 9 (a test purchase) has
delivered a key. The verifier is how you find out.

What the automated tests do and do not cover is listed at the end.

## What you need

| Account | Used for | Cost |
|---|---|---|
| Vercel | Hosts the functions | Free tier is enough |
| Upstash (via Vercel Storage) | Customer, device and install records | Free tier |
| Resend | Emails the licence key | Free tier: 100 emails/day |
| Lemon Squeezy and/or Razorpay | Payments and the webhooks that trigger licences | Their fees |
| DNS for `llm-observer.com` | `api` CNAME, plus Resend's SPF/DKIM records | - |

You also need this repository checked out, Node 18+, and `openssl`.

## 1. Generate the signing keypair

```bash
npm ci
npm run keygen --workspace=@llm-observer/license-server
```

It prints a private key (`LICENSE_PRIVATE_KEY`) and a public key (`LICENSE_PUBLIC_KEY_PEM`).

- The **private** key goes only into Vercel (step 3). Never commit it, never paste it into a chat or ticket.
- The **public** key must equal the `LICENSE_PUBLIC_KEY_PEM` constant in `packages/proxy/src/licenseKeys.ts`.
  The app verifies keys offline with that constant. If the two do not match, every key the server issues is
  rejected by the app ("Invalid license key"), even though payment and email worked.
  Changing the constant means shipping a new app release; rotating the keypair invalidates every key signed
  with the old one.
- If you keep the private key as a PEM file, you can re-derive the public half to compare:
  `openssl pkey -in private.pem -pubout`.

If the repository already has the public key for a private key you hold, do not generate a new pair.

## 2. Create the Vercel project

1. Vercel dashboard > Add New > Project > import the GitHub repository.
2. **Root Directory:** `packages/license-server`. Leave "Include source files outside of the Root Directory"
   enabled (the npm workspace lockfile is at the repository root).
3. **Framework Preset:** Other. No output directory. The package has a `build` script (`tsc`, type-check only);
   it passes today (`npx tsc --noEmit -p packages/license-server`). It is not needed to serve the functions.
4. `vercel.json` in that directory defines the routes (`/health`, `/webhook/lemonsqueezy`, `/webhook/razorpay`,
   `/license/validate`, `/checkout/razorpay`, `/telemetry/ping`, `/admin/report`). `public/admin.html` is the
   owner page and is expected to be served at `/admin.html`.
5. Do not deploy yet: set the environment variables first, otherwise the first deployment answers 503 to
   everything that matters.

## 3. Add the Upstash database

Vercel project > Storage > Create / Connect Database > **Upstash for Redis** (free plan) > connect it to this
project for the Production environment. This sets `KV_REST_API_URL` and `KV_REST_API_TOKEN` for you.
(`UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` are also accepted.)

Without storage the webhooks still issue keys, but there is no owner view, no device records, and a repeated
webhook delivery cannot be recognised, so a customer could be emailed twice.

## 4. Set the environment variables

Vercel > Project > Settings > Environment Variables, scope **Production** (add Preview only if you want to
test on preview URLs; use test-mode secrets there). Template with comments:
`packages/license-server/.env.example`.

| Variable | Where it comes from | What `/health` flag shows it |
|---|---|---|
| `LICENSE_PRIVATE_KEY` | Step 1, the private key. A PEM block, or the single-line form with `\n` escapes that `keygen` also prints | `hasLicensePrivateKey` |
| `LEMONSQUEEZY_WEBHOOK_SECRET` | You choose it when you create the webhook in step 6 (Lemon Squeezy calls it the signing secret). `LEMONSQUEEZY_SIGNING_SECRET` is accepted as an older name | `hasLSSecret` |
| `RAZORPAY_WEBHOOK_SECRET` | You choose it when you create the webhook in step 6 | `hasRZPSecret` |
| `RESEND_API_KEY` | resend.com > API Keys | `hasResendKey` |
| `EMAIL_FROM` | An address on a domain you verified in Resend, for example `licenses@llm-observer.com`. Defaults to that address. Resend rejects unverified sender domains | - |
| `KV_REST_API_URL`, `KV_REST_API_TOKEN` | Step 3 (set automatically) | `hasStorage` |
| `ADMIN_TOKEN` | You generate it: `openssl rand -hex 24`. Must be 16+ characters. Store it in your password manager | `hasAdminToken` |
| `LICENSE_SIGNING_SECRET` | Any long random string (`openssl rand -hex 32`). **Set it even if you never issued a legacy `PRO_` key**: when it is unset the server falls back to a secret that is public in the source, and `PRO_` keys forged with it validate | `hasLegacySigningSecret` |
| `ALLOW_LEGACY_DEV_SECRET` | Leave **unset**. `true` re-accepts `PRO_` keys that were issued while no secret was being read (they are forgeable). Only for honouring early customers while you re-issue them signed keys | - |
| `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` | Razorpay > Settings > API Keys. Only for the landing page "Pay via UPI" button (`/checkout/razorpay`) | - |
| `RAZORPAY_PRO_AMOUNT_PAISE`, `CHECKOUT_CALLBACK_URL` | Optional: price in paise (default 29900) and the redirect after payment | - |

Resend also needs DNS: Resend dashboard > Domains > add `llm-observer.com` and create the SPF/DKIM records
it shows. Until the domain shows "Verified", sending from `licenses@llm-observer.com` fails and a webhook
for a real purchase returns 500 (the provider retries; no key is lost, but nobody is emailed).

## 5. Deploy and attach the domain

```bash
cd packages/license-server
npx vercel --prod        # or push to the branch the project deploys from
```

Vercel > Project > Settings > Domains > add `api.llm-observer.com` and create the DNS record it shows
(a CNAME for a subdomain). Wait until the domain shows as valid with a certificate.

The app talks to `https://api.llm-observer.com` by default. To point an app at another deployment (for
example a preview URL) set `LLM_OBSERVER_LICENSE_SERVER=https://your-deployment.vercel.app` when you start it.

Redeploy after any change to environment variables: functions only see the values that existed when
the deployment was built.

## 6. Register the webhooks

Use the same secret you put in Vercel.

**Lemon Squeezy**: Settings > Webhooks > add.
- URL: `https://api.llm-observer.com/webhook/lemonsqueezy`
- Signing secret: the value of `LEMONSQUEEZY_WEBHOOK_SECRET`
- Events: `subscription_created`, `subscription_payment_success`, `subscription_cancelled`,
  `subscription_expired`, `subscription_resumed` (`subscription_unpaused` is also handled).
  Do not subscribe to `order_created`: it is ignored, and the key is issued from `subscription_created`.
- Lemon Squeezy has separate Test mode and Live mode webhooks. Register both if you want to test first.

**Razorpay**: Settings > Webhooks > add.
- URL: `https://api.llm-observer.com/webhook/razorpay`
- Secret: the value of `RAZORPAY_WEBHOOK_SECRET`
- Events: `subscription.activated`, `subscription.charged`, `subscription.cancelled`, `subscription.halted`,
  `subscription.completed`, `payment.captured` (one-time payments; a subscription's own recurring
  `payment.captured` is deliberately ignored), and `subscription.resumed` if you offer pausing.

## 7. What each event does

| Provider event | Effect |
|---|---|
| LS `subscription_created`; Razorpay `subscription.activated`; Razorpay one-time `payment.captured` | Signs an `LLMO1` key, emails it, records the customer as `active`. Redelivery for a customer already `active` sends no second email |
| LS `subscription_payment_success` / `_resumed` / `_unpaused`; Razorpay `subscription.charged` / `.resumed` | Marks `active` (a renewal after expiry re-enables the key) |
| LS `subscription_cancelled` | Marks `cancelled`: the key keeps working until the period ends |
| LS `subscription_expired`; Razorpay `subscription.cancelled` / `.halted` / `.completed` | Marks `expired`: the next daily check from the app drops it to Free; offline apps keep Pro |
| Anything else | Acknowledged and ignored |

A webhook with a missing or wrong signature gets 401. A webhook when the secret is not configured gets 503.
If the email cannot be sent the response is 500 so the provider retries.

## 8. Run the verifier

```bash
ADMIN_TOKEN='<the token from step 4>' \
  node scripts/verify-license-server.js https://api.llm-observer.com --admin-token-env ADMIN_TOKEN
```

`--admin-token-env` takes the **name** of an environment variable. The script never prints the token or any
customer data. Without that option the authenticated `/admin/report` check is skipped (shown as SKIP).

It is read-only. It sends requests that are meant to be rejected, so it creates no customer, device or
install record and sends no email. It checks:

- `GET /health` returns JSON and every `has*` flag is true (each false one is a FAIL naming the variable);
- `POST /license/validate` answers garbage and non-JSON with 400 JSON, rejects an unsigned `LLMO1`-shaped key,
  and rejects a legacy `PRO_` key forged with the public dev secret;
- a CORS preflight on `/license/validate` succeeds;
- `POST /telemetry/ping` with an invalid body is 400;
- both webhook endpoints answer a deliberately wrong signature with 401 (503 means the secret is unset, which is
  reported as a FAIL naming it; 200 means anyone can forge a payment);
- `GET /admin/report` is 401 without a token or with a wrong one, and 200 JSON with yours;
- `GET /admin.html` is 200 HTML.

Exit code 0 means no FAIL; 1 means at least one FAIL; 2 means wrong usage. Fix what the FAIL lines name,
redeploy and run it again.

**If `GET /health` itself FAILs with "no response within 15s", or every function times out:** see "Known open
risk" below before changing anything else.

## 9. Test purchase (what the verifier cannot show)

The verifier cannot prove a payment becomes an email. Do this once, in the provider's test mode if it has one:

1. Make a test purchase (Lemon Squeezy test mode, or a small Razorpay test payment) with an email you can read.
2. The email arrives with a key starting `LLMO1.` (check spam; check Resend > Logs if it does not).
3. In the app: Settings > License & Billing > paste the key > Activate. The tier shows Pro.
4. Open `https://api.llm-observer.com/admin.html`, enter `ADMIN_TOKEN`. The customer is listed with 1 device.
5. Re-send the same webhook from the provider's dashboard: no second email, and the report is unchanged.
6. Cancel the test subscription: the key keeps working. Expire it: after the app's next daily check (or a
   restart) it drops to Free.

If step 3 says "Invalid license key", the public key in `packages/proxy/src/licenseKeys.ts` does not match
`LICENSE_PRIVATE_KEY` (step 1).

## Known open risk: handler signature on Vercel's Node runtime

Every function in `api/` is written as `export default async function handler(req: Request): Promise<Response>`
(the Web API). The tests run them through an adapter that calls them exactly that way, so they prove the
handlers' logic, not that Vercel invokes them that way.

In the `@vercel/node` 5.3.0 npm package (its dev server; the production launcher was not inspected), a module is treated as a Web handler only when it exports
functions named after HTTP methods (`GET`, `POST`, ...). A module with only a default export is called as
`handler(nodeRequest, nodeResponse)` and its return value is ignored. If production behaves that way, every
endpoint would hang until Vercel's timeout instead of answering, and the verifier's first check would fail with
"no response within 15s". This was not tested on Vercel (no access from the environment this was written in).
If it happens, the fix is in the handlers (for example exporting `GET`/`POST` per route, or adapting
`(req, res)` to the Web handlers), not in this checklist.

## What is and is not tested

Tested in CI (`tests/integration/license-e2e.test.ts`, needs `npm run build:ci` first): the handlers over
real HTTP; routing through `vercel.json` only (every destination exists, every function is routed,
`/admin.html` is served from `public/`); signed webhooks, retries and cancellation/expiry, forged and unsigned
keys, legacy `PRO_` keys, Razorpay one-time vs subscription charges, opt-in telemetry; the compiled app's
`activateLicense` / `getLicenseInfo` / `revalidateLicense` against them; and `scripts/verify-license-server.js`
itself (all-green, misconfigured, wrong token and permissive-server cases).

Not tested anywhere: the Vercel platform (runtime handler invocation, how `public/` is served alongside
`routes`, cold starts, timeouts), real Upstash (the test uses an in-memory fake of the few commands the
store uses), real Resend delivery and domain verification, real Lemon Squeezy / Razorpay webhook payloads
(the fixtures are written from their documentation), and DNS/TLS for `api.llm-observer.com`.
