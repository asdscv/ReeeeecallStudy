// ─────────────────────────────────────────────────────────────────────────
// Billing bridge — typed read layer over the payment/subscription backend
// (mig 119 `119_payment_subscriptions_billing.sql`).
//
// The `billing_products` and `subscriptions` tables are default-deny RLS
// (no client write policy, and REVOKE ALL from anon/authenticated), so the
// only client read paths are these two auth.uid()-scoped SECURITY DEFINER RPCs:
//   - get_billing_products() -> json_agg of active products (server catalog)
//   - get_my_subscription()  -> row_to_json of the caller's active sub, or null
//
// This is the *source of truth* for what products exist + their display
// metadata (KRW price, credits, tier, card_limit). Actual purchasing still
// goes through the store IAP layer (RevenueCat, see services/purchases.ts) and
// entitlement grants happen SERVER-SIDE via the payment-webhook — never here.
// ─────────────────────────────────────────────────────────────────────────
import { Platform } from 'react-native'
import { getMobileSupabase } from '../adapters'

export type BillingProductKind = 'credit_pack' | 'subscription'

/** A row of `billing_products` (active only), as returned by get_billing_products(). */
export interface BillingProduct {
  id: string
  kind: BillingProductKind
  title: string
  priceKrw: number
  /**
   * USD price in cents (mig 128/129). The LemonSqueezy/IAP store charges USD, so
   * this — NOT priceKrw (a stale mig-124 placeholder) — is the price to DISPLAY.
   */
  priceUsdCents: number | null
  /** credit_pack only — micro-WON granted on purchase (null for subscriptions). */
  creditsMicroWon: number | null
  /** subscription only — tier name (null for credit packs). */
  tier: string | null
  /** subscription only — owned-card cap this tier lifts to (null for credit packs). */
  cardLimit: number | null
  /** e.g. 'month' (subscriptions); null for one-off credit packs. */
  period: string | null
  sortOrder: number
  isActive: boolean
  /**
   * The store IAP product id to purchase for THIS platform (App Store / Play), resolved
   * server-side from the billing_product_skus catalog (mig 151) by get_billing_products(
   * Platform.OS). This is the identifier passed to purchaseService.findPackageForProduct —
   * decoupling the store SKU from our internal `id`. Null when no active SKU is registered
   * for this platform (then callers fall back to `id`).
   */
  storeProductId: string | null
}

/**
 * A server-created 'pending' payment_intents row, as returned by
 * create_payment_intent() (mig 120). The server SNAPSHOTS price + kind here so
 * the client can never pick its own price or self-grant — `merchantUid` is the
 * only handle the client needs, and the actual entitlement is granted later,
 * server-side, when the payment-webhook calls confirm_payment(merchantUid).
 */
export interface PaymentIntent {
  merchantUid: string
  productId: string
  kind: BillingProductKind
  amountKrw: number
  /** credit_pack only — micro-WON to be granted on confirm (null for subscriptions). */
  amountMicroWon: number | null
  title: string
}

/** The caller's active subscription, as returned by get_my_subscription() (or null). */
export interface MySubscription {
  id: string
  userId: string
  productId: string | null
  tier: string
  status: 'active' | 'canceled' | 'expired' | 'grace' | 'past_due'
  cardLimit: number | null
  provider: string | null
  providerRef: string | null
  /** LS subscription id / RevenueCat original_transaction_id, matched by lifecycle events (mig 121). */
  providerSubscriptionId: string | null
  currentPeriodEnd: string | null
  /**
   * true once the subscription is set to end at the current period boundary
   * (canceled but still paid through currentPeriodEnd) — drives the
   * "canceling on <date>" note in the UI (mig 121).
   */
  cancelAtPeriodEnd: boolean
  createdAt: string
  updatedAt: string
}

