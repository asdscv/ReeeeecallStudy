import type { PaymentProvider, PaymentIntent, CheckoutResult } from './provider'

// ─────────────────────────────────────────────────────────────────────────────
// TossPayments (토스페이먼츠) adapter — web checkout.
//
// Toss is a Korean PG (not a Merchant of Record): it charges in KRW and needs an
// explicit SERVER confirm after the buyer authorizes payment. Rather than open Toss's
// SDK from here (it must render into a page + handle billing-auth for subscriptions),
// this adapter navigates the pre-opened tab to OUR OWN `/checkout/toss` route, which
// loads the Toss SDK, reads the server-issued intent, and runs requestPayment (credit
// pack) or requestBillingAuth (subscription). Toss then redirects to `/checkout/toss/
// return`, which POSTs the result to the toss-confirm / toss-billing edge fn to grant.
//
// Because that page is same-origin, this adapter is a plain redirect (like LemonSqueezy)
// — the billing store's pre-opened tab + intent poll are reused verbatim.
//
// GO-LIVE: set VITE_TOSS_CLIENT_KEY (test_ck_… → live_ck_…) as a build var and add
// 'toss' to VITE_PAYMENT_PROVIDERS; server needs TOSS_SECRET_KEY (test_sk_… → live_sk_…).
// ─────────────────────────────────────────────────────────────────────────────

export class TossProvider implements PaymentProvider {
  readonly id = 'toss'
  readonly redirects = true
  readonly labelKey = 'methods.toss'

  // The client key is baked into the bundle; without it the Toss checkout page can't
  // init the SDK, so treat the provider as unavailable (dropped from the picker).
  isAvailable(): boolean {
    return !!String(import.meta.env.VITE_TOSS_CLIENT_KEY ?? '').trim()
  }

  // Toss supports one-time (requestPayment) and recurring via billing key
  // (requestBillingAuth) — both product kinds.
  supports(): boolean {
    return true
  }

  async checkout(intent: PaymentIntent, target?: Window | null): Promise<CheckoutResult> {
    // Hand off to our same-origin Toss checkout page, carrying only the server-issued
    // merchant_uid (it re-reads amount/kind from the intent — never trusts the client).
    const origin = typeof window !== 'undefined' ? window.location.origin : ''
    const url = `${origin}/checkout/toss?mu=${encodeURIComponent(intent.merchantUid)}`
    if (target && !target.closed) target.location.href = url
    else if (typeof window !== 'undefined') window.location.href = url
    return { ok: false, redirecting: true }
  }
}
