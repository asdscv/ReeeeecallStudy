import { create } from 'zustand'
import { supabase } from '../lib/supabase'
import { writeCheckoutLoadingTab } from '../lib/payments/checkout-tab'
import { useDeckStore } from './deck-store'
import { getAiWalletSummary, type AiWalletSummary } from '@reeeeecall/shared/lib/ai/server-client'
import {
  resolveProvider,
  resolveProviders,
  mapPaymentIntent,
  type CheckoutResult,
  type RawPaymentIntent,
  type PaymentProviderId,
} from '../lib/payments'

// ── Payment gate ────────────────────────────────────────────────────────────
// Real payment stays INACTIVE until a provider is configured. `startCheckout`
// only reaches a provider when this is true; otherwise it flips a `comingSoon`
// flag and the UI shows a "준비 중" state. Vite exposes env vars as strings, so
// compare against 'true'. Defaults false (unset → false).
export const PAYMENTS_ENABLED =
  String(import.meta.env.VITE_PAYMENTS_ENABLED ?? '') === 'true'

// The checkout is only truly live when the gate is ON *and* at least one provider
// adapter is configured (VITE_PAYMENT_PROVIDERS='toss,lemonsqueezy', each with its keys).
// With no provider the UI shows the coming-soon state. Components gate on this, not on
// PAYMENTS_ENABLED alone.
export const PAYMENTS_ACTIVE = PAYMENTS_ENABLED && resolveProviders().size > 0

export type CheckoutStatus = 'idle' | 'processing' | 'success' | 'canceled'

export type BillingProductKind = 'credit_pack' | 'subscription'

export interface BillingProduct {
  id: string
  kind: BillingProductKind
  title: string
  priceKrw: number
  priceUsdCents: number | null // USD minor unit (display currency)
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
  providerSubscriptionId: string | null
  currentPeriodEnd: string | null
  cancelAtPeriodEnd: boolean
  createdAt: string
  updatedAt: string
}

// Shapes returned by the mig-119 SECURITY DEFINER RPCs (snake_case JSON).
interface RawBillingProduct {
  id: string
  kind: BillingProductKind
  title: string
  price_krw: number
  price_usd_cents: number | null
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
  provider_subscription_id: string | null
  current_period_end: string | null
  cancel_at_period_end: boolean | null
  created_at: string
  updated_at: string
}

