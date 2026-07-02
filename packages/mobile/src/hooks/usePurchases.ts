// ─────────────────────────────────────────────────────────────────────────
// [SUBSCRIPTION-HIDDEN] 2026-04-15 — Apple 심사 리젝 대응
// 이 훅은 현재 어떤 화면에서도 호출되지 않음 (PaywallScreen, SettingsScreen에서 제거).
// 코드는 유지하되 호출 진입점만 차단된 상태.
// 구독 기능 복원 시: SettingsScreen에서 usePurchases import + isPro 사용 복구.
// ─────────────────────────────────────────────────────────────────────────
import { useState, useEffect, useCallback } from 'react'
// [SUBSCRIPTION-HIDDEN] react-native-purchases 제거됨 — 타입 any로 대체
type PurchasesPackage = any
type PurchasesOffering = any
import { purchaseService, PRO_ENTITLEMENT, SUBSCRIPTION_UI_ENABLED } from '../services/purchases'
import { getBillingProducts, getMySubscription, type BillingProduct, type MySubscription } from '../services/billing'
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

  const purchase = useCallback(async (pkg: PurchasesPackage) => {
    setPurchasing(true)
    try {
      const result = await purchaseService.purchase(pkg)
      if (result.success) {
        setIsPro(true)
        // The DB entitlement is granted server-side by the payment-webhook
        // (RevenueCat -> grant_subscription/add_ai_credits). Re-fetch the
        // authoritative row rather than trusting the client-side result.
        // TODO(payment-webhook): if the webhook is slow, poll/retry here.
        await refreshSubscription()
      }
      return result
    } finally {
      setPurchasing(false)
    }
  }, [refreshSubscription])

  const restore = useCallback(async () => {
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
