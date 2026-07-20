// ── Buyer-facing price currency ────────────────────────────────────────────
// The store charges by REGION: Korean buyers pay ₩ via TossPayments; everyone
// else pays $ via LemonSqueezy (a USD-settling Merchant-of-Record store). So the
// DISPLAYED currency must follow the buyer's locale, not a single hardcoded one —
// showing ₩ to an English user (or $ to a Korean user) misrepresents the charge.
//
// The signal is the UI locale (i18next language): 'ko*' → KRW, everything else →
// USD. Keep display currency and the resolved payment provider in lockstep (see
// preferredProviderId in the web payments lib) so what's shown equals what's charged.

export interface PricedProduct {
  /** KRW major unit (whole won), e.g. 4900. */
  priceKrw: number
  /** USD price in cents, or null if a plan row has no USD price configured. */
  priceUsdCents: number | null
}

/** True when the UI locale is Korean → show/charge ₩ (TossPayments). */
export function isKoreanLocale(locale?: string | null): boolean {
  return !!locale && locale.toLowerCase().startsWith('ko')
}

/**
 * Format a catalog product's price in the buyer's display currency:
 *   Korean locale → `₩4,900`   (priceKrw)
 *   otherwise     → `$3.99`     (priceUsdCents)
 * Falls back to ₩ only if a non-Korean buyer hits a plan with no USD price set
 * (shouldn't happen for active catalog rows) so the amount is never blank/$0.
 *
 * @param intlLocale a BCP-47 tag for digit grouping (e.g. 'ko-KR', 'en-US').
 */
export function formatProductPrice(
  p: PricedProduct,
  locale?: string | null,
  intlLocale?: string,
): string {
  if (!isKoreanLocale(locale) && p.priceUsdCents != null) {
    return `$${(p.priceUsdCents / 100).toFixed(2)}`
  }
  return `₩${p.priceKrw.toLocaleString(intlLocale || 'ko-KR')}`
}

/** The ISO currency code shown to this buyer — for labels/aria, analytics, etc. */
export function displayCurrencyCode(locale?: string | null): 'KRW' | 'USD' {
  return isKoreanLocale(locale) ? 'KRW' : 'USD'
}
