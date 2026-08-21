// RevenueCat webhook — MOBILE IAP subscription grants + lifecycle (migs 119/120/121).
//
// RevenueCat is the mobile store-billing gateway (App Store / Play Billing). The app
// calls `Purchases.logIn(<our supabase user id>)` so RevenueCat's `app_user_id` IS our
// `auth.users.id`. When a purchase settles OR a subscription's state changes (renew,
// cancel, expire, billing issue, pause, refund), RevenueCat's SERVER POSTs this webhook.
//
// GRANT vs LIFECYCLE (why two RPC families — see mig 121):
//   * FIRST GRANT / renewal / product-change carry the buyer + product, so we UPSERT
//     the sub by (provider, provider_subscription_id) via sync_subscription_by_user
//     (RevenueCat has no merchant_uid / payment_intents row — the RC path passes
//     user+product DIRECTLY). A CONSUMABLE credit pack tops up the micro-WON wallet
//     via add_ai_credits instead (idempotent on the RC event id).
//   * ONGOING lifecycle events only name the PROVIDER'S subscription id, so we
//     UPDATE-ONLY the matching row via sync_subscription / revoke_subscription. An
//     event with no matching row → {ok:false, reason:'not_found'} → ack 200 (never
//     create from a bare lifecycle event).
//   Grants come from the SERVER catalog (billing_products), never from the webhook
//   body — the body only names WHICH product/subscription changed; it can't pick a
//   price or self-grant. All writes go through the service-role client below.
//
// SUBSCRIPTION KEY = original_transaction_id, and it is REQUIRED for EVERY subscription
//   write (grant/renew, sync, revoke). It is the only per-user-safe key; the store
//   product_id is SHARED across all buyers of a plan, so keying a write on it could
//   match/sync/revoke a DIFFERENT user's row. An event that carries no
//   original_transaction_id is ACKed 200 without writing (never falls back to product_id).
//
// STORE ATTRIBUTION (mig 156). RevenueCat fronts BOTH stores under one provider
//   ('revenuecat'), but they are not interchangeable: Google Play exposes a developer
//   refund API and Apple does not, so the admin tooling must know WHICH store sold a
//   given row. `event.store` is the only place that knows — the product id cannot be
//   used, since mig 151 maps the credit packs to the SAME store id on ios and android.
//   Every grant and lifecycle event therefore stamps 'ios'/'android' via
//   set_subscription_platform / set_credit_grant_platform. Both are best-effort: a
//   failure leaves the row unattributed, which the admin UI reads as 'mobile_unknown'
//   and treats as revoke-only (never claiming a money refund it cannot perform).
//
// SANDBOX vs PRODUCTION (mig 159). RevenueCat tags every event with `environment`.
//   A sandbox purchase is FREE and made from a tester account you create yourself,
//   but it used to run the SAME grant path as a real one — real micro-USD credited
//   to a real account, indistinguishable afterwards, and counted in MRR. Now the
//   environment is recorded on the row, sandbox grants are gated behind the
//   default-off system_flags.sandbox_grants_enabled kill switch, and the admin
//   overview keeps sandbox out of every business metric while still reporting it.
//   Anything not explicitly SANDBOX is treated as production.
//
// HOW A REFUND ACTUALLY ARRIVES (and how this used to be wrong).
//   RevenueCat's webhook has NO `REFUND` or `CHARGEBACK` event type. A store refund is
//   delivered as `CANCELLATION` carrying `cancel_reason: "CUSTOMER_SUPPORT"` and a
//   NEGATIVE `price` (RevenueCat "Event Types and Fields" / "Sample Events"; the
//   cancellation-reason table defines CUSTOMER_SUPPORT as "customer received a refund").
//   This function used to read `event.cancellation_reason` — a key RevenueCat does not
//   send — so the comparison was always undefined !== 'CUSTOMER_SUPPORT' and every
//   refund fell into the plain auto-renew-off branch:
//     * a refunded credit pack was NEVER clawed back (money out, credits kept), and
//     * a refunded subscription kept its raised card cap until period end.
//   The local e2e "passed" because it synthesised `type: "REFUND"`, which RevenueCat
//   never sends, so the dead branch was the only one ever exercised. Reproduced against
//   the served function: purchase → balance 990000, then the real CANCELLATION refund
//   shape → balance still 990000, zero reversal rows.
//   Refund detection now reads `cancel_reason` (with `cancellation_reason` kept as a
//   legacy alias) OR a negative price on a CANCELLATION, and the legacy REFUND /
//   CHARGEBACK types are still accepted in case a project is on an older delivery.
//
// EVENT → RPC (event.type):
//   INITIAL_PURCHASE / NON_RENEWING_PURCHASE (subscription product)
//                                → sync_subscription_by_user(active,  expiry, cancel=false)
//   NON_RENEWING_PURCHASE (credit_pack product)
//                                → add_ai_credits(credits_micro_usd, 'purchase', event.id)
//   RENEWAL / UNCANCELLATION / PRODUCT_CHANGE / SUBSCRIPTION_EXTENDED
//                                → sync_subscription_by_user(active,  new expiry, cancel=false)
//   CANCELLATION (auto-renew off)→ sync_subscription('canceled', expiry, cancel=true)
//   CANCELLATION (refund: cancel_reason=CUSTOMER_SUPPORT or price < 0)
//                                → subscription: revoke_subscription; consumable credit
//                                  pack: clawback_ai_credits_by_ref (mig 134)
//   REFUND / CHARGEBACK (legacy) → same refund handling as above
//   REFUND_REVERSED              → subscription: sync_subscription_by_user(active);
//                                  consumable: reverse_credit_clawback (mig 173)
//   EXPIRATION                   → sync_subscription('expired')
//   BILLING_ISSUE                → sync_subscription('past_due')
//   SUBSCRIPTION_PAUSED          → sync_subscription('paused')
//   (anything else)              → 200 {received:true}  (ack so RC stops retrying)
//
// AUTH (RevenueCat uses NO HMAC — a shared bearer token instead):
//   RevenueCat signs each delivery with a fixed `Authorization` header value you set.
//   We require REVENUECAT_WEBHOOK_AUTH and compare (constant-time) the header's token to
//   it. Fail-closed: unset secret → 503 (NEVER grants unconfigured); mismatch → 401.
//   The header may be sent as `Bearer <token>` or the bare token — both are accepted.
//
// ── OWNER GO-LIVE SETUP ──
//   env secrets (Supabase → Edge Functions → Secrets):
//     REVENUECAT_WEBHOOK_AUTH   — the shared Authorization token (choose any strong string)
//     REVENUECAT_PRODUCT_MAP    — JSON map: store IAP product id → OUR billing_products id,
//                                 e.g. {"rc_pro_monthly":"sub_pro_monthly",
//                                       "rc_credits_5000":"credits_5000"}
//   In the RevenueCat dashboard:
//     Integrations → Webhooks → + New webhook
//       URL                     https://<project-ref>.functions.supabase.co/revenuecat-webhook
//       Authorization header    Bearer <REVENUECAT_WEBHOOK_AUTH>   (paste the same token)
//       Environment             Both Production and Sandbox
//       App / Event type        All apps / All events
//       Paywall events          OFF (we handle none; they would be pure log noise)
//     Save; RevenueCat sends every subscriber event to this URL with that header.
//     Selecting "Both" is safe: sandbox events are ACKed but grant NOTHING until an
//     admin flips system_flags.sandbox_grants_enabled on for a test run (mig 159).
//   And in the app: call Purchases.logIn(<supabase user id>) so app_user_id == our uid.
//
// Deploy: config.toml sets verify_jwt = false (RevenueCat, not a user JWT, calls this);
// the shared bearer token is the auth. Until REVENUECAT_WEBHOOK_AUTH is set → 503.

