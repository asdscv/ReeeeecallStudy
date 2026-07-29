import { supabase } from '../supabase'
import type { PaymentProvider, PaymentIntent, CheckoutResult } from './provider'

// ─────────────────────────────────────────────────────────────────────────────
// Lemon Squeezy (Merchant of Record) payment adapter — web checkout.
//
// Lemon Squeezy is a Merchant of Record: IT owns the sale, collects + remits
// global VAT/sales tax, and hosts the entire checkout. So this adapter is much
// simpler than a PG SDK — there is NO server-side "create checkout session" call:
// we just REDIRECT the browser to a hosted checkout URL for the right variant,
// tagged with our server-issued merchant_uid as `checkout[custom][merchant_uid]`.
//
// It NEVER grants anything. When the buyer pays, Lemon Squeezy's server POSTs a
// SIGNED webhook (order_created / subscription_created) to the
// `lemonsqueezy-webhook` edge fn, which carries `meta.custom_data.merchant_uid`
// straight back → confirm_payment(merchant_uid, 'lemonsqueezy', order_id) applies
// the credit / subscription grant server-side. The client only opens checkout.
//
// Because Lemon Squeezy is Merchant of Record, the PRICE lives on the LS
// product/variant, NOT in this code. The owner MUST set each LS variant's price to
// match our billing_products catalog (three credit packs + the two card-storage
// subscriptions: sub_5k_monthly and sub_unlimited_monthly) — otherwise the buyer is
// charged a figure that disagrees with what confirm_payment grants.
//
// ── OWNER GO-LIVE CHECKLIST (the only work left before this charges real money) ──
//   1. Create a Lemon Squeezy STORE, then a PRODUCT + VARIANT per ACTIVE catalog entry
//      (the store currency is USD; prices need not numerically equal the ₩ catalog —
//      grants key off the variant→product map, never the amount):
//        credits_1000 / credits_5000 / credits_10000  (one-time credit packs)
//        sub_5k_monthly (5,000-card plan) / sub_unlimited_monthly (100,000-card plan)  (monthly subs)
//   2. Set these WEB env vars (Cloudflare Pages project vars / .env — Vite exposes
//      any `VITE_`-prefixed var to the client bundle at build time):
//        VITE_LEMONSQUEEZY_STORE    = reeeeecall            (the store SUBDOMAIN only,
//                                                            i.e. <store>.lemonsqueezy.com)
//        VITE_LEMONSQUEEZY_VARIANTS = {"credits_1000":"<slug>","credits_5000":"<slug>",
//                                      "credits_10000":"<slug>","sub_5k_monthly":"<slug>",
//                                      "sub_unlimited_monthly":"<slug>"}
//                                      (product_id → variant SLUG/UUID — the /checkout/buy/<slug>
//                                       path; NOT the numeric variant id, which 404s)
//        VITE_PAYMENT_PROVIDER      = lemonsqueezy          (selects THIS adapter)
//        VITE_PAYMENTS_ENABLED      = true                  (flips the checkout gate on)
//   3. Deploy the `lemonsqueezy-webhook` edge fn and set its
//      LEMONSQUEEZY_WEBHOOK_SECRET secret; in the LS dashboard add the webhook
//      endpoint (Settings → Webhooks) for events order_created (+ subscription_created)
//      with that same signing secret. This is what makes confirm_payment run — the
//      grant is webhook-driven, never client-driven.
//   4. For EACH product, set its post-purchase "Redirect URL" to
//        ${APP}/settings?pay=success
//      so on return the shared billing store's handlePaymentReturn() refreshes the
//      wallet / subscription / usage surfaces. (merchant_uid is NOT needed there —
//      the webhook is authoritative; the redirect is just a UX refresh.)
//
// Until VITE_LEMONSQUEEZY_STORE + a matching VITE_LEMONSQUEEZY_VARIANTS entry are
// set, checkout throws NOT_CONFIGURED; the billing store surfaces it as a checkout
// error and never pretends a payment happened.
// ─────────────────────────────────────────────────────────────────────────────