/** Raw snake_case shape of a billing_products row as it arrives over PostgREST. */
interface RawProduct {
  id: string
  kind: string
  title: string
  price_krw: number
  price_usd_cents: number | null
  credits_micro_usd: number | null
  tier: string | null
  card_limit: number | null
  period: string | null
  sort_order: number
  is_active: boolean
  // Added by get_billing_products(p_platform) (mig 151); absent from the no-arg overload.
  store_product_id?: string | null
}

function mapProduct(r: RawProduct): BillingProduct {
  return {
    id: String(r.id),
    kind: (r.kind as BillingProductKind),
    title: String(r.title),
    priceKrw: Number(r.price_krw ?? 0),
    priceUsdCents: r.price_usd_cents == null ? null : Number(r.price_usd_cents),
    // bigint returned as a JSON number; every configured pack is <= 1e10 (safe).
    creditsMicroWon: r.credits_micro_usd == null ? null : Number(r.credits_micro_usd),
    tier: r.tier ?? null,
    cardLimit: r.card_limit == null ? null : Number(r.card_limit),
    period: r.period ?? null,
    sortOrder: Number(r.sort_order ?? 0),
    isActive: r.is_active !== false,
    storeProductId: r.store_product_id == null ? null : String(r.store_product_id),
  }
}

/**
 * Fetch the active product catalog (credit packs + subscriptions), already
 * ordered by sort_order,id server-side. Returns [] on any transient error so
 * callers can show an "unavailable" state rather than crash.
 */
export async function getBillingProducts(): Promise<BillingProduct[]> {
  const supabase = getMobileSupabase()
  // Pass this platform so the catalog carries each product's store IAP id
  // (get_billing_products(p_platform), mig 151). The RPC's no-arg overload is unaffected;
  // an unknown platform simply yields null store_product_id, so this is always safe.
  const { data, error } = await supabase.rpc('get_billing_products', { p_platform: Platform.OS })
  if (error || !data) return []
  const rows = (Array.isArray(data) ? data : []) as RawProduct[]
  return rows.map(mapProduct)
}

/**
 * The free-tier limits a pricing surface has to state: the owned-card cap and the
 * daily AI quota. Both are admin-settable (mig 154 / mig 177), which is exactly why
 * they must not be written into copy.
 */
export interface PlanLimits {
  /** `card_limit_settings.max_owned_cards`. */
  freeCardLimit: number
  /** `ai_pricing_settings.free_cards_per_day`. */
  freeAiCardsPerDay: number
}

/**
 * Read the free-tier limits (mig 179 `get_plan_limits`).
 *
 * Returns `null` — never a guess — when the value cannot be read or the config row
 * is missing. The caller's job is then to say NOTHING about the number, because the
 * failure mode this replaces is precisely a plausible-looking stale figure on a
 * screen that is asking someone for money. A wrong cap is worse than no cap.
 */
export async function getPlanLimits(): Promise<PlanLimits | null> {
  const supabase = getMobileSupabase()
  const { data, error } = await supabase.rpc('get_plan_limits')
  if (error || !data) return null
  const row = data as { free_card_limit?: number | null; free_ai_cards_per_day?: number | null }
  // Both or neither: a table that shows one real number beside one blank cell reads
  // as a broken screen, and the two come from the same round trip anyway.
  if (row.free_card_limit == null || row.free_ai_cards_per_day == null) return null
  return {
    freeCardLimit: Number(row.free_card_limit),
    freeAiCardsPerDay: Number(row.free_ai_cards_per_day),
  }
}

/**
 * Fetch the caller's currently-active subscription, or null if they are on the
 * free plan (or on a transient error — callers should treat null as "free").
 */
