/**
 * Single source of truth for what LLM Observer itself costs, so the
 * "plan value" ROI multiple (savings identified ÷ subscription price) is
 * computed from one real number instead of being duplicated — or worse,
 * made up — in multiple places.
 *
 * $19/mo is what actually charges: packages/license-server/api/checkout/razorpay.ts
 * (₹1,599 default) and landing-page/src/App.tsx both agree with this figure,
 * and packages/cli/README.md's pricing table has been aligned to match.
 *
 * As of 2026-07-15, the live llm-observer.com marketing site was found
 * advertising $49/mo — stale content not sourced from this repo's
 * landing-page package. That's an external-deployment fix (redeploy or
 * update whatever CMS/host serves that domain), not something a code change
 * here can reach. This constant, and everywhere in-repo, should keep
 * following the price that actually has a working checkout.
 */
export const PRO_PLAN_MONTHLY_USD = 19;
