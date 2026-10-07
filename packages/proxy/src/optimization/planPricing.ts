/**
 * Single source of truth for what LLM Observer itself costs, so the
 * "plan value" ROI multiple (savings identified ÷ subscription price) is
 * computed from one real number instead of being duplicated — or worse,
 * made up — in multiple places.
 *
 * Pro is $9/mo ($79/yr, ₹299/mo via Razorpay in India) — the same figures
 * shown by the dashboard's checkout (packages/dashboard/src/pages/Settings.tsx),
 * landing-page/src/App.tsx, packages/cli/README.md and the Razorpay checkout
 * default in packages/license-server/api/checkout/razorpay.ts. The amount
 * actually charged is configured in the LemonSqueezy / Razorpay dashboards;
 * keep them in step with this constant.
 */
export const PRO_PLAN_MONTHLY_USD = 9;
