// ─────────────────────────────────────────────────────────────────────────
// Mobile IAP (RevenueCat) — re-enabled for integration (react-native-purchases
// v10, New-Architecture ready). NOTE: this is a CODE integration + test build.
// Real purchases still need the owner-side store setup — see the OWNER GO-LIVE
// CHECKLIST below (ASC/Play products, RevenueCat offering/entitlement/keys,
// webhook secrets, Google Play payment profile, App Store re-review).
// ─────────────────────────────────────────────────────────────────────────
// Types come from the SDK via `import type` (erased at runtime, so it can never
// be the native-load crash source). The SDK OBJECT is still loaded through a
// DEFENSIVE require below — if the native module ever fails to link, the whole
// service degrades to no-ops instead of crashing at import.
import type { PurchasesPackage, CustomerInfo, PurchasesOffering } from 'react-native-purchases'
import { Platform } from 'react-native'

// Defensive runtime load of react-native-purchases. Present now (installed), but
// keep the try/catch so a native-link failure degrades gracefully to no-ops.
let Purchases: typeof import('react-native-purchases').default | null = null
let LOG_LEVEL: typeof import('react-native-purchases').LOG_LEVEL | null = null
try {
  const mod = require('react-native-purchases')
  Purchases = mod.default ?? mod.Purchases
  LOG_LEVEL = mod.LOG_LEVEL
} catch {
  // native module absent/unlinked — service no-ops (should not happen once built)
}

// RevenueCat API keys — set via environment or constants
const REVENUECAT_IOS_KEY = process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY ?? ''
const REVENUECAT_ANDROID_KEY = process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY ?? ''

// Entitlement ID configured in RevenueCat dashboard
export const PRO_ENTITLEMENT = 'pro'

// ─────────────────────────────────────────────────────────────────────────
// Custom RevenueCat *subscriber attribute* key that carries our server-created
// payment_intents.merchant_uid (mig 120) into every RevenueCat webhook delivery.
//
// RevenueCat surfaces custom subscriber attributes on each event under
//   event.subscriber_attributes[MERCHANT_UID_ATTRIBUTE].value
// so tagging it BEFORE calling purchasePackage (see setMerchantUid + usePurchases)
// makes the intent handle available server-side without any store-receipt
// plumbing — letting the revenuecat-webhook reconcile the settled store
// transaction against the exact pending intent.
//
// Keep this string identical to whatever key the webhook reads. NOTE: the
// currently-deployed revenuecat-webhook reconciles via the app_user_id +
// REVENUECAT_PRODUCT_MAP path and does NOT yet read subscriber_attributes —
// tagging merchant_uid here is forward-looking/belt-and-suspenders. See the
// OWNER GO-LIVE CHECKLIST below for the webhook-side change needed to consume it.
// ─────────────────────────────────────────────────────────────────────────
export const MERCHANT_UID_ATTRIBUTE = 'merchant_uid'

