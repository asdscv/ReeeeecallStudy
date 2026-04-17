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
import { purchaseService, PRO_ENTITLEMENT } from '../services/purchases'
import { useAuthState } from './useAuthState'

/**
 * Hook for in-app purchases.
 * Wraps PurchaseService with React state management.
 */
export function usePurchases() {
  const { user } = useAuthState()
  const [isPro, setIsPro] = useState(false)
  const [offering, setOffering] = useState<PurchasesOffering | null>(null)
  const [loading, setLoading] = useState(true)
  const [purchasing, setPurchasing] = useState(false)

  // Initialize and check status
  useEffect(() => {
    async function init() {
      try {
        await purchaseService.init(user?.id)
        if (user?.id) {
          await purchaseService.login(user.id)
        }
        const pro = await purchaseService.isPro()
        setIsPro(pro)
        const off = await purchaseService.getOfferings()
        setOffering(off)
      } catch {
        // RevenueCat not configured or unavailable
      } finally {
        setLoading(false)
      }
    }
    init()
  }, [user?.id])

  const purchase = useCallback(async (pkg: PurchasesPackage) => {
    setPurchasing(true)
    try {
      const result = await purchaseService.purchase(pkg)
      if (result.success) {
        setIsPro(true)
      }
      return result
    } finally {
      setPurchasing(false)
    }
  }, [])

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
    loading,
    purchasing,
    purchase,
    restore,
  }
}
