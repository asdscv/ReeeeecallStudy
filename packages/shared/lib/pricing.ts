// ── Buyer-facing price currency ────────────────────────────────────────────
// The store charges USD everywhere (LemonSqueezy, a USD-settling Merchant of Record;
// Toss/₩ was dropped). So every price — and the AI-credit wallet — is displayed in $.

export interface PricedProduct {
  /** KRW major unit (whole won). Legacy; only a last-resort fallback for display. */
  priceKrw: number
  /** USD price in cents (the charged currency). */
  priceUsdCents: number | null
}

/**
 * Format a catalog product's price as USD (`$3.99`). Falls back to ₩ only if a row
 * somehow has no USD price set (shouldn't happen for active catalog rows) so the
 * amount is never blank/$0.
 */
export function formatProductPrice(p: PricedProduct): string {
  if (p.priceUsdCents != null) return `$${(p.priceUsdCents / 100).toFixed(2)}`
  return `₩${p.priceKrw.toLocaleString('ko-KR')}`
}