// ─────────────────────────────────────────────────────────────────────────
// OWNER GO-LIVE CHECKLIST (finishes the mobile IAP → grant wiring)
// Everything in this file is inert until BOTH of these are done AND the master
// gate SUBSCRIPTION_UI_ENABLED is flipped to true. Steps:
//
//   1. Install the SDK:  pnpm add react-native-purchases --filter mobile
//      then `expo prebuild` + a fresh native build (native module → NOT OTA).
//      Restore the real types/imports at the top of this file (drop the
//      `type … = any` shims and the try/catch require guard).
//   2. Store products: create the IAP products in App Store Connect (auto-
//      renewing subscription + any consumable credit packs) and in Google Play
//      Console, then add them to a RevenueCat "Offering" whose package/product
//      identifiers EQUAL our billing_products.id (so findPackageForProduct maps
//      the server catalog to the store package).
//   3. RevenueCat API keys: set EXPO_PUBLIC_REVENUECAT_IOS_KEY and
//      EXPO_PUBLIC_REVENUECAT_ANDROID_KEY (public SDK keys) in the app env.
//   4. Configure the RevenueCat "pro" entitlement (PRO_ENTITLEMENT) and attach
//      the subscription products to it.
//   5. Server secrets (Supabase → Edge Functions → Secrets — owner's job, NOT
//      touched here): REVENUECAT_WEBHOOK_AUTH (shared bearer token) and
//      REVENUECAT_PRODUCT_MAP (JSON: store product id → our billing_products.id).
//      Point the RevenueCat dashboard webhook at .../revenuecat-webhook with
//      that Authorization token. (See supabase/functions/revenuecat-webhook.)
//   6. OPTIONAL — intent reconciliation via merchant_uid: this file already
//      tags each purchase with subscriber_attributes.merchant_uid (step below).
//      To have the webhook USE it (instead of only the app_user_id+product map),
//      the owner must adapt revenuecat-webhook to read
//      event.subscriber_attributes.merchant_uid?.value and call
//      confirm_payment(merchant_uid, 'revenuecat', event.id). Until then the
//      attribute is carried but unused; the app_user_id path still grants.
// ─────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────
// [SUBSCRIPTION-HIDDEN] Master gate for the whole purchase/subscription UI.
// Keep FALSE until App Store Connect IAP products are submitted+approved and
// RevenueCat is wired (Apple Guideline 2.1(b)). Everything downstream —
// usePurchases catalog fetch + PaywallScreen rendering — checks this flag, so
// flipping it to true (after the restore steps in PaywallScreen's header) is
// the single switch that un-hides the flow. Nothing renders while false.
// ─────────────────────────────────────────────────────────────────────────
// VERIFIED (test build, 2026-07-21): with this flipped to `true` on a native
// build carrying react-native-purchases v10, the SDK configures with the iOS key,
// Purchases.logIn(<supabase uid>) aliases app_user_id correctly, and the Paywall
// renders + calls GetOfferings (200). It only returns empty offerings until the
// owner registers the store products (see OWNER GO-LIVE CHECKLIST above). Kept
// FALSE in the repo (Apple Guideline 2.1(b) — no live paywall without approved
// IAP products); flipping to true is the owner's final go-live switch.
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
   * Identify the RevenueCat subscriber with OUR Supabase user id (call on login).
   *
   * This aliases RevenueCat's `appUserID` to supabase `auth.uid()`, which is the
   * ONLY thing that lets the server-side revenuecat-webhook map an incoming
   * `app_user_id` back to OUR user row. The client does NOT grant anything here:
   * the actual entitlement / card-limit grant is done SERVER-SIDE by the
   * revenuecat-webhook edge fn (which calls sync_subscription_by_user /
   * activate_subscription_from_intent via the service role — mig 121). This call
   * is pure identity aliasing so the webhook can find the right user.
   */
  async login(userId: string): Promise<CustomerInfo | null> {
    // TODO(react-native-purchases): the SDK is currently NOT installed (removed —
    // it was the native-module crash source). Once restored (`pnpm add
    // react-native-purchases --filter mobile`) this call aliases the RC subscriber
    // to our supabase id. Until then `Purchases` is null, so we no-op — nothing
    // throws while the whole flow is gated off (SUBSCRIPTION_UI_ENABLED=false).
    if (!Purchases) return null
    const { customerInfo } = await Purchases.logIn(userId)
    return customerInfo
  }

  /**
   * Clear user identity (call on logout).
   */
  async logout(): Promise<void> {
    if (!Purchases) return
    await Purchases.logOut()
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
   * Tag a server-created payment intent (mig 120) onto the RevenueCat subscriber
   * BEFORE calling purchasePackage, so the store event RevenueCat forwards to our
   * revenuecat-webhook carries the intent handle back in
   *   event.subscriber_attributes[MERCHANT_UID_ATTRIBUTE].value
   * — letting the webhook reconcile the settled transaction against the exact
   * pending intent (in addition to / instead of the app_user_id + product-map
   * path). This is the mobile analogue of the web providers threading
   * merchant_uid through checkout custom data.
   *
   * Fail-soft by design: returns false (never throws) when the SDK is absent or
   * the flow is gated off, so a purchase is never blocked on attribute tagging.
   *
   * @returns true only if the attribute was actually set on the SDK.
   */
  async setMerchantUid(merchantUid: string): Promise<boolean> {
    // Gate + SDK guards: no-op while SUBSCRIPTION_UI_ENABLED is false or the
    // native module isn't installed (removed — crash source; see header).
    if (!SUBSCRIPTION_UI_ENABLED || !Purchases || !merchantUid) return false
    try {
      // TODO(react-native-purchases): once the SDK is restored this attaches the
      // intent handle to the RC subscriber. `setAttributes` MERGES custom
      // attributes (does not clear others), keyed by the string keys we choose,
      // and is flushed to RevenueCat's servers with the next SDK network call —
      // i.e. purchasePackage() below — so the value is present on the resulting
      // INITIAL_PURCHASE webhook. Equivalent: Purchases.setAttributes({ merchant_uid }).
      await Purchases.setAttributes({ [MERCHANT_UID_ATTRIBUTE]: merchantUid })
      return true
    } catch {
      // Never block a purchase on attribute tagging — the app_user_id path still
      // lets the webhook attribute the grant even if this fails.
      return false
    }
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
   * `success` = the store transaction COMPLETED (settled, not cancelled/errored) —
   * it is the ONLY success signal for a CONSUMABLE credit pack, which grants no
   * entitlement (so `isPro` stays false for it). `isPro` is reported SEPARATELY for
   * the subscription flow. Neither proves our DB was updated — the credits /
   * subscription grant happens SERVER-SIDE via the RevenueCat webhook; the client
   * just re-polls (wallet / getMySubscription).
   */
  async purchase(pkg: PurchasesPackage): Promise<{
    success: boolean
    isPro: boolean
    customerInfo?: CustomerInfo
    error?: string
  }> {
    if (!Purchases) return { success: false, isPro: false, error: 'Purchases not available' }
    try {
      const { customerInfo } = await Purchases.purchasePackage(pkg)
      const isPro = customerInfo.entitlements.active[PRO_ENTITLEMENT] !== undefined
      // success = transaction settled (works for consumables too); isPro is separate.
      return { success: true, isPro, customerInfo }
    } catch (e: any) {
      if (e.userCancelled) {
        return { success: false, isPro: false, error: 'cancelled' }
      }
      return { success: false, isPro: false, error: e.message ?? 'Purchase failed' }
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
