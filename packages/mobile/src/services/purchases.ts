// ─────────────────────────────────────────────────────────────────────────
// [SUBSCRIPTION-HIDDEN] 2026-04-15 — Apple 심사 리젝 대응
// 이 서비스는 현재 호출되지 않음 (usePurchases 훅도 미사용).
// 코드는 유지하되 UI 진입점 차단만으로 구독 기능 비활성화.
// 복원 시 추가 설정 필요:
//   - EXPO_PUBLIC_REVENUECAT_IOS_KEY / EXPO_PUBLIC_REVENUECAT_ANDROID_KEY
//   - RevenueCat 대시보드 entitlement "pro" + App Store Connect 상품 매핑
// ─────────────────────────────────────────────────────────────────────────
// [SUBSCRIPTION-HIDDEN] react-native-purchases 제거됨 (네이티브 모듈 크래시 원인).
// 복원 시: pnpm add react-native-purchases --filter mobile 후 아래 타입/import 복구.
type PurchasesPackage = any
type CustomerInfo = any
type PurchasesOffering = any
import { Platform } from 'react-native'

// Lazy-load react-native-purchases — 현재 패키지 제거 상태, require는 항상 실패
let Purchases: any = null
let LOG_LEVEL: any = null
try {
  const mod = require('react-native-purchases')
  Purchases = mod.default ?? mod.Purchases
  LOG_LEVEL = mod.LOG_LEVEL
} catch {
  // react-native-purchases 제거 상태 — 정상 동작
}

// RevenueCat API keys — set via environment or constants
const REVENUECAT_IOS_KEY = process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY ?? ''
const REVENUECAT_ANDROID_KEY = process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY ?? ''

// Entitlement ID configured in RevenueCat dashboard
export const PRO_ENTITLEMENT = 'pro'

// ─────────────────────────────────────────────────────────────────────────
// [SUBSCRIPTION-HIDDEN] Master gate for the whole purchase/subscription UI.
// Keep FALSE until App Store Connect IAP products are submitted+approved and
// RevenueCat is wired (Apple Guideline 2.1(b)). Everything downstream —
// usePurchases catalog fetch + PaywallScreen rendering — checks this flag, so
// flipping it to true (after the restore steps in PaywallScreen's header) is
// the single switch that un-hides the flow. Nothing renders while false.
// ─────────────────────────────────────────────────────────────────────────
export const SUBSCRIPTION_UI_ENABLED = false

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
   * Find the RevenueCat package that corresponds to a backend product id
   * (billing_products.id, e.g. 'sub_pro_monthly' / 'credits_1000'). Match is
   * by store product identifier or package identifier — configure these to
   * equal the backend id in the RevenueCat dashboard so the server catalog
   * (get_billing_products) stays the single source of truth for what exists.
   */
  findPackageForProduct(offering: PurchasesOffering | null, productId: string): PurchasesPackage | null {
    const pkgs: any[] = offering?.availablePackages ?? []
    return (
      pkgs.find((p) => p?.product?.identifier === productId || p?.identifier === productId) ?? null
    )
  }

  /**
   * Purchase a package (subscription product).
   *
   * TODO(payment-webhook): entitlement/credit grants MUST happen server-side.
   * Do NOT grant here. The real flow is:
   *   1) RevenueCat processes the store purchase (this call).
   *   2) RevenueCat's server->server webhook (or App Store Server Notifications)
   *      hits our edge fn POST /functions/v1/payment-webhook with an
   *      x-webhook-signature: hex(HMAC-SHA256(rawBody, PAYMENT_WEBHOOK_SECRET)).
   *   3) The webhook maps the store product -> billing_products.id and calls
   *      grant_subscription(...) (kind:'subscription') or add_ai_credits(...)
   *      (kind:'credit', via product_id) — both idempotent on payment_id /
   *      (provider,provider_ref). See mig 119 webhookPayload contract.
   *   4) The client just RE-FETCHES getMySubscription()/get_owned_card_usage
   *      to reflect the granted state (usePurchases.refreshSubscription()).
   * The `success` returned here only means the store charge + RevenueCat
   * entitlement went through — it is NOT proof our DB was updated.
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
