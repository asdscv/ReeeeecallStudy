// Payment provider seam (web checkout).
//
// The backend (mig 120) is the sole authority on price + grants:
//   create_payment_intent(product_id) → server snapshots price/kind into a
//   'pending' payment_intents row → returns a merchant_uid → the provider
//   checkout is opened with THAT merchant_uid + amount → the provider's server
//   POSTs the signed payment-webhook → confirm_payment(merchant_uid, …) locks the
//   intent, marks it paid idempotently, and grants credits (add_ai_credits) or a
//   subscription (grant_subscription) from the SERVER-snapshotted amount.
//
// A provider adapter therefore only has to (a) open the provider's checkout UI for
// the server-issued merchant_uid + amount, and (b) report how the client-side flow
// resolved. It NEVER grants anything itself — the client can never pick its own
// price or self-grant. This is the whole seam; the ONLY missing go-live piece is a
// concrete adapter (see portone-provider.ts).

// Shape of create_payment_intent's json return (mig 120), camelCased.
export interface PaymentIntent {
  merchantUid: string
  productId: string
  kind: 'credit_pack' | 'subscription'
  amountKrw: number
  /** credit_pack only; null for subscription */
  amountMicroWon: number | null
  title: string
}

export interface CheckoutResult {
  /** true = the provider reported a completed/authorized payment. */
  ok: boolean
  /** the provider's own payment id, when known (server webhook is authoritative). */
  providerPaymentId?: string
  /** true = the user dismissed/canceled the checkout (not an error). */
  canceled?: boolean
}

export interface PaymentProvider {
  readonly id: string
  checkout(intent: PaymentIntent): Promise<CheckoutResult>
}

// Raw json exactly as create_payment_intent returns it (snake_case).
export interface RawPaymentIntent {
  merchant_uid: string
  product_id: string
  kind: string
  amount_krw: number
  amount_micro_won: number | null
  title: string
}

export function mapPaymentIntent(r: RawPaymentIntent): PaymentIntent {
  return {
    merchantUid: r.merchant_uid,
    productId: r.product_id,
    kind: r.kind === 'subscription' ? 'subscription' : 'credit_pack',
    amountKrw: Number(r.amount_krw ?? 0),
    amountMicroWon: r.amount_micro_won == null ? null : Number(r.amount_micro_won),
    title: r.title,
  }
}
