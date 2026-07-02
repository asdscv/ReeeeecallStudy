import type { PaymentProvider } from './provider'
import { MockProvider } from './mock-provider'
import { PortOneProvider } from './portone-provider'

export type {
  PaymentProvider,
  PaymentIntent,
  CheckoutResult,
  RawPaymentIntent,
} from './provider'
export { mapPaymentIntent } from './provider'

export type PaymentProviderId = 'mock' | 'portone' | 'none'

/** Configured provider id from Vite env; defaults to 'none' (payments have no adapter). */
export function paymentProviderId(): PaymentProviderId {
  const raw = String(import.meta.env.VITE_PAYMENT_PROVIDER ?? 'none')
  if (raw === 'mock' || raw === 'portone') return raw
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
    default:
      return null
  }
}
