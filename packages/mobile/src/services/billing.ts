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
import { getMobileSupabase } from '../adapters'

export type BillingProductKind = 'credit_pack' | 'subscription'

/** A row of `billing_products` (active only), as returned by get_billing_products(). */
export interface BillingProduct {
  id: string
  kind: BillingProductKind
  title: string
  priceKrw: number
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
  status: 'active' | 'canceled' | 'expired' | 'grace'
  cardLimit: number | null
  provider: string | null
  providerRef: string | null
  currentPeriodEnd: string | null
  createdAt: string
  updatedAt: string
}

/** Raw snake_case shape of a billing_products row as it arrives over PostgREST. */
interface RawProduct {
  id: string
  kind: string
  title: string
  price_krw: number
  credits_micro_won: number | null
  tier: string | null
  card_limit: number | null
  period: string | null
  sort_order: number
  is_active: boolean
}

function mapProduct(r: RawProduct): BillingProduct {
  return {
    id: String(r.id),
    kind: (r.kind as BillingProductKind),
    title: String(r.title),
    priceKrw: Number(r.price_krw ?? 0),
    // bigint returned as a JSON number; every configured pack is <= 1e10 (safe).
    creditsMicroWon: r.credits_micro_won == null ? null : Number(r.credits_micro_won),
    tier: r.tier ?? null,
    cardLimit: r.card_limit == null ? null : Number(r.card_limit),
    period: r.period ?? null,
    sortOrder: Number(r.sort_order ?? 0),
    isActive: r.is_active !== false,
  }
}

/**
 * Fetch the active product catalog (credit packs + subscriptions), already
 * ordered by sort_order,id server-side. Returns [] on any transient error so
 * callers can show an "unavailable" state rather than crash.
 */
export async function getBillingProducts(): Promise<BillingProduct[]> {
  const supabase = getMobileSupabase()
  const { data, error } = await supabase.rpc('get_billing_products')
  if (error || !data) return []
  const rows = (Array.isArray(data) ? data : []) as RawProduct[]
  return rows.map(mapProduct)
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
    current_period_end: string | null
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
    currentPeriodEnd: r.current_period_end ?? null,
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Payment intent — the FIRST step of any real purchase (mig 120).
//
// Flow (see mig 120 + payment-webhook contract):
//   1) client calls createPaymentIntent(productId) -> server snapshots
//      price(amount_krw) + kind + amount_micro_won into a 'pending'
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
  amount_micro_won: number | null
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
    amountMicroWon: r.amount_micro_won == null ? null : Number(r.amount_micro_won),
    title: String(r.title ?? ''),
  }
}

/** Convenience selectors over a catalog array. */
export const selectSubscriptions = (products: BillingProduct[]): BillingProduct[] =>
  products.filter((p) => p.kind === 'subscription')
export const selectCreditPacks = (products: BillingProduct[]): BillingProduct[] =>
  products.filter((p) => p.kind === 'credit_pack')
