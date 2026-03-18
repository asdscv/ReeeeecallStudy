import Purchases, {
  type PurchasesPackage,
  type CustomerInfo,
  type PurchasesOffering,
  LOG_LEVEL,
} from 'react-native-purchases'
import { Platform } from 'react-native'

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
    if (this.initialized) return

    const apiKey = Platform.OS === 'ios' ? REVENUECAT_IOS_KEY : REVENUECAT_ANDROID_KEY

    if (!apiKey) {
      if (__DEV__) console.warn('[PurchaseService] No RevenueCat API key configured')
      return
    }

    if (__DEV__) {
      Purchases.setLogLevel(LOG_LEVEL.DEBUG)
    }

    await Purchases.configure({ apiKey, appUserID: userId ?? null })
    this.initialized = true
  }

  /**
   * Identify user with RevenueCat (call on login).
   */
  async login(userId: string): Promise<CustomerInfo> {
    const { customerInfo } = await Purchases.logIn(userId)
    return customerInfo
  }

  /**
   * Clear user identity (call on logout).
   */
  async logout(): Promise<void> {
    await Purchases.logOut()
  }

  /**
   * Check if user has Pro entitlement.
   */
  async isPro(): Promise<boolean> {
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
    try {
      return await Purchases.getCustomerInfo()
    } catch {
      return null
    }
  }
}

// Singleton export
export const purchaseService = new PurchaseService()
