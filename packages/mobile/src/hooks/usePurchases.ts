import { useState, useEffect, useCallback } from 'react'
import type { PurchasesPackage, PurchasesOffering } from 'react-native-purchases'
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
