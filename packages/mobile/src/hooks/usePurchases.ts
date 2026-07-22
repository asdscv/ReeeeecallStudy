// ─────────────────────────────────────────────────────────────────────────
// [SUBSCRIPTION-HIDDEN] 2026-04-15 — Apple 심사 리젝 대응
// 이 훅은 현재 어떤 화면에서도 호출되지 않음 (PaywallScreen, SettingsScreen에서 제거).
// 코드는 유지하되 호출 진입점만 차단된 상태.
// 구독 기능 복원 시: SettingsScreen에서 usePurchases import + isPro 사용 복구.
// ─────────────────────────────────────────────────────────────────────────
import { useState, useEffect, useCallback } from 'react'
import type { PurchasesPackage, PurchasesOffering } from 'react-native-purchases'
import { purchaseService, PRO_ENTITLEMENT, SUBSCRIPTION_UI_ENABLED } from '../services/purchases'
import { getBillingProducts, getMySubscription, createPaymentIntent, type BillingProduct, type MySubscription } from '../services/billing'
import { useAuthState } from './useAuthState'

/**
 * Hook for in-app purchases.
 * Wraps PurchaseService with React state management.
 *
 * The product catalog + entitlement come from OUR backend (get_billing_products
 * / get_my_subscription) — the server is the source of truth for what exists.
 * The store IAP layer (offering) is only used to actually charge. Everything
 * here is gated behind SUBSCRIPTION_UI_ENABLED (currently false), so while the
 * subscription UI is hidden we make no network calls and expose empty state.
 */
export function usePurchases() {
  const { user } = useAuthState()
  const [isPro, setIsPro] = useState(false)
  const [offering, setOffering] = useState<PurchasesOffering | null>(null)
  const [products, setProducts] = useState<BillingProduct[]>([])
  const [subscription, setSubscription] = useState<MySubscription | null>(null)
  const [loading, setLoading] = useState(true)
  const [purchasing, setPurchasing] = useState(false)

  // Re-read the caller's active subscription from the backend. Call this after
  // a purchase settles — the actual grant happens server-side via the
  // payment-webhook, so the client just polls the authoritative row.
  const refreshSubscription = useCallback(async () => {
    if (!SUBSCRIPTION_UI_ENABLED) return
    const sub = await getMySubscription()
    setSubscription(sub)
  }, [])

  // Initialize and check status
  useEffect(() => {
    let cancelled = false
    async function init() {
      // [SUBSCRIPTION-HIDDEN] short-circuit while the flow is gated off.
      if (!SUBSCRIPTION_UI_ENABLED) {
        if (!cancelled) setLoading(false)
        return
      }
      try {
        await purchaseService.init(user?.id)
        if (user?.id) {
          // Alias the RevenueCat subscriber to OUR supabase user id (appUserID).
          // This is what lets the server-side revenuecat-webhook map its incoming
          // `app_user_id` back to our user and grant the subscription. The client
          // NEVER grants here — the grant is server-side only (mig 121). Gated
          // behind SUBSCRIPTION_UI_ENABLED (this whole init short-circuits above).
          await purchaseService.login(user.id)
        }
        // Server catalog + subscription are the source of truth.
        const [cat, sub, pro, off] = await Promise.all([
          getBillingProducts(),
          getMySubscription(),
          purchaseService.isPro(),
          purchaseService.getOfferings(),
        ])
        if (cancelled) return
        setProducts(cat)
        setSubscription(sub)
        setIsPro(pro || sub?.status === 'active')
        setOffering(off)
      } catch {
        // RevenueCat not configured or unavailable
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    init()
    return () => { cancelled = true }
  }, [user?.id])

  // `product` is the backend billing_products row (server catalog) being bought.
  // We need it to open a server-side payment intent BEFORE charging, so the
  // server owns the price/kind snapshot and hands us a merchantUid to reconcile
  // the eventual grant against. Optional so legacy callers still type-check, but
  // real purchases MUST pass it (otherwise we skip the intent and can't be
  // confirmed server-side). Returns the created merchantUid on success.
  const purchase = useCallback(async (pkg: PurchasesPackage, product?: BillingProduct) => {
    // [SUBSCRIPTION-HIDDEN] no-op while the whole flow is gated off.
    if (!SUBSCRIPTION_UI_ENABLED) return { success: false, error: 'disabled' as const }
    setPurchasing(true)
    try {
      // ── Step 1: open a server-side payment intent (mig 120). The server
      // snapshots price + kind and returns a merchantUid. Do NOT charge the
      // store without one — there'd be no way to reconcile/confirm the grant.
      const intent = product ? await createPaymentIntent(product.id) : null
      if (product && !intent) {
        return { success: false, error: 'intent_failed' as const }
      }

      // ── Step 2: tag the store transaction with the intent handle. This sets
      // subscriber_attributes.merchant_uid on the RevenueCat subscriber BEFORE
      // charging, so the INITIAL_PURCHASE event RevenueCat forwards to our
      // revenuecat-webhook carries merchant_uid back — the piece that lets the
      // webhook reconcile the settled store transaction against THIS pending
      // intent. Fail-soft: no-op while the SDK is absent / the flow is gated off
      // (the app_user_id path still attributes the grant), so we don't gate the
      // purchase on its result. See purchaseService.setMerchantUid + the OWNER
      // GO-LIVE CHECKLIST in services/purchases.ts.
      if (intent) {
        await purchaseService.setMerchantUid(intent.merchantUid)
      }

      // ── Step 3: charge via the store (RevenueCat).
      const result = await purchaseService.purchase(pkg)

      if (result.success) {
        // Only flip local Pro state when the purchase actually carries the `pro`
        // entitlement (a SUBSCRIPTION). A CONSUMABLE credit pack settles with
        // success=true but isPro=false — it must NOT mark the user Pro.
        if (result.isPro) setIsPro(true)
        // ── Step 4: the DB entitlement is granted SERVER-SIDE only.
        // TODO(payment-webhook / IAP): the successful store transaction must be
        // mapped to `intent.merchantUid` and drive the confirm path:
        //   store IAP receipt -> RevenueCat (receipt validation) -> RevenueCat
        //   webhook -> our payment-webhook edge fn -> confirm_payment(
        //     merchant_uid, provider, provider_payment_id) via SERVICE ROLE.
        // The client MUST NOT call confirm_payment itself — it is REVOKE'd from
        // anon+authenticated (service_role only), so self-grant is impossible by
        // design. If RevenueCat's webhook isn't wired yet, the server-side
        // fallback is admin_confirm_payment(merchant_uid) (is_admin only, for
        // testing/comp/support) — never expose that to the client.
        // Until confirm lands the grant is async, so just re-poll the
        // authoritative row (optionally retry/backoff if the webhook is slow).
        await refreshSubscription()
      }
      return { ...result, merchantUid: intent?.merchantUid }
    } finally {
      setPurchasing(false)
    }
  }, [refreshSubscription])

  const restore = useCallback(async () => {
    // [SUBSCRIPTION-HIDDEN] no-op while the whole flow is gated off (match purchase()).
    if (!SUBSCRIPTION_UI_ENABLED) return { success: false, error: 'disabled' as const }
    setPurchasing(true)
    try {
      const result = await purchaseService.restore()
      if (result.success) {
        setIsPro(true)
      }
      return result
    } finally {
      setPurchasing(false)
    }
  }, [])

  return {
    isPro,
    offering,
    products,          // server catalog (get_billing_products) — source of truth
    subscription,      // caller's active sub (get_my_subscription) or null
    loading,
    purchasing,
    purchase,
    restore,
    refreshSubscription,
  }
}