export async function getMySubscription(): Promise<MySubscription | null> {
  const supabase = getMobileSupabase()
  const { data, error } = await supabase.rpc('get_my_subscription')
  if (error || !data) return null
  const r = data as {
    id: string
    user_id: string
    product_id: string | null
    tier: string
    status: string
    card_limit: number | null
    provider: string | null
    provider_ref: string | null
    provider_subscription_id: string | null
    current_period_end: string | null
    // mig-121 field; absent (undefined) on a DB still on the mig-119 shape → false.
    cancel_at_period_end: boolean | null
    created_at: string
    updated_at: string
  }
  return {
    id: String(r.id),
    userId: String(r.user_id),
    productId: r.product_id ?? null,
    tier: String(r.tier),
    status: (r.status as MySubscription['status']),
    cardLimit: r.card_limit == null ? null : Number(r.card_limit),
    provider: r.provider ?? null,
    providerRef: r.provider_ref ?? null,
    providerSubscriptionId: r.provider_subscription_id ?? null,
    currentPeriodEnd: r.current_period_end ?? null,
    cancelAtPeriodEnd: r.cancel_at_period_end === true,
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Payment intent — the FIRST step of any real purchase (mig 120).
//
// Flow (see mig 120 + payment-webhook contract):
//   1) client calls createPaymentIntent(productId) -> server snapshots
//      price(amount_krw) + kind + amount_micro_usd into a 'pending'
//      payment_intents row and returns a fresh `merchantUid`.
//   2) client opens the provider checkout carrying that `merchantUid`.
//   3) the PROVIDER'S server POSTs the signed payment-webhook, which
//      HMAC-verifies then calls confirm_payment(merchantUid, provider,
//      providerPaymentId) with the SERVICE-ROLE client — locking the intent,
//      marking it paid idempotently, and granting credits (add_ai_credits) or
//      a subscription (grant_subscription) from the *server-snapshotted* amount.
//
// PROVIDER SEAM (iOS/Android IAP) — the client NEVER grants and NEVER calls
// confirm_payment (it is REVOKE'd from anon+authenticated; service_role only).
// On mobile the "provider" is the App Store / Play Store via RevenueCat:
//   store IAP receipt -> RevenueCat (validates the receipt) -> RevenueCat's
//   server->server webhook -> our payment-webhook edge fn -> confirm_payment.
// For that webhook to reconcile the right intent, the store transaction must
// carry `merchantUid` (attach it as a RevenueCat subscriber attribute /
// purchase metadata BEFORE calling purchasePackage — see usePurchases). The
// admin_confirm_payment() RPC exists only for testing/comp/support (is_admin).
// ─────────────────────────────────────────────────────────────────────────

/** Raw snake_case shape returned by create_payment_intent() over PostgREST. */
interface RawPaymentIntent {
  merchant_uid: string
  product_id: string
  kind: string
  amount_krw: number
  amount_micro_usd: number | null
  title: string
}

/**
 * Create a 'pending' payment intent for the given billing_products.id and
 * return its server-snapshotted details (incl. `merchantUid`). Returns null if
 * the caller is unauthenticated, the product is inactive/unknown, or on any
 * transient error — callers must treat null as "can't start checkout" and must
 * NOT open the provider checkout without a merchantUid to reconcile against.
 */
export async function createPaymentIntent(productId: string): Promise<PaymentIntent | null> {
  const supabase = getMobileSupabase()
  const { data, error } = await supabase.rpc('create_payment_intent', { p_product_id: productId })
  if (error || !data) return null
  const r = data as RawPaymentIntent
  if (!r.merchant_uid) return null
  return {
    merchantUid: String(r.merchant_uid),
    productId: String(r.product_id),
    kind: r.kind as BillingProductKind,
    amountKrw: Number(r.amount_krw ?? 0),
    amountMicroWon: r.amount_micro_usd == null ? null : Number(r.amount_micro_usd),
    title: String(r.title ?? ''),
  }
}

/**
 * Record that the buyer was shown the withdrawal-right disclosure BEFORE paying
 * (mig 157 `record_purchase_consent`).
 *
 * Korea's 전자상거래법 only allows restricting withdrawal for digital content once
 * use has begun where that restriction was disclosed beforehand; the EU/UK rule needs
 * express consent to immediate performance plus acknowledgement that the withdrawal
 * right is lost. Both are evidentiary — without a record, "you already used it" is not
 * a defensible reason to refuse a refund, which is why refund_eligibility surfaces
 * `consent_recorded` to the admin.
 *
 * The server stamps the timestamp and the policy version, so a client cannot back-date
 * a consent to fit a later dispute. Store IAP purchases have no merchant_uid at consent
 * time, so the record is tied to the user + product instead.
 *
 * Best-effort by design: a logging failure must not strand a buyer mid-purchase, and
 * its absence only weakens OUR position, never the customer's.
 */
export async function recordPurchaseConsent(
  productId: string,
  merchantUid?: string | null,
): Promise<void> {
  try {
    const supabase = getMobileSupabase()
    const { error } = await supabase.rpc('record_purchase_consent', {
      p_product_id: productId,
      p_platform: Platform.OS === 'ios' ? 'ios' : 'android',
      p_merchant_uid: merchantUid ?? null,
    })
    if (error && __DEV__) console.warn('[billing] record_purchase_consent failed:', error.message)
  } catch (e) {
    if (__DEV__) console.warn('[billing] record_purchase_consent threw:', e)
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Payment / order history (결제 내역) — mig 131 `get_my_payment_history`.
//
// Merges chronologically, auth.uid()-scoped: payment_intents (the INITIAL purchase of
// either kind — this is where a store IAP lands once the RevenueCat webhook calls
// confirm_payment on the intent the client created) ∪ billing_invoices with
// billing_reason <> 'initial' (recurring RENEWALS, which never create an intent).
// So an App Store / Play subscription shows both its first charge and every renewal.
//
// Keyset pagination on created_at: pass the OLDEST row you hold as `before` to get the
// next older page. The RPC clamps p_limit to [1,100].
// ─────────────────────────────────────────────────────────────────────────

export interface PaymentHistoryRow {
  /** merchant_uid (intent) or invoice id — unique only WITH `source`. */
  ref: string
  /** 'intent' | 'invoice' — which table the row came from. */
  source: string
  title: string
  kind: string
  /** Charged amount in USD cents; null on a legacy ₩-only row. */
  amountUsdCents: number | null
  amountKrw: number | null
  currency: string
  /** 'initial' | 'renewal' | 'updated' | null — drives the badge next to the title. */
  billingReason: string | null
  status: string
  createdAt: string
}

interface RawPaymentHistoryRow {
  ref: string
  source: string
  product_id: string
  title: string
  kind: string
  amount_usd_cents: number | null
  amount_krw: number | null
  currency: string
  billing_reason: string | null
  status: string
  created_at: string
}

/**
 * One page of the caller's payment history, newest first. `before` is the createdAt of
 * the oldest row already held (omit for the first page).
 *
 * Returns null on a transient error — deliberately NOT [] like getBillingProducts:
 * "no receipts" and "we couldn't reach the server" must not look the same to someone
 * who just paid, so the caller shows a retry state instead of "No payments yet".
 */
export async function getMyPaymentHistory(limit = 10, before?: string | null): Promise<PaymentHistoryRow[] | null> {
  const supabase = getMobileSupabase()
  const { data, error } = await supabase.rpc('get_my_payment_history', {
    p_limit: limit,
    p_before: before ?? null,
  })
  if (error) return null
  if (!data) return []
  const rows = (Array.isArray(data) ? data : []) as RawPaymentHistoryRow[]
  return rows.map((r) => ({
    ref: String(r.ref),
    source: String(r.source),
    title: String(r.title ?? ''),
    kind: String(r.kind),
    amountUsdCents: r.amount_usd_cents == null ? null : Number(r.amount_usd_cents),
    amountKrw: r.amount_krw == null ? null : Number(r.amount_krw),
    currency: r.currency ?? 'usd',
    billingReason: r.billing_reason ?? null,
    status: String(r.status),
    createdAt: String(r.created_at),
  }))
}

/** Convenience selectors over a catalog array. */
export const selectSubscriptions = (products: BillingProduct[]): BillingProduct[] =>
  products.filter((p) => p.kind === 'subscription')
export const selectCreditPacks = (products: BillingProduct[]): BillingProduct[] =>
  products.filter((p) => p.kind === 'credit_pack')
