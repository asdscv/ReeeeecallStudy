import type { PaymentProvider, PaymentIntent, CheckoutResult } from './provider'

// ─────────────────────────────────────────────────────────────────────────────
// PortOne (아임포트) v2 browser SDK adapter — THE ONE PLACE LEFT TO IMPLEMENT.
//
// Everything else in the checkout flow is wired (create_payment_intent → this
// adapter → payment-webhook → confirm_payment). To go live, fill EXACTLY these:
//
//   1. Add the SDK dependency (do NOT commit it until the provider is live):
//        pnpm --filter @reeeeecall/web add @portone/browser-sdk
//      then wire the import at the marked line below:
//        import * as PortOne from '@portone/browser-sdk/v2'
//
//   2. Provide the PortOne credentials via Vite env (never hardcode secrets):
//        VITE_PORTONE_STORE_ID     — 상점 아이디  (store-xxxxxxxx from the console)
//        VITE_PORTONE_CHANNEL_KEY  — 채널 키      (channel-key-xxxx for the PG channel)
//
//   3. Flip the client on: VITE_PAYMENT_PROVIDER=portone + VITE_PAYMENTS_ENABLED=true.
//
//   4. Server half (separate from this file): point the PortOne webhook at our
//      payment-webhook edge fn, set PAYMENT_WEBHOOK_SECRET, and implement the
//      payment-webhook provider adapter (verifySignature + how it reads
//      merchant_uid / provider_payment_id off PortOne's payload).
//
// The requestPayment SHAPE below is the real PortOne v2 call; only the SDK import
// and the store id / channel key are missing. Every field maps straight from the
// server-issued PaymentIntent — the amount is the server-snapshotted price, so the
// client can never choose it.
// ─────────────────────────────────────────────────────────────────────────────

const STORE_ID = String(import.meta.env.VITE_PORTONE_STORE_ID ?? '')
const CHANNEL_KEY = String(import.meta.env.VITE_PORTONE_CHANNEL_KEY ?? '')

const NOT_CONFIGURED =
  'NOT_CONFIGURED: PortOne is not set up. Add @portone/browser-sdk, wire its ' +
  'import, and set VITE_PORTONE_STORE_ID + VITE_PORTONE_CHANNEL_KEY. See the TODO ' +
  'at the top of portone-provider.ts.'

export class PortOneProvider implements PaymentProvider {
  readonly id = 'portone'

  async checkout(intent: PaymentIntent): Promise<CheckoutResult> {
    // Keys/SDK missing → fail loud and clear. The billing store surfaces this as a
    // checkout error rather than silently pretending the payment happened.
    // (intent.merchantUid is the server-issued order id the real call would pass.)
    if (!STORE_ID || !CHANNEL_KEY || !intent.merchantUid) {
      throw new Error(NOT_CONFIGURED)
    }

    // ── REAL SHAPE (enable once @portone/browser-sdk is installed + imported) ──
    //
    // import * as PortOne from '@portone/browser-sdk/v2'  // ← STEP 1 goes at file top
    //
    // const response = await PortOne.requestPayment({
    //   storeId: STORE_ID,
    //   channelKey: CHANNEL_KEY,
    //   paymentId: intent.merchantUid,     // ← our server-issued merchant_uid == the order id
    //   orderName: intent.title,
    //   totalAmount: intent.amountKrw,     // ← server-snapshotted price (whole WON); never client-chosen
    //   currency: 'CURRENCY_KRW',
    //   payMethod: 'CARD',
    //   // subscription tiers → issue a billing key for recurring charges:
    //   // ...(intent.kind === 'subscription' ? { issueBillingKeyAndPay: { … } } : {}),
    // })
    //
    // // A non-null `code` means the user canceled or the PG rejected the payment.
    // if (response?.code != null) {
    //   const canceled = response.code === 'FAILURE_TYPE_CANCEL'
    //   return { ok: false, canceled }
    // }
    //
    // // Success. The PortOne SERVER webhook → payment-webhook → confirm_payment is
    // // what actually GRANTS; the client just reports the PG's payment id.
    // return { ok: true, providerPaymentId: response?.paymentId ?? intent.merchantUid }

    // Until the SDK import above is wired, this line is where control lands.
    throw new Error(NOT_CONFIGURED)
  }
}
