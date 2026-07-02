import { create } from 'zustand'
import { supabase } from '../lib/supabase'
import { useDeckStore } from './deck-store'
import { getAiWalletSummary, type AiWalletSummary } from '@reeeeecall/shared/lib/ai/server-client'
import {
  resolveProvider,
  mapPaymentIntent,
  type CheckoutResult,
  type RawPaymentIntent,
} from '../lib/payments'

// ── Payment gate ────────────────────────────────────────────────────────────
// Real payment stays INACTIVE until a provider is configured. `startCheckout`
// only reaches a provider when this is true; otherwise it flips a `comingSoon`
// flag and the UI shows a "준비 중" state. Vite exposes env vars as strings, so
// compare against 'true'. Defaults false (unset → false).
export const PAYMENTS_ENABLED =
  String(import.meta.env.VITE_PAYMENTS_ENABLED ?? '') === 'true'

// The checkout is only truly live when the gate is ON *and* a provider adapter is
// wired (VITE_PAYMENT_PROVIDER=mock|portone). With no provider the UI shows the
// coming-soon state. Components should gate on this, not on PAYMENTS_ENABLED alone.
export const PAYMENTS_ACTIVE = PAYMENTS_ENABLED && resolveProvider() !== null

export type CheckoutStatus = 'idle' | 'processing' | 'success' | 'canceled'

export type BillingProductKind = 'credit_pack' | 'subscription'

export interface BillingProduct {
  id: string
  kind: BillingProductKind
  title: string
  priceKrw: number
  creditsMicroWon: number | null // credit_pack only
  tier: string | null // subscription only
  cardLimit: number | null // subscription only
  period: string | null
  sortOrder: number
  isActive: boolean
}

export interface MySubscription {
  id: string
  productId: string | null
  tier: string
  status: string
  cardLimit: number | null
  provider: string | null
  providerRef: string | null
  currentPeriodEnd: string | null
  createdAt: string
  updatedAt: string
}

// Shapes returned by the mig-119 SECURITY DEFINER RPCs (snake_case JSON).
interface RawBillingProduct {
  id: string
  kind: BillingProductKind
  title: string
  price_krw: number
  credits_micro_won: number | null
  tier: string | null
  card_limit: number | null
  period: string | null
  sort_order: number
  is_active: boolean
}
interface RawSubscription {
  id: string
  product_id: string | null
  tier: string
  status: string
  card_limit: number | null
  provider: string | null
  provider_ref: string | null
  current_period_end: string | null
  created_at: string
  updated_at: string
}

function mapProduct(r: RawBillingProduct): BillingProduct {
  return {
    id: r.id,
    kind: r.kind,
    title: r.title,
    priceKrw: Number(r.price_krw ?? 0),
    creditsMicroWon: r.credits_micro_won == null ? null : Number(r.credits_micro_won),
    tier: r.tier,
    cardLimit: r.card_limit == null ? null : Number(r.card_limit),
    period: r.period,
    sortOrder: Number(r.sort_order ?? 0),
    isActive: !!r.is_active,
  }
}

function mapSubscription(r: RawSubscription): MySubscription {
  return {
    id: r.id,
    productId: r.product_id,
    tier: r.tier,
    status: r.status,
    cardLimit: r.card_limit == null ? null : Number(r.card_limit),
    provider: r.provider,
    providerRef: r.provider_ref,
    currentPeriodEnd: r.current_period_end,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }
}

interface BillingState {
  products: BillingProduct[]
  subscription: MySubscription | null
  // AI wallet snapshot (get_ai_wallet_summary). Refreshed after a successful
  // checkout so the top-up sheet reflects the new balance without a reload.
  wallet: AiWalletSummary | null
  walletState: 'idle' | 'loading' | 'ready' | 'error'
  loading: boolean
  error: 'load_failed' | 'checkout_failed' | null
  // Set true when a checkout is attempted while payments have no provider, so the
  // UI can render a coming-soon banner near the button that was pressed.
  comingSoon: boolean
  checkoutProductId: string | null
  // Reflects an in-flight / resolved provider checkout for the UI (spinner,
  // success/canceled note). Scoped to `checkoutProductId`.
  checkoutStatus: CheckoutStatus
  paymentsEnabled: boolean
  paymentsActive: boolean

