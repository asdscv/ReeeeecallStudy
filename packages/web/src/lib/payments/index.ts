import type { PaymentProvider } from './provider'
import { MockProvider } from './mock-provider'
import { PortOneProvider } from './portone-provider'
import { LemonsqueezyProvider } from './lemonsqueezy-provider'
import { TossProvider } from './toss-provider'
import { isKoreanLocale } from '@reeeeecall/shared/lib/pricing'

export type {
  PaymentProvider,
  PaymentIntent,
  CheckoutResult,
  RawPaymentIntent,
} from './provider'
export { mapPaymentIntent } from './provider'

export type PaymentProviderId = 'mock' | 'portone' | 'lemonsqueezy' | 'toss' | 'none'

const VALID_IDS: PaymentProviderId[] = ['mock', 'portone', 'lemonsqueezy', 'toss']

/** Single-adapter factory (one place to register a new provider). */
function makeProvider(id: PaymentProviderId): PaymentProvider | null {
  switch (id) {
    case 'mock':
      return new MockProvider()
    case 'portone':
      return new PortOneProvider()
    case 'lemonsqueezy':
      return new LemonsqueezyProvider()
    case 'toss':
      return new TossProvider()
    default:
      return null
  }
}

/**
 * Which providers the operator ENABLED for this build. `VITE_PAYMENT_PROVIDERS` is a
 * comma list (e.g. 'toss,lemonsqueezy') for offering a CHOICE; the legacy single
 * `VITE_PAYMENT_PROVIDER` is honored as a one-element fallback. Order is preserved (the
 * first is the default/primary). Invalid ids are dropped.
 */
export function enabledProviderIds(): PaymentProviderId[] {
  const multi = String(import.meta.env.VITE_PAYMENT_PROVIDERS ?? '')
    .split(',').map((s) => s.trim()).filter(Boolean)
  const single = String(import.meta.env.VITE_PAYMENT_PROVIDER ?? '').trim()
  const ids = multi.length ? multi : single ? [single] : []
  return ids.filter((id): id is PaymentProviderId => VALID_IDS.includes(id as PaymentProviderId))
}

/**
 * Enabled AND configured adapters (isAvailable() true), keyed by id, order preserved.
 * An enabled-but-unconfigured provider (missing keys) is dropped so it never appears in
 * the picker or resolves for checkout.
 */
export function resolveProviders(): Map<PaymentProviderId, PaymentProvider> {
  const map = new Map<PaymentProviderId, PaymentProvider>()
  for (const id of enabledProviderIds()) {
    const p = makeProvider(id)
    if (p && p.isAvailable()) map.set(id, p)
  }
  return map
}

/** Configured adapters that can sell the given product kind (drives the picker). */
export function providersForKind(kind: 'credit_pack' | 'subscription'): PaymentProvider[] {
  return [...resolveProviders().values()].filter((p) => p.supports(kind))
}

/**
 * Resolve a single provider: by id (from the user's method choice), or — when no id is
 * given — the first configured one. Returns null when none is configured / the id isn't
 * enabled (the billing store treats null as "coming soon" and never charges).
 */
export function resolveProvider(id?: PaymentProviderId | null): PaymentProvider | null {
  const map = resolveProviders()
  if (id) return map.get(id) ?? null
  const first = map.values().next()
  return first.done ? null : first.value
}

/** Back-compat single-value reader (first enabled id, or 'none'). */
export function paymentProviderId(): PaymentProviderId {
  return enabledProviderIds()[0] ?? 'none'
}

/**
 * The provider to charge THIS buyer, chosen by locale so the charged currency
 * matches the displayed one: Korean buyers → TossPayments (₩), everyone else →
 * LemonSqueezy ($). Falls back to the first configured provider that supports the
 * kind when the region-preferred one isn't enabled, and null when none is. This
 * replaces the manual payment-method picker: region determines the method.
 */
export function preferredProviderId(
  locale: string | undefined | null,
  kind: 'credit_pack' | 'subscription',
): PaymentProviderId | null {
  const available = providersForKind(kind).map((p) => p.id as PaymentProviderId)
  if (available.length === 0) return null
  const want: PaymentProviderId = isKoreanLocale(locale) ? 'toss' : 'lemonsqueezy'
  return available.includes(want) ? want : available[0]
}
