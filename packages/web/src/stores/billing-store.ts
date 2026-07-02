import { create } from 'zustand'
import { supabase } from '../lib/supabase'

// ── Payment gate ────────────────────────────────────────────────────────────
// Real payment stays INACTIVE until a provider is configured. `startCheckout`
// only reaches the (stubbed) provider call site when this is true; otherwise it
// flips a `comingSoon` flag and the UI shows a "준비 중" state. Vite exposes env
// vars as strings, so compare against 'true'. Defaults false (unset → false).
export const PAYMENTS_ENABLED =
  String(import.meta.env.VITE_PAYMENTS_ENABLED ?? '') === 'true'

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
  loading: boolean
  error: 'load_failed' | 'checkout_failed' | null
  // Set true when a checkout is attempted while payments are gated OFF, so the UI
  // can render a coming-soon banner near the button that was pressed.
  comingSoon: boolean
  checkoutProductId: string | null
  paymentsEnabled: boolean

  fetchProducts: () => Promise<void>
  fetchSubscription: () => Promise<void>
  startCheckout: (productId: string) => Promise<void>
  clearComingSoon: () => void
}

export const useBillingStore = create<BillingState>((set, get) => ({
  products: [],
  subscription: null,
  loading: false,
  error: null,
  comingSoon: false,
  checkoutProductId: null,
  paymentsEnabled: PAYMENTS_ENABLED,

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

  startCheckout: async (productId: string) => {
    // GATE: no provider is wired yet. Never call a provider while off.
    if (!PAYMENTS_ENABLED) {
      set({ comingSoon: true, checkoutProductId: productId, error: null })
      return
    }

    const product = get().products.find((p) => p.id === productId) ?? null
    set({ comingSoon: false, checkoutProductId: productId, error: null })

    // ─────────────────────────────────────────────────────────────────────────
    // STUBBED PROVIDER CHECKOUT — PortOne (아임포트).
    //
    // TODO(payment): when a provider is configured, integrate PortOne here:
    //   1. Dynamically load the PortOne browser SDK — do NOT add the dependency
    //      to package.json until the provider is live + tested.
    //   2. Request a payment for `product` (id=`product.id`, amount=priceKrw).
    //   3. On success the PortOne server webhook hits
    //        POST /functions/v1/payment-webhook
    //      which calls add_ai_credits (credit_pack) or grant_subscription
    //      (subscription) — mig 119, idempotent on payment_id / (provider,ref).
    //   4. After the callback resolves, re-run fetchProducts()/fetchSubscription()
    //      and refresh the wallet + card-usage meters.
    //
    // Until then there is deliberately no client-side provider. This branch is
    // unreachable in prod (VITE_PAYMENTS_ENABLED defaults false).
    // ─────────────────────────────────────────────────────────────────────────
    void product
    set({ error: 'checkout_failed' })
  },

  clearComingSoon: () => set({ comingSoon: false, checkoutProductId: null }),
}))
