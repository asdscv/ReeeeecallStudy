import type { PaymentProvider } from './provider'
import { MockProvider } from './mock-provider'
import { PortOneProvider } from './portone-provider'
import { LemonsqueezyProvider } from './lemonsqueezy-provider'

export type {
  PaymentProvider,
  PaymentIntent,
  CheckoutResult,
  RawPaymentIntent,
} from './provider'
export { mapPaymentIntent } from './provider'

export type PaymentProviderId = 'mock' | 'portone' | 'lemonsqueezy' | 'none'

/** Configured provider id from Vite env; defaults to 'none' (payments have no adapter). */
export function paymentProviderId(): PaymentProviderId {
  const raw = String(import.meta.env.VITE_PAYMENT_PROVIDER ?? 'none')
  if (raw === 'mock' || raw === 'portone' || raw === 'lemonsqueezy') return raw
  return 'none'
}

/**
 * Returns the configured provider adapter, or null when there is no provider
 * ('none' / unset). The billing store treats null as "coming soon" and never
 * calls a provider while off.
 */
export function resolveProvider(): PaymentProvider | null {
  switch (paymentProviderId()) {
    case 'mock':
      return new MockProvider()
    case 'portone':
      return new PortOneProvider()
    case 'lemonsqueezy':
      return new LemonsqueezyProvider()
    default:
      return null
  }
}
