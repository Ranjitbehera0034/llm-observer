# LLM Observer — License Server

The cloud relay that bridges payment webhooks (Razorpay / Lemon Squeezy) to your local LLM Observer installation. Runs as a Vercel Serverless deployment.

```
packages/license-server/
├── api/
│   ├── health.ts                    # GET  /health  (shows which env vars are set)
│   ├── admin/report.ts              # GET  /admin/report  (owner view, ADMIN_TOKEN)
│   ├── checkout/razorpay.ts         # POST /checkout/razorpay
│   ├── license/validate.ts          # POST /license/validate
│   ├── telemetry/ping.ts            # POST /telemetry/ping  (opt-in install count)
│   └── webhook/
│       ├── lemonsqueezy.ts          # POST /webhook/lemonsqueezy
│       └── razorpay.ts              # POST /webhook/razorpay
├── public/admin.html                # Owner view UI
├── scripts/keygen.mjs               # Generates the Ed25519 signing keypair
└── src/
    ├── signing.ts                   # LLMO1 key signing (Ed25519)
    ├── issue.ts                     # Issue + email + record a customer
    ├── store.ts                     # Customer/activation/install records (Upstash Redis)
    ├── keyGenerator.ts              # Legacy PRO_ key verification + webhook HMAC
    └── emailService.ts              # Resend email delivery (dark-mode HTML)
```

---

## How It Works

```
Customer pays via Razorpay/Lemon Squeezy
           ↓
Payment provider fires webhook → this server
           ↓
Verifies HMAC-SHA256 signature
           ↓
Signs an LLMO1 license key (Ed25519) and records the customer
           ↓
Sends dark-mode HTML email via Resend
           ↓
Customer pastes key into LLM Observer Settings → Instant activation ✅
```

---

## 1. Deploy to Vercel in 2 minutes

```bash
cd packages/license-server

# Install Vercel CLI
npm install -g vercel

# Deploy
vercel --prod
```

Then attach the domain the app uses by default: Vercel → Project → Settings →
Domains → add **`api.llm-observer.com`** and create the CNAME record it shows
you at your DNS provider. (Any other domain works if you set
`LLM_OBSERVER_LICENSE_SERVER` for the app, but the published npm package
talks to `https://api.llm-observer.com`.)

Check it: `curl https://api.llm-observer.com/health` — every `has*` flag should be `true`.

---

## 2. Configure Environment Variables

In Vercel Dashboard → Your Project → Settings → Environment Variables
(full list with comments: [`.env.example`](.env.example)):

