/*
 * IEP Year Planner — payment configuration (the ONLY switch for payments).
 *
 * Payments are OFF by default and stay off until the founder opens a
 * merchant account with ONE provider (Stripe, PayPal or Razorpay) and
 * pastes that provider's HOSTED payment links below. To turn payments on:
 *   1. Create one hosted payment link per paid plan in the provider's
 *      dashboard (Monthly $5, Yearly $39) and paste the URLs below.
 *   2. Set `enabled: true`.
 * The Plans page then shows a "Subscribe" button per paid plan that opens
 * the provider's hosted page, passing the signed-in user's id so the
 * payment webhook can activate the right account:
 *   - Stripe payment links accept `?client_reference_id=<user id>`.
 *   - PayPal / Razorpay links get `?uid=<user id>` appended (their hosted
 *     pages must be configured to carry it through to the webhook as the
 *     custom id / notes — see supabase/functions/payment-webhook/index.ts).
 *
 * Google Pay, Apple Pay and card fields are features of the PROVIDER's
 * hosted page — this site never sees, collects or processes card details
 * itself. While `enabled` is false (or a plan's link is empty), the Plans
 * page keeps its honest "card payments open soon" behaviour and nothing
 * is charged or recorded anywhere.
 */
window.IEP_PAY = {
  enabled: false,
  providers: {
    stripe:   { monthly: "", yearly: "" },
    paypal:   { monthly: "", yearly: "" },
    razorpay: { monthly: "", yearly: "" }
  }
};