import { createClient } from '@supabase/supabase-js'

const ENV = (k: string) => Deno.env.get(k)

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// constant-time string compare (avoid token timing oracles)
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let r = 0
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return r === 0
}

// RevenueCat sends the token in `Authorization` (with or without a `Bearer ` prefix).
function verifyAuth(header: string | null, token: string): boolean {
  if (!header) return false
  const provided = header.replace(/^Bearer\s+/i, '').trim()
  return timingSafeEqual(provided, token)
}

// epoch-ms → ISO timestamptz (or null when absent/invalid). RevenueCat gives
// expiration_at_ms in milliseconds; sync_* RPCs take a timestamptz.
function msToIso(ms: unknown): string | null {
  const n = typeof ms === 'number' ? ms : Number(ms)
  return Number.isFinite(n) && n > 0 ? new Date(n).toISOString() : null
}

// Legacy fallback map (REVENUECAT_PRODUCT_MAP env secret): store IAP id → our product id.
function parseProductMap(): Record<string, string> {
  const raw = ENV('REVENUECAT_PRODUCT_MAP')
  if (!raw) return {}
  try {
    const obj = JSON.parse(raw)
    if (obj && typeof obj === 'object') return obj as Record<string, string>
  } catch { /* invalid JSON — treated as empty, unmapped products 400 below */ }
  return {}
}

