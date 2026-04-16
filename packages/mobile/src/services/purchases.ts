// ─────────────────────────────────────────────────────────────────────────
// [SUBSCRIPTION-HIDDEN] 2026-04-15 — Apple 심사 리젝 대응
// 이 서비스는 현재 호출되지 않음 (usePurchases 훅도 미사용).
// 코드는 유지하되 UI 진입점 차단만으로 구독 기능 비활성화.
// 복원 시 추가 설정 필요:
//   - EXPO_PUBLIC_REVENUECAT_IOS_KEY / EXPO_PUBLIC_REVENUECAT_ANDROID_KEY
//   - RevenueCat 대시보드 entitlement "pro" + App Store Connect 상품 매핑
// ─────────────────────────────────────────────────────────────────────────
import type {
  PurchasesPackage,
  CustomerInfo,
  PurchasesOffering,
} from 'react-native-purchases'
import { Platform } from 'react-native'

// Lazy-load react-native-purchases to prevent crash if native module is missing
let Purchases: typeof import('react-native-purchases').default | null = null
let LOG_LEVEL: typeof import('react-native-purchases').LOG_LEVEL | null = null
try {
  const mod = require('react-native-purchases')
  Purchases = mod.default ?? mod.Purchases
  LOG_LEVEL = mod.LOG_LEVEL
} catch {
  console.warn('[PurchaseService] react-native-purchases native module not available')
}

// RevenueCat API keys — set via environment or constants
const REVENUECAT_IOS_KEY = process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY ?? ''
const REVENUECAT_ANDROID_KEY = process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY ?? ''

// Entitlement ID configured in RevenueCat dashboard
export const PRO_ENTITLEMENT = 'pro'

/**
 * RevenueCat service — single entry point for all purchase operations.
 * Enterprise pattern: isolate third-party SDK behind a service layer
 * so it can be swapped (e.g., Adapty, Qonversion) without touching UI.
 */
class PurchaseService {
  private initialized = false

  /**
   * Initialize RevenueCat SDK.
   * Must be called once on app startup, after user auth is established.
   */
  async init(userId?: string): Promise<void> {
    if (this.initialized || !Purchases) return

    const apiKey = Platform.OS === 'ios' ? REVENUECAT_IOS_KEY : REVENUECAT_ANDROID_KEY

    if (!apiKey) {
      if (__DEV__) console.warn('[PurchaseService] No RevenueCat API key configured')
      return
    }

    if (__DEV__ && LOG_LEVEL) {
      Purchases.setLogLevel(LOG_LEVEL.DEBUG)
    }

    await Purchases.configure({ apiKey, appUserID: userId ?? null })
    this.initialized = true
  }

  /**
   * Identify user with RevenueCat (call on login).
   */
  async login(userId: string): Promise<CustomerInfo> {
    const { customerInfo } = await Purchases!.logIn(userId)
    return customerInfo
  }

  /**
   * Clear user identity (call on logout).
   */
  async logout(): Promise<void> {
    await Purchases!.logOut()
  }

  /**
   * Check if user has Pro entitlement.
   */
  async isPro(): Promise<boolean> {
    if (!Purchases) return false
    try {
      const info = await Purchases.getCustomerInfo()
      return info.entitlements.active[PRO_ENTITLEMENT] !== undefined
    } catch {
      return false
    }
  }

  /**
   * Get available subscription offerings.
   */
  async getOfferings(): Promise<PurchasesOffering | null> {
    if (!Purchases) return null
    try {
      const offerings = await Purchases.getOfferings()
      return offerings.current
    } catch {
      return null
    }
  }

  /**
   * Purchase a package (subscription product).
   */
  async purchase(pkg: PurchasesPackage): Promise<{
    success: boolean
    customerInfo?: CustomerInfo
    error?: string
  }> {
    if (!Purchases) return { success: false, error: 'Purchases not available' }
    try {
      const { customerInfo } = await Purchases.purchasePackage(pkg)
      const isPro = customerInfo.entitlements.active[PRO_ENTITLEMENT] !== undefined
      return { success: isPro, customerInfo }
    } catch (e: any) {
      if (e.userCancelled) {
        return { success: false, error: 'cancelled' }
      }
      return { success: false, error: e.message ?? 'Purchase failed' }
    }
  }

  /**
   * Restore previous purchases (required by App Store guidelines).
   */
  async restore(): Promise<{
    success: boolean
    customerInfo?: CustomerInfo
    error?: string
  }> {
    if (!Purchases) return { success: false, error: 'Purchases not available' }
    try {
      const info = await Purchases.restorePurchases()
      const isPro = info.entitlements.active[PRO_ENTITLEMENT] !== undefined
      return { success: isPro, customerInfo: info }
    } catch (e: any) {
      return { success: false, error: e.message ?? 'Restore failed' }
    }
  }

  /**
   * Get current customer info.
   */
  async getCustomerInfo(): Promise<CustomerInfo | null> {
    if (!Purchases) return null
    try {
      return await Purchases.getCustomerInfo()
    } catch {
      return null
    }
  }
}

// Singleton export
export const purchaseService = new PurchaseService()
