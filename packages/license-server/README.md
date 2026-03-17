# LLM Observer — License Server

The cloud relay that bridges payment webhooks (Razorpay / Lemon Squeezy) to your local LLM Observer installation. Runs as a Vercel Serverless deployment.

```
packages/license-server/
├── api/
│   ├── health.ts                    # GET  /health
│   ├── license/
│   │   └── validate.ts              # POST /license/validate
│   └── webhook/
│       ├── lemonsqueezy.ts          # POST /webhook/lemonsqueezy
│       └── razorpay.ts              # POST /webhook/razorpay
└── src/
    ├── keyGenerator.ts              # HMAC-signed PRO_ key generation
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
Generates signed PRO_ license key (deterministic — same payment = same key)
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

Vercel will give you a URL like: `https://llm-observer-license.vercel.app`

---

## 2. Configure Environment Variables

In Vercel Dashboard → Your Project → Settings → Environment Variables:

| Variable | Where to get it |
|---|---|
| `RESEND_API_KEY` | [resend.com](https://resend.com) → API Keys (free: 100/day) |
| `EMAIL_FROM` | `licenses@yourdomain.com` (must be verified in Resend) |
| `LEMONSQUEEZY_WEBHOOK_SECRET` | LS Dashboard → Settings → Webhooks → Signing Secret |
| `RAZORPAY_WEBHOOK_SECRET` | Razorpay Dashboard → Settings → Webhooks → Secret |
| `LICENSE_SIGNING_SECRET` | Run: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |

---

## 3. Register Webhooks

### Lemon Squeezy
1. Dashboard → Settings → Webhooks → Add Webhook
2. URL: `https://your-vercel-url.vercel.app/webhook/lemonsqueezy`
3. Events: ✅ `subscription_created` ✅ `subscription_payment_success` ✅ `order_created`
4. Copy the Signing Secret → add to Vercel env

### Razorpay
1. Dashboard → Settings → Webhooks → Add New Webhook
2. URL: `https://your-vercel-url.vercel.app/webhook/razorpay`
3. Events: ✅ `subscription.activated` ✅ `subscription.charged` ✅ `payment.captured`
4. Enter a secret → add to Vercel env

---

## 4. Point LLM Observer to the Validator

In the local proxy, set:
```bash
LICENSE_SERVER_URL=https://your-vercel-url.vercel.app/license/validate
```

Or in `.env`:
```
LICENSE_SERVER_URL=https://llm-observer-license.vercel.app/license/validate
```

---

## 5. Test Locally

```bash
# Start Vercel dev environment
cd packages/license-server
npm run dev

# Health check
curl http://localhost:3000/health

# Simulate a Lemon Squeezy webhook (dev mode — no signature check)
curl -X POST http://localhost:3000/webhook/lemonsqueezy \
  -H "Content-Type: application/json" \
  -H "x-event-name: subscription_created" \
  -d '{
    "data": {
      "id": "sub_999",
      "attributes": {
        "user_email": "you@example.com",
        "total": 900,
        "currency": "USD"
      }
    }
  }'

# Simulate Razorpay
curl -X POST http://localhost:3000/webhook/razorpay \
  -H "Content-Type: application/json" \
  -d '{
    "event": "subscription.activated",
    "payload": {
      "subscription": { "entity": { "id": "sub_123", "customer_id": "cust_456", "amount": 29900, "currency": "INR" } },
      "payment": { "entity": { "email": "you@example.com", "amount": 29900 } }
    }
  }'
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

Generated keys follow this pattern:
```
PRO_LS_A1B2C3D4_SUB12345678
PRO_RZP_E5F6G7H8_SUBRSUB123
     │   │        │
     │   │        └── Subscription ID (sanitized, max 12 chars)
     │   └── 8-char HMAC fingerprint (unforgeable without the secret)
     └── Provider: LS = Lemon Squeezy, RZP = Razorpay
```