const NOT_CONFIGURED =
  'NOT_CONFIGURED: set VITE_LEMONSQUEEZY_STORE and VITE_LEMONSQUEEZY_VARIANTS'

// Parse VITE_LEMONSQUEEZY_VARIANTS (a JSON string mapping our product_id → the LS
// variant's SLUG) defensively: any malformed/non-object/empty value yields {} so a bad
// env can only ever produce NOT_CONFIGURED, never a wrong-variant charge.
//
// ⚠️ The value MUST be each variant's `slug` (a UUID, e.g. "a98e3678-…"), NOT its
// numeric variant id. The hosted checkout lives at /checkout/buy/<SLUG>; the numeric
// id (e.g. 1864772) 404s there. The numeric id is only used server-side by the
// webhook's LEMONSQUEEZY_VARIANT_MAP. (String values pass through; numbers are coerced
// to strings only as a lenient fallback — real slugs are always strings.)
function parseVariants(raw: string): Record<string, string> {
  if (!raw) return {}
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return {}
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof value === 'string' && value) out[key] = value
    else if (typeof value === 'number' && Number.isFinite(value)) out[key] = String(value)
  }
  return out
}

export class LemonsqueezyProvider implements PaymentProvider {
  readonly id = 'lemonsqueezy'
  readonly redirects = true // hosted checkout on <store>.lemonsqueezy.com
  readonly labelKey = 'methods.lemonsqueezy'
  isAvailable(): boolean {
    const store = String(import.meta.env.VITE_LEMONSQUEEZY_STORE ?? '').trim()
    const variants = parseVariants(String(import.meta.env.VITE_LEMONSQUEEZY_VARIANTS ?? ''))
    return !!store && Object.keys(variants).length > 0
  }
  supports(): boolean { return true }

  async checkout(intent: PaymentIntent, target?: Window | null): Promise<CheckoutResult> {
    // ── Why a server round-trip (not a static buy link) ──────────────────────────
    // This store's STATIC buy links (/checkout/buy/<slug>) render in TEST mode even
    // though the store is fully live (Setup complete, test mode off) — a LemonSqueezy
    // static-buy-link quirk. Only checkouts CREATED via the API with test_mode:false
    // render LIVE. So we ask the `lemonsqueezy-checkout` edge fn (which holds the secret
    // LS API key) to mint a live checkout for OUR intent: it verifies we own the intent,
    // maps product→variant server-side, tags merchant_uid into custom data, and returns
    // the hosted URL. The webhook path (meta.custom_data.merchant_uid → confirm_payment)
    // is unchanged — only the checkout URL's origin moved from a static link to an API
    // object. (VITE_LEMONSQUEEZY_STORE/VARIANTS remain the client "configured" gate via
    // isAvailable(); the variant SLUGS are no longer used to build the URL.)
    if (!this.isAvailable()) throw new Error(NOT_CONFIGURED)

    const { data, error } = await supabase.functions.invoke<{ url?: string }>(
      'lemonsqueezy-checkout',
      { body: { merchant_uid: intent.merchantUid } },
    )
    const url = data?.url
    if (error || !url) {
      // Fail loud — the billing store catches this and shows a checkout error rather
      // than silently pretending the payment happened.
      throw new Error(`CHECKOUT_FAILED: ${error?.message ?? 'no checkout url returned'}`)
    }

    // Open the hosted checkout in the blank tab the billing store pre-opened within the
    // click gesture, so the app tab stays put and the store can poll the intent for the
    // grant. If the popup was blocked (target null/closed) fall back to same-tab
    // navigation — the ?pay=success redirect + handlePaymentReturn still resolves it.
    // Either way this is a redirect flow: ok/canceled are not meaningful in-page.
    if (target && !target.closed) {
      target.location.href = url
    } else {
      window.location.href = url
    }
    return { ok: false, redirecting: true }
  }
}