  fetchProducts: () => Promise<void>
  fetchSubscription: () => Promise<void>
  fetchWallet: () => Promise<void>
  startCheckout: (productId: string) => Promise<void>
  clearComingSoon: () => void
}

export const useBillingStore = create<BillingState>((set, get) => ({
  products: [],
  subscription: null,
  wallet: null,
  walletState: 'idle',
  loading: false,
  error: null,
  comingSoon: false,
  checkoutProductId: null,
  checkoutStatus: 'idle',
  paymentsEnabled: PAYMENTS_ENABLED,
  paymentsActive: PAYMENTS_ACTIVE,

  fetchProducts: async () => {
    set({ loading: true, error: null })
    const { data, error } = await supabase.rpc('get_billing_products')
    if (error) {
      set({ loading: false, error: 'load_failed' })
      return
    }
    const raw = (data ?? []) as RawBillingProduct[]
    set({ products: raw.map(mapProduct), loading: false })
  },

  fetchSubscription: async () => {
    const { data, error } = await supabase.rpc('get_my_subscription')
    // Fails open to null (server is authoritative; a read blip shouldn't imply
    // "no subscription" in a way that mutates anything — it's display-only here).
    if (error || !data) {
      set({ subscription: null })
      return
    }
    set({ subscription: mapSubscription(data as RawSubscription) })
  },

  fetchWallet: async () => {
    set({ walletState: 'loading' })
    const summary = await getAiWalletSummary()
    if (!summary) {
      set({ walletState: 'error' })
      return
    }
    set({ wallet: summary, walletState: 'ready' })
  },

  startCheckout: async (productId: string) => {
    const provider = resolveProvider()

    // GATE: payments off or no provider adapter wired → coming soon. Never call a
    // provider while off. (Equivalent to !PAYMENTS_ACTIVE.)
    if (!PAYMENTS_ENABLED || provider === null) {
      set({
        comingSoon: true,
        checkoutProductId: productId,
        checkoutStatus: 'idle',
        error: null,
      })
      return
    }

    set({
      comingSoon: false,
      checkoutProductId: productId,
      checkoutStatus: 'processing',
      error: null,
    })

    // 1) Server snapshots price + kind into a 'pending' intent and returns a fresh
    //    merchant_uid. The client can neither pick the price nor self-grant.
    const { data, error } = await supabase.rpc('create_payment_intent', {
      p_product_id: productId,
    })
    if (error || !data) {
      set({ checkoutStatus: 'idle', error: 'checkout_failed' })
      return
    }
    const intent = mapPaymentIntent(data as RawPaymentIntent)

    // 2) Open the provider checkout with THAT merchant_uid + amount. The provider's
    //    server webhook (→ payment-webhook → confirm_payment) is what actually
    //    grants; this only tells us how the client-side flow resolved.
    let result: CheckoutResult
    try {
      result = await provider.checkout(intent)
    } catch {
      // e.g. PortOne NOT_CONFIGURED, or SDK/network failure.
      set({ checkoutStatus: 'idle', error: 'checkout_failed' })
      return
    }

    if (result.canceled) {
      set({ checkoutStatus: 'canceled', error: null })
      return
    }
    if (!result.ok) {
      set({ checkoutStatus: 'idle', error: 'checkout_failed' })
      return
    }

    // 3) Success — refresh every entitlement surface the grant could have moved:
    //    wallet balance (credit_pack), subscription (subscription), and the
    //    owned-card usage meter (a subscription raises the card limit). The mock
    //    admin path grants synchronously; a real webhook is usually near-instant.
    await Promise.all([
      get().fetchWallet(),
      get().fetchSubscription(),
      useDeckStore.getState().fetchCardUsage({ force: true }),
    ])
    set({ checkoutStatus: 'success', error: null })
  },

  clearComingSoon: () =>
    set({ comingSoon: false, checkoutProductId: null, checkoutStatus: 'idle' }),
}))