function mapProduct(r: RawBillingProduct): BillingProduct {
  return {
    id: r.id,
    kind: r.kind,
    title: r.title,
    priceKrw: Number(r.price_krw ?? 0),
    priceUsdCents: r.price_usd_cents == null ? null : Number(r.price_usd_cents),
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
    providerSubscriptionId: r.provider_subscription_id ?? null,
    currentPeriodEnd: r.current_period_end,
    cancelAtPeriodEnd: !!r.cancel_at_period_end,
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
  // The provider id the in-flight checkout was started with, so the spinner/status can
  // scope to the exact button pressed when a product is buyable via multiple providers.
  checkoutProviderId: PaymentProviderId | null
  // Reflects an in-flight / resolved provider checkout for the UI (spinner,
  // success/canceled note). Scoped to `checkoutProductId`.
  checkoutStatus: CheckoutStatus
  paymentsEnabled: boolean
  paymentsActive: boolean

  fetchProducts: () => Promise<void>
  fetchSubscription: () => Promise<void>
  fetchWallet: () => Promise<void>
  startCheckout: (productId: string, providerId?: PaymentProviderId) => Promise<void>
  // Consumes a redirect-provider return (?pay=success|cancel&mu=…) on the
  // /settings landing: on success refreshes every entitlement surface and flips
  // checkoutStatus to 'success'; on cancel flips to 'canceled'. Strips the params
  // from the URL so a reload doesn't re-trigger. No-op (returns null) when there's
  // no `pay` param. Returns the outcome so the caller can surface a toast.
  handlePaymentReturn: () => Promise<'success' | 'canceled' | null>
  clearComingSoon: () => void
}

// Poll the server payment_intent (RLS: user reads own) after a NEW-TAB redirect
// checkout, until the signed webhook flips it to 'paid' — then run onPaid() and mark
// success. The checkout runs in a SEPARATE tab, so handlePaymentReturn (which fires in
// that tab) can't update this one; this poll is how the app tab reconciles. Bounded so
// an abandoned checkout never spins forever.
async function pollCheckoutIntent(
  merchantUid: string,
  checkoutTab: Window,
  onPaid: () => Promise<void>,
  set: (partial: Partial<BillingState>) => void,
): Promise<void> {
  const started = Date.now()
  const TIMEOUT_MS = 5 * 60 * 1000
  const POLL_MS = 2500
  const readStatus = async (): Promise<string | null> => {
    const { data } = await supabase
      .from('payment_intents')
      .select('status')
      .eq('merchant_uid', merchantUid)
      .maybeSingle()
    return (data as { status?: string } | null)?.status ?? null
  }
  while (Date.now() - started < TIMEOUT_MS) {
    await new Promise((r) => setTimeout(r, POLL_MS))
    const status = await readStatus()
    if (status === 'paid') {
      await onPaid()
      set({ checkoutStatus: 'success', error: null })
      return
    }
    if (status === 'failed' || status === 'canceled') {
      set({ checkoutStatus: 'canceled', error: null })
      return
    }
    // Checkout tab closed without a terminal status: give the webhook a brief grace,
    // re-check once, then stop (a later /settings revisit still reconciles via
    // handlePaymentReturn / a manual refresh).
    if (checkoutTab.closed) {
      await new Promise((r) => setTimeout(r, 3000))
      if ((await readStatus()) === 'paid') {
        await onPaid()
        set({ checkoutStatus: 'success', error: null })
      } else {
        set({ checkoutStatus: 'idle', error: null })
      }
      return
    }
  }
  // Left open a long time → drop the spinner to a neutral state.
  set({ checkoutStatus: 'idle', error: null })
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
  checkoutProviderId: null,
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

  startCheckout: async (productId: string, providerId?: PaymentProviderId) => {
    // Resolve the user's chosen provider (or the default/first enabled when omitted).
    const provider = resolveProvider(providerId)

    // GATE: payments off or the chosen provider isn't configured → coming soon. Never
    // call a provider while off. (Equivalent to !PAYMENTS_ACTIVE for that provider.)
    if (!PAYMENTS_ENABLED || provider === null) {
      set({
        comingSoon: true,
        checkoutProductId: productId,
        checkoutProviderId: providerId ?? null,
        checkoutStatus: 'idle',
        error: null,
      })
      return
    }

    set({
      comingSoon: false,
      checkoutProductId: productId,
      checkoutProviderId: (provider.id as PaymentProviderId) ?? providerId ?? null,
      checkoutStatus: 'processing',
      error: null,
    })

    // Pre-open a blank tab INSIDE the click gesture for redirect providers so the
    // hosted checkout opens in a NEW tab and the app tab stays put. Popup blockers
    // only allow window.open synchronously in a user gesture — the create_payment_intent
    // await below would disqualify a later open. null when blocked → the provider falls
    // back to same-tab navigation (unchanged old behavior).
    const checkoutTab =
      provider.redirects && typeof window !== 'undefined'
        ? window.open('about:blank', '_blank')
        : null
    // Paint a spinner into the blank tab so the user doesn't see about:blank while the
    // hosted checkout is created server-side (~1s). Replaced by the checkout on redirect.
    writeCheckoutLoadingTab(checkoutTab)

    // 1) Server snapshots price + kind into a 'pending' intent and returns a fresh
    //    merchant_uid. The client can neither pick the price nor self-grant.
    const { data, error } = await supabase.rpc('create_payment_intent', {
      p_product_id: productId,
    })
    if (error || !data) {
      checkoutTab?.close()
      set({ checkoutStatus: 'idle', error: 'checkout_failed' })
      return
    }
    const intent = mapPaymentIntent(data as RawPaymentIntent)

    // 2) Open the provider checkout with THAT merchant_uid + amount. The provider's
    //    server webhook (→ payment-webhook → confirm_payment) is what actually
    //    grants; this only tells us how the client-side flow resolved.
    let result: CheckoutResult
    try {
      result = await provider.checkout(intent, checkoutTab)
    } catch {
      // e.g. PortOne NOT_CONFIGURED, Stripe create-stripe-checkout 503, or a
      // SDK/network failure.
      checkoutTab?.close()
      set({ checkoutStatus: 'idle', error: 'checkout_failed' })
      return
    }

    // Redirect flow (LemonSqueezy hosted checkout).
    if (result.redirecting) {
      // Same-tab fallback (popup blocked → we navigated away): nothing to do; the
      // ?pay=success redirect + handlePaymentReturn resolves it after the round trip.
      if (!checkoutTab || checkoutTab.closed) return
      // New-tab flow: the app tab stays here, so handlePaymentReturn (which runs in the
      // checkout tab) won't fire in this tab. Poll the server intent until the signed
      // webhook marks it paid, then refresh every entitlement surface — so the balance /
      // plan updates without the user reloading. Stops early if the checkout tab is
      // closed (with a short grace for a just-in-time webhook) or on failed/canceled.
      await pollCheckoutIntent(intent.merchantUid, checkoutTab, async () => {
        await Promise.all([
          get().fetchWallet(),
          get().fetchSubscription(),
          useDeckStore.getState().fetchCardUsage({ force: true }),
        ])
      }, set)
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

  handlePaymentReturn: async () => {
    if (typeof window === 'undefined') return null
    const params = new URLSearchParams(window.location.search)
    const pay = params.get('pay')
    if (pay !== 'success' && pay !== 'cancel') return null

    // Strip pay/mu FIRST (synchronously, before any await) so a reload — or a
    // React StrictMode double-invoke — doesn't re-trigger the grant refresh. mu is
    // informational only; confirm_payment (server) is authoritative for the grant.
    params.delete('pay')
    params.delete('mu')
    const qs = params.toString()
    window.history.replaceState(
      window.history.state,
      '',
      window.location.pathname + (qs ? `?${qs}` : '') + window.location.hash,
    )

    if (pay === 'cancel') {
      set({ checkoutStatus: 'canceled', error: null })
      return 'canceled'
    }

    // Success — the server webhook (stripe-webhook → confirm_payment) is the
    // authority on the grant; here we just re-pull every entitlement surface it
    // could have moved: wallet balance (credit_pack), subscription (subscription),
    // and the owned-card usage meter (a subscription raises the card limit).
    await Promise.all([
      get().fetchWallet(),
      get().fetchSubscription(),
      useDeckStore.getState().fetchCardUsage({ force: true }),
    ])
    set({ checkoutStatus: 'success', error: null })
    return 'success'
  },

  clearComingSoon: () =>
    set({ comingSoon: false, checkoutProductId: null, checkoutProviderId: null, checkoutStatus: 'idle' }),
}))