| Variable | Where to get it |
|---|---|
| `LICENSE_PRIVATE_KEY` | Signs license keys. Run `npm run keygen` here; paste the private key. The matching public key must be in `packages/proxy/src/licenseKeys.ts` |
| `LEMONSQUEEZY_WEBHOOK_SECRET` | LS Dashboard → Settings → Webhooks → Signing Secret. **Webhooks are rejected without it** |
| `RAZORPAY_WEBHOOK_SECRET` | Razorpay Dashboard → Settings → Webhooks → Secret. **Webhooks are rejected without it** |
| `LEMONSQUEEZY_TEAM_VARIANT_IDS` / `RAZORPAY_TEAM_PLAN_IDS` | Optional, Team plan (beta). Comma lists of the Lemon Squeezy variant ids / Razorpay plan ids that sell Team; those purchases get a `plan: 'team'` key with seats = subscription quantity, everything else stays `pro`. The field names the webhooks read (`variant_id`, `first_subscription_item.quantity`, `plan_id`, `quantity`) come from the vendors' docs as remembered and have not been checked against a live payload |
| `RESEND_API_KEY` | [resend.com](https://resend.com) → API Keys (free: 100/day) |
| `EMAIL_FROM` | `licenses@llm-observer.com` (must be verified in Resend) |
| `KV_REST_API_URL` / `KV_REST_API_TOKEN` | Vercel → Storage → add **Upstash for Redis** (free tier) — sets both automatically. Needed for the owner view |
| `ADMIN_TOKEN` | Your password for the owner view. Run `openssl rand -hex 24` |

---

## 3. Register Webhooks

### Lemon Squeezy
1. Dashboard → Settings → Webhooks → Add Webhook
2. URL: `https://api.llm-observer.com/webhook/lemonsqueezy`
3. Events: ✅ `subscription_created` ✅ `subscription_payment_success` ✅ `subscription_cancelled` ✅ `subscription_expired` ✅ `subscription_resumed`
4. Copy the Signing Secret → add to Vercel env

### Razorpay
1. Dashboard → Settings → Webhooks → Add New Webhook
2. URL: `https://api.llm-observer.com/webhook/razorpay`
3. Events: ✅ `subscription.activated` ✅ `subscription.charged` ✅ `subscription.cancelled` ✅ `subscription.halted` ✅ `subscription.completed` ✅ `payment.captured`
4. Enter a secret → add to Vercel env

---

## 4. See Your Customers (owner view)

Open **`https://api.llm-observer.com/admin.html`** and enter your `ADMIN_TOKEN`. It shows:

- **Paying customers** — email, provider, amount, status (`active` / `cancelled` = cancels at period end / `expired`), how many devices activated the key, and when it was last used.
- **Active installs** — free and Pro installs seen in the last 7 / 30 days, by version and OS. Only users who turned on *Settings → Share anonymous usage stats* (off by default) are counted, so treat this as a lower bound; npm download counts give the wider picture.

The same data as JSON: `curl -H "Authorization: Bearer $ADMIN_TOKEN" https://api.llm-observer.com/admin/report`.

Customers who bought before this was set up won't appear until their app next checks in with a key (once a day) — and the email/amount columns only fill in from payment webhooks.
Your payment dashboards (LemonSqueezy → Customers, Razorpay → Subscriptions) remain the source of truth for billing.

---

## 5. How licensing works

1. Customer pays → webhook → this server signs an `LLMO1.…` key (Ed25519) and emails it.
2. The app verifies the signature **offline** with the embedded public key — nobody can forge a key from the open-source code, and Pro keeps working if this server is down.
3. On activation and once a day after, the app calls `POST /license/validate` with the key, a machine ID and its version. That records the device and, if the subscription has **expired**, tells the app to drop to Free. Network errors never downgrade anyone.

Keys issued before 2.0.1 (`PRO_LS_…` / `PRO_RZP_…`) are still verified here via `LICENSE_SIGNING_SECRET`. See `ALLOW_LEGACY_DEV_SECRET` in `.env.example` if they were issued while no secret was being read.

---

## 6. Test Locally

```bash
cd packages/license-server
npm test          # unit tests, no network needed
npm run dev       # Vercel dev environment
curl http://localhost:3000/health
```

Webhooks need a valid signature even locally. To simulate one:

```bash
SECRET=test-secret   # must match LEMONSQUEEZY_WEBHOOK_SECRET in your local env
BODY='{"data":{"id":"999","attributes":{"user_email":"you@example.com","total":900,"currency":"USD"}}}'
SIG=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$SECRET" | cut -d' ' -f2)
curl -X POST http://localhost:3000/webhook/lemonsqueezy \
  -H "x-event-name: subscription_created" -H "x-signature: $SIG" -d "$BODY"
```

> **Note**: Without `RESEND_API_KEY` set, the webhook will fail after key generation. Set up Resend first.

---

## Resend Setup (Free Tier)

1. Sign up at [resend.com](https://resend.com) — free, no credit card
2. Add your domain (or use the sandbox `onboarding@resend.dev` for testing)
3. Generate an API key → set as `RESEND_API_KEY`

Resend free tier: **100 emails/day, 3,000/month** — plenty for early launch.

---

## License Key Format

```
LLMO1.<base64url payload>.<base64url Ed25519 signature>
payload = { "v": 1, "sub": "ls:<subscription id>" | "rzp:<id>", "plan": "pro", "iat": <unix seconds> }
```

Legacy keys (before 2.0.1) look like `PRO_LS_A1B2C3D4_SUB12345678` — an 8-char HMAC
fingerprint over the provider and subscription ID. They're still accepted by
`/license/validate`; new purchases always get LLMO1 keys.
