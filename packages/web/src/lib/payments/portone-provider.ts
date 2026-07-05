import type { PaymentProvider, PaymentIntent, CheckoutResult } from './provider'

// ─────────────────────────────────────────────────────────────────────────────
// PortOne (포트원) v2 browser-SDK payment adapter — web checkout.
//
// Opens the PortOne v2 payment window for a SERVER-issued PaymentIntent and reports
// how the client-side flow resolved (paid / canceled / failed). It NEVER grants
// anything: the actual credit / subscription grant happens SERVER-side when
// PortOne's server POSTs the signed webhook → payment-webhook edge fn →
// confirm_payment(merchant_uid, …). The client only initiates + reports.
//
// ── OWNER GO-LIVE SETUP (the only work left before this charges real money) ──
//   1. In the PortOne admin console (https://admin.portone.io) create a STORE,
//      then add a CHANNEL — i.e. a PG contract (토스페이먼츠 / KG이니시스 /
//      나이스페이 / KCP …). The channel gives you a channel key.
//   2. Set these WEB env vars (Cloudflare Pages project vars / .env — Vite exposes
//      any `VITE_`-prefixed var to the client bundle at build time):
//        VITE_PORTONE_STORE_ID     = store-xxxxxxxx-…     (콘솔 > 연동 정보, 우측 상단)
//        VITE_PORTONE_CHANNEL_KEY  = channel-key-xxxx-…   (that channel's key)
//        VITE_PAYMENT_PROVIDER     = portone               (selects THIS adapter)
//        VITE_PAYMENTS_ENABLED     = true                  (flips the checkout gate on)
//   3. In the PortOne console, set the CHANNEL's WEBHOOK URL to the deployed
//      payment-webhook edge function URL, and set that function's
//      PAYMENT_WEBHOOK_SECRET. That is what makes confirm_payment run server-side
//      on PortOne's callback — the grant is webhook-driven, not client-driven.
//
// Until VITE_PORTONE_STORE_ID + VITE_PORTONE_CHANNEL_KEY are set, checkout throws
// NOT_CONFIGURED; the billing store surfaces it as a checkout error and never
// pretends a payment happened.
//
// NOTE — the `currency` value is SDK-version-dependent: @portone/browser-sdk 0.1.x
// (what package.json pins, ^0.1.9) expects 'KRW'; the older 0.0.x expected
// 'CURRENCY_KRW'. This file is written against 0.1.x. If you ever pin an older
// 0.0.x, change 'KRW' → 'CURRENCY_KRW' below.
// ─────────────────────────────────────────────────────────────────────────────

const NOT_CONFIGURED =
  'NOT_CONFIGURED: set VITE_PORTONE_STORE_ID and VITE_PORTONE_CHANNEL_KEY'

// Minimal, defensive subset of the resolved PortOne.requestPayment response we
// actually read. The SDK ships full types (PaymentResponse), and PaymentResponse
// is structurally assignable to this — we keep the local subset so the adapter's
// logic stays decoupled from the SDK's branded field types (and keeps `any` out of
// the CheckoutResult contract). In PortOne v2, a truthy `code` means the payment
// failed or was canceled; a success carries `paymentId`/`txId` and no `code`.
interface PortOnePaymentResponse {
  code?: string
  message?: string
  pgCode?: string
  pgMessage?: string
  paymentId?: string
  txId?: string
  transactionType?: string
}

// PortOne has no single SDK-level "user canceled" code — a window close/cancel is
// surfaced by the underlying PG in code/message (values vary per PG, e.g.
// PAY_PROCESS_CANCELED / FAILURE_TYPE_CANCEL / "사용자가 취소하였습니다"). So we
// treat any response whose code/message mentions CANCEL / 취소 as a user cancel
// (not an error), and everything else as a real failure.
function isUserCancel(r: PortOnePaymentResponse): boolean {
  const haystack = [r.code, r.message, r.pgCode, r.pgMessage]
    .filter(Boolean)
    .join(' ')
    .toUpperCase()
  return haystack.includes('CANCEL') || haystack.includes('취소')
}

export class PortOneProvider implements PaymentProvider {
  readonly id = 'portone'
  readonly redirects = false // in-page SDK modal (requestPayment); no external tab

  async checkout(intent: PaymentIntent, _target?: Window | null): Promise<CheckoutResult> {
    const storeId = String(import.meta.env.VITE_PORTONE_STORE_ID ?? '')
    const channelKey = String(import.meta.env.VITE_PORTONE_CHANNEL_KEY ?? '')
    if (!storeId || !channelKey) {
      // Keys missing → fail loud. The billing store catches this and shows a
      // checkout error rather than silently pretending the payment happened.
      throw new Error(NOT_CONFIGURED)
    }

    // Dynamically imported so the SDK only lands in the bundle when PortOne is the
    // configured provider (and so this file typechecks/loads even while off).
    const { default: PortOne } = await import('@portone/browser-sdk/v2')

    // TODO(subscriptions): for THIS draft we charge the FIRST period with the same
    // one-time requestPayment call. Real recurring billing needs
    // PortOne.requestIssueBillingKey (store a billing key) + a SERVER-side
    // scheduled charge each period via the PortOne REST API — not a client concern.
    const response = (await PortOne.requestPayment({
      storeId,
      channelKey,
      paymentId: intent.merchantUid, // server-issued merchant_uid == PortOne paymentId
      orderName: intent.title,
      totalAmount: intent.amountKrw, // server-snapshotted whole-WON price; never client-chosen
      currency: 'KRW',
      payMethod: 'CARD',
    })) as PortOnePaymentResponse | undefined

    // Success: PortOne v2 returns NO `code` on success (carries paymentId/txId). The
    // server webhook → confirm_payment is authoritative for the grant; we just
    // report the PG payment id (falling back to our merchant_uid).
    if (!response || response.code == null) {
      return {
        ok: true,
        providerPaymentId: response?.paymentId ?? intent.merchantUid,
      }
    }

    // A `code` is present → failure. Distinguish a user cancel from a real error.
    if (isUserCancel(response)) {
      return { ok: false, canceled: true }
    }
    return { ok: false }
  }
}
