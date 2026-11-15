# Razorpay launch for an individual seller

Owner action is required for identity verification and payment-method approval. Do not enter PAN, Aadhaar, bank details, or live merchant secrets in this repository or in a PR.

## Merchant account

1. Apply using the actual legal business type. Razorpay documents an **Individual / unregistered business** route using a personal PAN, identity/address verification, and bank details. A company PAN is not required for that route. Complete any CKYC or video-KYC steps Razorpay requests.
2. Supply the live product URL, a true software description, seller/contact details, Terms, Privacy, Digital Delivery, and a decided Refund and Cancellation policy. The website must show the same seller and product described in the application. Do not invent an address or legal name.
3. After domestic activation, request international payment methods in Razorpay Account & Settings → International payments. Its current documentation says individuals such as freelancers must integrate PayPal for international payments or use International Bank Transfer; direct foreign-card acceptance is listed for eligible registered businesses. Confirm the exact methods and recurring eligibility on this merchant account with Razorpay before changing checkout copy.

## Existing implementation and required validation

- The Razorpay integration currently creates an INR 799 Payment Link for a non-recurring 30-day Pro pass. It is not a Razorpay subscription and it does not promise international card acceptance.
- The separate Lemon Squeezy monthly/yearly checkout remains the default in the landing page. Do not remove it or replace it with a claimed global Razorpay card flow until the merchant account and method have been approved.
- Deploy `packages/license-server` to HTTPS and configure server-only `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`, `RESEND_API_KEY`, `EMAIL_FROM`, `CHECKOUT_CALLBACK_URL`, and signing settings from `.env.example`. Never use test keys in a live deployment. The landing page needs its `LICENSE_SERVER_URL` set to the deployed origin.
- Register the signed `payment_link.paid` webhook. Test domestic and every approved international method in a staging account, including cancelled/failed payment, duplicate webhook, key email, activation, expiry, refund, and support recovery. A redirect is not payment confirmation.
- Before offering Razorpay recurring subscriptions, implement provider subscription creation, lifecycle webhooks, cancellation/failed-renewal handling, and entitlement validation. Payment Links do not satisfy that requirement.

Sources: [Razorpay international payments](https://razorpay.com/docs/payments/international-payments/), [Razorpay business-type onboarding](https://razorpay.com/blog/minimum-documents-payment-gateway-onboarding-india/).
