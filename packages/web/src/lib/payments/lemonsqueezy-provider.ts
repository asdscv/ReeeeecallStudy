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
// match our billing_products catalog (₩1,000 / ₩5,000 / ₩10,000 credit packs and
// ₩4,900 Pro-monthly) — otherwise the buyer is charged a figure that disagrees
// with what confirm_payment grants.
//
// ── OWNER GO-LIVE CHECKLIST (the only work left before this charges real money) ──
//   1. Create a Lemon Squeezy STORE, then a PRODUCT + VARIANT per catalog entry,
//      each priced to match billing_products:
//        credits_1000      → ₩1,000     credits_5000   → ₩5,000
//        credits_10000     → ₩10,000    sub_pro_monthly→ ₩4,900 (monthly subscription)
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

// Best-effort read of the signed-in user's email to prefill checkout[email]. It is
// purely a UX nicety (buyer doesn't retype it); the grant never depends on it, so
// any failure/absence simply omits the param.
async function currentUserEmail(): Promise<string | null> {
  try {
    const { data } = await supabase.auth.getSession()
    return data.session?.user?.email ?? null
  } catch {
    return null
  }
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
    const store = String(import.meta.env.VITE_LEMONSQUEEZY_STORE ?? '').trim()
    const variants = parseVariants(String(import.meta.env.VITE_LEMONSQUEEZY_VARIANTS ?? ''))
    const variantId = variants[intent.productId]
    if (!store || !variantId) {
      // Missing store or no variant mapped for this product → fail loud. The billing
      // store catches this and shows a checkout error rather than silently pretending
      // the payment happened.
      throw new Error(NOT_CONFIGURED)
    }

    // Build the hosted-checkout URL (variantId here is the variant SLUG/UUID, not the
    // numeric id — the numeric id 404s on this path):
    //   https://<store>.lemonsqueezy.com/checkout/buy/<variant-slug>
    //     ?checkout[custom][merchant_uid]=<merchant_uid>   ← returns as meta.custom_data.merchant_uid
    //     &checkout[email]=<email>                          ← optional prefill (UX only)
    // URLSearchParams percent-encodes the bracket keys; Lemon Squeezy decodes them.
    const params = new URLSearchParams()
    params.set('checkout[custom][merchant_uid]', intent.merchantUid)
    const email = await currentUserEmail()
    if (email) params.set('checkout[email]', email)

    const url = `https://${store}.lemonsqueezy.com/checkout/buy/${variantId}?${params.toString()}`

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
