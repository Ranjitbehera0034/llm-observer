# LLM Observer payment service

The application works free without a cloud service. Pro requires a configured HTTPS license service. Do not enable checkout until a complete test-mode purchase passes.

## Plans

- Pro: $9/month or $79/year through Lemon Squeezy recurring products.
- India: ₹799 for a 30-day Razorpay pass, explicitly **no automatic renewal**.
- Free: one project and 7-day request retention. Pro: 100 projects and 90-day request retention. Session history is separate from request retention.
- Teams: pilot, not a self-service product.

## Deployment

Deploy this directory to Vercel using the existing `vercel.json`. Set the exact environment names in `.env.example` in the deployment dashboard. The signing secret must contain at least 32 random characters. Never ship provider API keys in the desktop app or website.

Lemon Squeezy: create monthly and annual variants, set their comma-separated IDs plus store ID and API key. Register `/webhook/lemonsqueezy` for `subscription_created` and `subscription_payment_success`. Invoices reference `attributes.subscription_id`, so renewals reuse the original key.

Razorpay: register `/webhook/razorpay` for `payment_link.paid`. Checkout creates a non-recurring ₹799 link tagged with the product and plan. The service reads the link and its captured payment before issuing a key. Partial payments are disabled.

Configure `RESEND_API_KEY` and a verified `EMAIL_FROM`. Configure `CHECKOUT_CALLBACK_URL` to the deployed thank-you page. Webhooks fail closed without a signature secret; delivery failures return a retryable status. Resend receives a stable idempotency key.

The payment providers hold durable entitlement state. Validation queries current subscription/invoice or payment-link/payment records. It rejects wrong products, refunds, unpaid/expired subscriptions and expired passes. Cancellation retains access until `ends_at`. A failed renewal suspends access until a successful retry. Test subscriptions require `PAYMENTS_TEST_MODE=true` on a separate test deployment.

## Public configuration

- Release build: `LICENSE_SERVER_URL=https://<your-service>/license/validate` (also supports runtime override for development).
- Main landing page: `VITE_LEMONSQUEEZY_CHECKOUT_URL`, `VITE_LEMONSQUEEZY_YEARLY_CHECKOUT_URL`, `VITE_LICENSE_SERVER_URL` (origin).
- Separate Next website: corresponding `NEXT_PUBLIC_` variables.

Missing checkout configuration displays an unavailable state instead of a placeholder payment link. Buyers should not configure environment variables themselves.

## Verification

Run `npm test --workspace=@llm-observer/license-server` and `npm run build --workspace=@llm-observer/license-server`.

Before opening sales, verify with provider test accounts: first payment, email receipt/key, activation on a clean app installation, duplicate webhook, renewal, failed renewal, cancellation through paid-through date, refund, expiry, email retry, invalid key, service outage, and reinstall on another device. Automated tests mock provider and email responses; they do not certify live merchant configuration.

Clients refresh entitlement every six hours. During outages a previously verified lease lasts at most 72 hours, never beyond the paid-through date. No raw prompts, responses or session history are sent for licensing. Status responses do not reveal license keys.

## Existing customers

New keys preserve full provider IDs and use full SHA-256 signatures. Old truncated keys cannot reliably identify every original payment. Before rolling out to paying customers, reissue from verified provider records and email customers their replacement keys. Keep signing secrets stable across deployments. Do not silently grant perpetual access to old prefix-only keys.

Recovery: resend the original purchase email. Customers may use the same key on a replacement device; this release does not claim seat enforcement. Subscriptions are managed through Lemon Squeezy's portal. Razorpay passes do not renew automatically.

## Customer visibility (optional)

Apply `sql/customer-reporting.sql` to a dedicated Supabase/PostgREST database. Configure `CUSTOMER_STORE_URL` (the `/rest/v1` base), `CUSTOMER_STORE_SERVICE_KEY` and a distinct random `CUSTOMER_ADMIN_TOKEN` of at least 32 characters. Service/admin secrets never belong in desktop builds or public environment variables. Visit `/customers.html` on the license server and enter the owner token to view dated billing snapshots and opt-in installations. Pagination returns 100 records per collection. Demo records are browser-only and do not create accounts or licenses.

Webhook delivery and license validation maintain billing snapshots. Enable all supported Lemon Squeezy subscription lifecycle events; backfill older customers separately from verified provider records. A snapshot is not a live invoice query. Inactive states are consolidated as `inactive`, while current entitlement is always verified at activation. Razorpay payment-link refund reconciliation still requires provider validation. An outage in customer reporting does not revoke a valid license.

Activity is opt-in in app Settings. The server verifies supplied licenses; it never trusts a client-supplied plan. Free installations have random IDs, not identities. `last_seen` reports the app running, not user engagement. A missing heartbeat means unknown activity. Stop and forget authenticates deletion with the installation secret; offline deletion is retryable. Billing records remain separate. Apply gateway rate limits before enabling public ingestion and schedule the SQL cleanup for activity older than 90 days. Test RLS, RPC credential mismatch, deletion, and isolation in staging before rollout; unit mocks do not validate deployed PostgreSQL permissions.

## International Pro checkout

`POST /checkout/lemonsqueezy` accepts `{ email, plan: "monthly" | "yearly" }` and creates a hosted checkout through Lemon Squeezy's API. Configure the monthly/yearly variant IDs and include both in `LEMONSQUEEZY_VARIANT_IDS`. Only the server chooses variants; submitted prices/variant IDs are ignored. Prices, taxes, supported countries/payment methods, and trial policy are shown by the merchant checkout. Do not advertise worldwide availability without checking the provider's country restrictions. `PAYMENTS_TEST_MODE=true` is for staging only. A completed redirect is not proof of payment: signed webhook verification and provider-backed license validation enable Pro.

The Next.js landing repository forwards `/api/checkout` to the configured `LICENSE_SERVER_URL` origin using a server-side request. The public app and the merchant keys remain separate. Live checkout cannot be enabled without an approved merchant account and the required deployment secrets.