// RevenueCat's `store` field → our billing_product_skus.platform value. Unknown/absent →
// null (resolve_store_product then matches any platform, resolving only if unambiguous —
// and our credit/sub ids are shared across ios+android, so a null store still resolves).
function platformFromStore(store: unknown): string | null {
  switch (typeof store === 'string' ? store.toUpperCase() : '') {
    case 'APP_STORE':
    case 'MAC_APP_STORE':
      return 'ios'
    case 'PLAY_STORE':
      return 'android'
    default:
      return null
  }
}

// Resolve a store IAP product id → our billing_products.id. DB-FIRST (billing_product_skus,
// mig 151 — the single source of truth) via resolve_store_product, then the
// REVENUECAT_PRODUCT_MAP env map as a backward-compatible fallback. Returns '' when neither
// knows the product (caller 400s / acks). Once SKUs are seeded no env secret is needed.
async function resolveOurProduct(
  // deno-lint-ignore no-explicit-any -- the injected service-role client (createClient's
  // inferred generics don't match ReturnType<typeof createClient>; runtime shape is fine).
  sb: any,
  store: unknown,
  storeProductId: string,
): Promise<string> {
  if (!storeProductId) return ''
  try {
    const { data, error } = await sb.rpc('resolve_store_product', {
      p_platform: platformFromStore(store),
      p_store_product_id: storeProductId,
    })
    if (error) {
      console.error('[revenuecat-webhook] resolve_store_product failed — using env map:', error.message)
    } else if (typeof data === 'string' && data) {
      return data
    }
  } catch (e) {
    console.error('[revenuecat-webhook] resolve_store_product threw — using env map:', (e as Error)?.message)
  }
  return parseProductMap()[storeProductId] ?? ''
}

interface RCEvent {
  type?: string
  id?: string
  app_user_id?: string
  product_id?: string
  original_transaction_id?: string
  transaction_id?: string
  expiration_at_ms?: number
  /**
   * Reason for a CANCELLATION. `cancel_reason` is what RevenueCat actually sends
   * (see the refund note in the header); `cancellation_reason` is kept only as a
   * legacy alias so an older delivery is still understood.
   */
  cancel_reason?: string
  cancellation_reason?: string
  /** USD price. NEGATIVE on a refund, 0 on a free trial, null/absent if unknown. */
  price?: number
  /** 'SANDBOX' | 'PRODUCTION' — see the environment note in the header. */
  environment?: string
  [k: string]: unknown
}

const PROVIDER = 'revenuecat'

// Ack 200 WITHOUT writing when a subscription event lacks original_transaction_id. We
// refuse to key a subscription write on the SHARED store product id (it could match/revoke
// OTHER users' rows), but we still 200 so RevenueCat stops retrying an event we cannot
// safely apply.
function ackNoSubKey(type: string): Response {
  console.warn(
    '[revenuecat-webhook]', type,
    'missing original_transaction_id — acking without writing (won\'t use shared product id)',
  )
  return json({ received: true, type, ignored: 'missing_subscription_id' }, 200)
}

// RPC error → HTTP status. A bad/unknown reference (product/id) is a provider-payload
// problem → 400 (RC stops retrying). Anything else → 500 so RC retries (all RPCs are
// idempotent, so a retry is safe).
function rpcErrorResponse(tag: string, msg: string): Response {
  const badRef = /invalid_parameter_value|Unknown (product|payment)|not a subscription/i.test(msg)
  console.error(`[revenuecat-webhook] ${tag}:`, msg)
  return badRef
    ? json({ error: 'Unknown or invalid reference', code: 'BAD_REQUEST' }, 400)
    : json({ error: 'Grant failed', code: 'GRANT_ERROR' }, 500)
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  // FAIL-CLOSED: no configured shared token → never grant.
  const token = ENV('REVENUECAT_WEBHOOK_AUTH')
  if (!token) {
    console.error('[revenuecat-webhook] REVENUECAT_WEBHOOK_AUTH unset — refusing to grant')
    return json({ error: 'Webhook not configured', code: 'NOT_CONFIGURED' }, 503)
  }
  if (!verifyAuth(req.headers.get('authorization'), token)) {
    console.error('[revenuecat-webhook] invalid Authorization token')
    return json({ error: 'Invalid authorization', code: 'BAD_AUTH' }, 401)
  }

  let payload: { event?: RCEvent } | null
  try { payload = JSON.parse(await req.text()) } catch { payload = null }
  const event = payload?.event
  if (!event || typeof event.type !== 'string') {
    return json({ error: 'Invalid body', code: 'BAD_REQUEST' }, 400)
  }

  const type = event.type
  const appUserId = typeof event.app_user_id === 'string' ? event.app_user_id : ''
  const storeProductId = typeof event.product_id === 'string' ? event.product_id : ''
  // Stable subscription key across the lifecycle: the store's original_transaction_id
  // (constant across renewals). It is REQUIRED for any subscription write — it is the only
  // PER-USER-SAFE key. We must NOT fall back to the store product_id: that id is SHARED by
  // every buyer of the plan, so keying a write on it could match/sync/revoke OTHER users'
  // subscription rows. Absent → we ack 200 without writing (see ackNoSubKey guards below).
  const subKey =
    typeof event.original_transaction_id === 'string' ? event.original_transaction_id : ''
  // Stable store TRANSACTION key for CONSUMABLE credit-pack grants + their refunds (mig
  // 134): a consumable has no subscription row, so its refund is matched by this key, not
  // by a sub id. Prefer original_transaction_id, fall back to transaction_id.
  const txnKey =
    subKey || (typeof event.transaction_id === 'string' ? event.transaction_id : '')
  const periodEnd = msToIso(event.expiration_at_ms)

  const sb = createClient(ENV('SUPABASE_URL')!, ENV('SUPABASE_SERVICE_ROLE_KEY')!)

  // WHICH STORE this event came from ('ios' | 'android' | null). RevenueCat fronts
  // BOTH stores under the single provider 'revenuecat', so without this every mobile
  // row is indistinguishable — and the two stores are NOT interchangeable for refunds
  // (Play has a developer refund API, Apple does not). It cannot be recovered later
  // from the product either: mig 151 maps the credit packs to the SAME store id on
  // both platforms. So record it here, the one place that knows (mig 156).
  const platform = platformFromStore(event.store)

  // WHICH ENVIRONMENT this event came from. A sandbox purchase is FREE and made
  // from a tester account, but it used to flow through the exact same grant path as
  // a real one — real micro-USD credited to a real account, indistinguishable
  // afterwards, and counted in MRR. mig 159 makes it a recorded property, gates it
  // behind a default-off kill switch, and keeps it out of every business metric.
  // Anything not explicitly SANDBOX is treated as production (fail toward recording
  // money as real, never toward silently discarding it).
  const environment = String(event.environment ?? '').toUpperCase() === 'SANDBOX'
    ? 'sandbox'
    : 'production'

  // IS THIS EVENT A REFUND? RevenueCat delivers store refunds as CANCELLATION with
  // cancel_reason=CUSTOMER_SUPPORT and a negative price — there is no REFUND event
  // type (see the refund note in the header; reading the non-existent
  // `cancellation_reason` key is what made every refund a no-op).
  //
  // Two independent signals, either is sufficient:
  //   * cancel_reason CUSTOMER_SUPPORT — RevenueCat's definition of "was refunded";
  //   * price < 0 — the store returned money, whatever the reason string says.
  // `cancel_reason` is documented as "Sometimes" present, so relying on it alone
  // would put money correctness on an optional key.
  const cancelReason = String(event.cancel_reason ?? event.cancellation_reason ?? '').toUpperCase()
  const priceIsNegative = typeof event.price === 'number' && Number.isFinite(event.price) && event.price < 0
  const isRefundCancellation = cancelReason === 'CUSTOMER_SUPPORT' || priceIsNegative

  // Attribute a row to its store AND environment. Best-effort and non-fatal: the
  // grant itself already succeeded, and a missing platform degrades to
  // 'mobile_unknown', which the admin UI treats as the SAFE case (revoke-only, no
  // money API claimed).
  const tagSubscriptionPlatform = async (): Promise<void> => {
    if (!subKey || (!platform && environment === 'production')) return
    const { error } = await sb.rpc('set_subscription_platform', {
      p_provider: PROVIDER, p_provider_subscription_id: subKey,
      p_platform: platform, p_environment: environment,
    })
    if (error) console.error('[revenuecat-webhook] set_subscription_platform failed:', error.message)
  }

  const tagCreditGrantPlatform = async (ref: string): Promise<void> => {
    if (!ref) return
    const { error } = await sb.rpc('set_credit_grant_platform', {
      p_ref: ref, p_platform: platform, p_environment: environment,
    })
    if (error) console.error('[revenuecat-webhook] set_credit_grant_platform failed:', error.message)
  }

  // Sandbox grants are OFF by default (mig 159). Enabling the RevenueCat sandbox
  // webhook — which you must do to test IAP at all — therefore cannot mint credits
  // on its own; an admin opens the switch for a test run and closes it after.
  //
  // FAIL CLOSED on a failed lookup: if we cannot confirm sandbox grants are allowed,
  // we do not grant. A 500 makes RevenueCat retry, which is safe because every grant
  // is idempotent on its ref.
  const sandboxGrantBlocked = async (): Promise<Response | null> => {
    if (environment !== 'sandbox') return null
    const { data, error } = await sb.rpc('sandbox_grants_enabled')
    if (error) {
      console.error('[revenuecat-webhook] sandbox_grants_enabled failed — refusing to grant:', error.message)
      return json({ error: 'Sandbox check failed', code: 'GRANT_ERROR' }, 500)
    }
    if (data === true) return null
    console.warn('[revenuecat-webhook]', type, 'SANDBOX event ignored — sandbox grants are disabled')
    return json({ received: true, type, environment, ignored: 'sandbox_grants_disabled' }, 200)
  }

  // ── LIFECYCLE (UPDATE-only, matched by provider + subKey; no product/user needed) ──
  const syncStatus = async (status: string, cancelAtPeriodEnd: boolean | null) => {
    if (!subKey) return ackNoSubKey(type)
    const { data, error } = await sb.rpc('sync_subscription', {
      p_provider: PROVIDER,
      p_provider_subscription_id: subKey,
      p_status: status,
      p_period_end: periodEnd,
      p_cancel_at_period_end: cancelAtPeriodEnd,
    })
    if (error) return rpcErrorResponse(`sync_subscription ${type}`, error.message)
    // Every lifecycle event carries the store too, so this doubles as a BACKFILL for
    // rows granted before mig 156 existed: the first renewal/cancel/expire to arrive
    // stamps the platform on a row that had none.
    await tagSubscriptionPlatform()
    // {ok:false, reason:'not_found'} is NOT an error — ack 200, do not create.
    return json({ received: true, type, ...(data ?? {}) }, 200)
  }

  const revoke = async () => {
    if (!subKey) return ackNoSubKey(type)
    const { data, error } = await sb.rpc('revoke_subscription', {
      p_provider: PROVIDER,
      p_provider_subscription_id: subKey,
    })
    if (error) return rpcErrorResponse(`revoke_subscription ${type}`, error.message)
    return json({ received: true, type, ...(data ?? {}) }, 200)
  }

  // ── GRANT / RENEW (needs the buyer + product; disambiguate credit_pack vs sub) ──
  const grant = async () => {
    // Gate FIRST — before resolving products or touching the wallet — so a blocked
    // sandbox event costs one cheap flag read and changes nothing.
    const blocked = await sandboxGrantBlocked()
    if (blocked) return blocked

    // app_user_id must be OUR supabase uid (set via Purchases.logIn). A RevenueCat
    // anonymous id ($RCAnonymousID:…) can't be attributed → ack 200, don't retry.
    if (!UUID_RE.test(appUserId)) {
      console.warn('[revenuecat-webhook]', type, 'non-uuid app_user_id, ignoring:', appUserId)
      return json({ received: true, type, ignored: 'anonymous_or_invalid_user' }, 200)
    }
    const ourProductId = await resolveOurProduct(sb, event.store, storeProductId)
    if (!ourProductId) {
      console.error('[revenuecat-webhook]', type, 'unmapped product:', storeProductId)
      return json({ error: 'Unmapped product', code: 'BAD_REQUEST' }, 400)
    }
    // Server catalog decides kind + credit amount — never the webhook body.
    //
    // 여기에 `.eq('is_active', true)` 를 붙이고 싶어질 텐데, 붙이면 안 된다.
    // is_active=false 는 "새로 팔지 않는다" 이지 "쓰던 사람 끊는다" 가 아니다. 필터를
    // 걸면 판매 중지한 플랜의 기존 구독자가 갱신될 때 400 이 나가고, 스토어는 갱신 대금을
    // 받아 간 채로 우리는 지급을 끊는다. 새 판매를 막는 일은 스토어(상품 비활성)와
    // get_billing_products(카탈로그에서 제외)가 이미 하고 있다.
    // 이 경계는 retired_plan_still_renews_test.sql 이 지킨다.
    const { data: prod, error: prodErr } = await sb
      .from('billing_products')
      // `select('*')`, not the column by name, so this survives mig 217's rename in BOTH
      // directions. PostgREST errors on a column that does not exist, so naming either
      // spelling would break every credit-pack purchase in the window between the migration
      // landing and this function being redeployed — and no ordering of the two avoids it.
      .select('*')
      .eq('id', ourProductId)
      .maybeSingle()
    if (prodErr) {
      console.error('[revenuecat-webhook] product lookup failed (', ourProductId, '):', prodErr.message)
      return json({ error: 'Grant failed', code: 'GRANT_ERROR' }, 500)
    }
    if (!prod) return json({ error: 'Unknown product', code: 'BAD_REQUEST' }, 400)

    // CONSUMABLE credit pack → top up the wallet (micro-USD) (idempotent on RC event id).
    if (prod.kind === 'credit_pack') {
      const microUsd = Number(prod.credits_micro_usd ?? prod.credits_micro_won)
      if (!Number.isFinite(microUsd) || microUsd <= 0) {
        return json({ error: 'Invalid product', code: 'BAD_REQUEST' }, 400)
      }
      // Idempotency key: anchor on the store TRANSACTION key (mig 134) so a later REFUND
      // can reverse THIS exact grant (clawback_ai_credits_by_ref keys on the same ref).
      // Only when no transaction key exists do we fall back to the RC event id — that grant
      // is then NOT refund-matchable (logged). 'rc:'/'rcev:' namespace the two ref shapes.
      // If neither exists we refuse rather than grant with no dedupe key (retry would double-credit).
      const creditRef = txnKey ? 'rc:' + txnKey : (event.id ? 'rcev:' + event.id : '')
      if (!creditRef) {
        console.error('[revenuecat-webhook]', type, 'credit_pack missing idempotency ref — refusing')
        return json({ error: 'Missing idempotency ref', code: 'BAD_REQUEST' }, 400)
      }
      if (!txnKey) {
        console.warn('[revenuecat-webhook]', type, 'credit_pack granted on event-id ref (no transaction key) — a refund cannot be auto-clawed for', creditRef)
      }
      // Refund-before-grant guard (mig 134): if a REFUND already arrived and tombstoned this
      // ref, do NOT grant — the purchase was refunded before we processed the grant. Keeps
      // money conserved regardless of RevenueCat's delivery order.
      //
      // Goes through credit_grant_is_refunded (mig 158), NOT a direct table read:
      // ai_credit_ledger is RPC-only (mig 109 — RLS on, no table grants), so the
      // previous `.from('ai_credit_ledger')` query answered 42501 permission denied
      // on EVERY call. Its error was discarded, so the guard silently never fired and
      // late grants credited refunded purchases.
      //
      // And FAIL CLOSED if the check itself errors: 500 makes RevenueCat retry, which
      // is safe (the grant is idempotent on creditRef). Granting on a failed refund
      // check is how the money leaked in the first place.
      const { data: tomb, error: tombErr } = await sb.rpc('credit_grant_is_refunded', {
        p_ref: creditRef,
      })
      if (tombErr) {
        console.error('[revenuecat-webhook] credit_grant_is_refunded failed — refusing to grant:', tombErr.message)
        return json({ error: 'Refund check failed', code: 'GRANT_ERROR' }, 500)
      }
      if (tomb) {
        console.warn('[revenuecat-webhook]', type, 'credit_pack already refunded before grant — skipping:', creditRef)
        return json({ received: true, type, kind: 'credit_pack', ignored: 'already_refunded' }, 200)
      }
      const { data, error } = await sb.rpc('add_ai_credits', {
        p_user_id: appUserId,
        p_micro_won: microUsd,
        p_reason: 'purchase',
        p_ref: creditRef,
      })
      if (error) return rpcErrorResponse(`add_ai_credits ${type}`, error.message)
      // An IAP consumable opens NO payment_intents row — the ledger grant IS the
      // payment record, so the store has to be stamped on the ledger or the admin
      // payment list cannot show which store sold it (mig 156).
      await tagCreditGrantPlatform(creditRef)
      return json({ received: true, type, kind: 'credit_pack', balance_micro_usd: data ?? null, platform, environment }, 200)
    }

    // SUBSCRIPTION product → UPSERT the sub as active for this user/product, keyed by the
    // per-user original_transaction_id. Without it we refuse to write (never key on the
    // shared store product id) and ack so RevenueCat stops retrying.
    if (!subKey) return ackNoSubKey(type)
    const { data, error } = await sb.rpc('sync_subscription_by_user', {
      p_user: appUserId,
      p_product_id: ourProductId,
      p_provider: PROVIDER,
      p_provider_subscription_id: subKey,
      p_status: 'active',
      p_period_end: periodEnd,
      p_cancel_at_period_end: false,
    })
    if (error) return rpcErrorResponse(`sync_subscription_by_user ${type}`, error.message)
    await tagSubscriptionPlatform()
    return json({ received: true, type, kind: 'subscription', platform, environment, ...(data ?? {}) }, 200)
  }

  // ── REFUND — subscription (revoke) OR consumable credit pack (clawback) ─────────────
  // Reached from CANCELLATION when the event says the store returned money (see
  // isRefundCancellation), and from the legacy REFUND / CHARGEBACK types.
  // A refund can hit a subscription (drop the raised card cap now) OR a one-time consumable
  // credit pack (reverse the granted micro-WON). Disambiguate by the mapped product's kind:
  //   credit_pack → clawback_ai_credits_by_ref('rc:'+txnKey) (mig 134, idempotent)
  //   subscription / unknown → revoke_subscription (unchanged; sub is the common case)
  // The consumable clawback is keyed on the SAME store transaction key the grant used, so a
  // grant that fell back to an event-id ref (no txnKey) cannot be auto-clawed — see the grant
  // warning above. (Mobile IAP is dormant; this MUST be sandbox-verified at IAP launch.)
  // Resolve the mapped product's kind: 'credit_pack' | 'subscription' | null when the
  // store product is unknown to us. Returns a Response on a LOOKUP FAILURE so the caller
  // can 500 and let RevenueCat retry — guessing the kind would either claw back the wrong
  // thing or claw back nothing. Every downstream write is idempotent, so a retry is safe.
  const productKind = async (tag: string): Promise<string | null | Response> => {
    const ourProductId = storeProductId ? await resolveOurProduct(sb, event.store, storeProductId) : ''
    if (!ourProductId) return null
    const { data: prod, error } = await sb
      .from('billing_products').select('kind').eq('id', ourProductId).maybeSingle()
    if (error) {
      console.error(`[revenuecat-webhook] ${tag} product lookup failed (`, ourProductId, '):', error.message)
      return json({ error: 'Refund handling failed', code: 'REFUND_ERROR' }, 500) // RC retries
    }
    return prod?.kind ?? null
  }

  const refundOrClawback = async () => {
    const kind = await productKind('refund')
    if (kind instanceof Response) return kind
    if (kind === 'credit_pack') {
      if (!txnKey) {
        console.warn('[revenuecat-webhook]', type, 'credit_pack refund with no transaction key — cannot match grant; acking')
        return json({ received: true, type, ignored: 'no_txn_key' }, 200)
      }
      const { data, error } = await sb.rpc('clawback_ai_credits_by_ref', {
        p_user_id: UUID_RE.test(appUserId) ? appUserId : null,
        p_ref: 'rc:' + txnKey,
      })
      if (error) return rpcErrorResponse(`clawback_ai_credits_by_ref ${type}`, error.message)
      return json({ received: true, type, kind: 'credit_pack', ...(typeof data === 'object' && data ? data : {}) }, 200)
    }
    // Subscription (or unknown product) → revoke by the per-user subscription key.
    return await revoke()
  }

  // ── REFUND_REVERSED — the store undid a refund, so the money is ours again ──────────
  // App Store only. Without this the customer has paid and holds nothing: the clawback
  // (or the refund-before-grant tombstone) stands forever and no code path can undo it.
  //   credit_pack → reverse_credit_clawback (mig 173): restores EXACTLY what was clawed
  //                 back, idempotent on 'reversal:<ref>', and lifts the tombstone so a
  //                 late grant redelivery is no longer refused.
  //   subscription → re-assert ACTIVE through the normal grant path (idempotent upsert).
  const reverseRefund = async () => {
    const kind = await productKind('refund reversal')
    if (kind instanceof Response) return kind
    if (kind === 'credit_pack') {
      if (!txnKey) {
        console.warn('[revenuecat-webhook]', type, 'credit_pack refund reversal with no transaction key — cannot match grant; acking')
        return json({ received: true, type, ignored: 'no_txn_key' }, 200)
      }
      const { data, error } = await sb.rpc('reverse_credit_clawback', {
        p_user_id: UUID_RE.test(appUserId) ? appUserId : null,
        p_ref: 'rc:' + txnKey,
      })
      if (error) return rpcErrorResponse(`reverse_credit_clawback ${type}`, error.message)
      return json({ received: true, type, kind: 'credit_pack', ...(typeof data === 'object' && data ? data : {}) }, 200)
    }
    // Subscription (or unknown product) → the grant path re-upserts it as active.
    return await grant()
  }

  switch (type) {
    // First grant, renewal, un-cancel, and plan change all re-assert an ACTIVE sub for
    // the buyer+product (sync_subscription_by_user upserts, so it works with or without
    // an existing row). A consumable credit pack is handled inside grant().
    case 'INITIAL_PURCHASE':
    case 'NON_RENEWING_PURCHASE':
    case 'RENEWAL':
    case 'UNCANCELLATION':
    case 'PRODUCT_CHANGE':
    // The store pushed the current period's expiry back (App Store / Play server API,
    // or a Play renewal deferred by <24h). Same re-assert-active write as a renewal;
    // without it the raised card cap expires while the customer still has the period.
    case 'SUBSCRIPTION_EXTENDED':
      return await grant()

    // Auto-renew turned off: keep access until the period end. BUT a refund arrives as
    // this same event type (cancel_reason=CUSTOMER_SUPPORT and/or a negative price), and
    // then access must drop now and a consumable credit pack must be clawed back — see
    // the refund note in the header for the key-name bug this replaces.
    case 'CANCELLATION':
      return isRefundCancellation
        ? await refundOrClawback()
        : await syncStatus('canceled', true)

    // Not current RevenueCat event types (a refund comes through CANCELLATION), kept so
    // an older delivery or a replayed archive is still handled correctly.
    case 'REFUND':
    case 'CHARGEBACK':
      return await refundOrClawback()

    case 'REFUND_REVERSED':
      return await reverseRefund()

    case 'EXPIRATION':
      return await syncStatus('expired', null)

    case 'BILLING_ISSUE':
      return await syncStatus('past_due', null)

    case 'SUBSCRIPTION_PAUSED':
      return await syncStatus('paused', null)

    // TRANSFER: entitlements moved between app_user_ids. The raised card cap must FOLLOW the
    // user, else it strands on the old id (P-L2). RC sends transferred_from / transferred_to
    // (arrays of app_user_ids), NOT a sub id — so move by user. Only our-uuid ids are actionable.
    case 'TRANSFER': {
      const firstUuid = (v: unknown): string | null => {
        const arr = Array.isArray(v) ? v : []
        for (const x of arr) if (typeof x === 'string' && UUID_RE.test(x)) return x
        return null
      }
      const fromUser = firstUuid(event.transferred_from)
      const toUser = firstUuid(event.transferred_to)
      if (!fromUser || !toUser) {
        console.warn('[revenuecat-webhook] TRANSFER with no resolvable our-uuid from/to — acking', event.transferred_from, event.transferred_to)
        return json({ received: true, type, ignored: 'no_uuid_endpoints' }, 200)
      }
      const { data, error } = await sb.rpc('transfer_subscriptions_by_user', {
        p_provider: PROVIDER,
        p_from_user: fromUser,
        p_to_user: toUser,
      })
      if (error) return rpcErrorResponse(`transfer_subscriptions_by_user ${type}`, error.message)
      return json({ received: true, type, ...(typeof data === 'object' && data ? data : {}) }, 200)
    }

    // SUBSCRIBER_ALIAS, TEST, etc. — nothing to grant. Ack so RC stops retrying.
    default:
      return json({ received: true, type }, 200)
  }
})
