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
// EVENT → RPC (event.type):
//   INITIAL_PURCHASE / NON_RENEWING_PURCHASE (subscription product)
//                                → sync_subscription_by_user(active,  expiry, cancel=false)
//   NON_RENEWING_PURCHASE (credit_pack product)
//                                → add_ai_credits(credits_micro_won, 'purchase', event.id)
//   RENEWAL / UNCANCELLATION / PRODUCT_CHANGE
//                                → sync_subscription_by_user(active,  new expiry, cancel=false)
//   CANCELLATION (auto-renew off)→ sync_subscription('canceled', expiry, cancel=true)
//   CANCELLATION (CUSTOMER_SUPPORT refund) / REFUND / CHARGEBACK
//                                → revoke_subscription → status='refunded' (drop access now)
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
//       Environment             Production (add a second for Sandbox if desired)
//     Save; RevenueCat sends every subscriber event to this URL with that header.
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

function parseProductMap(): Record<string, string> {
  const raw = ENV('REVENUECAT_PRODUCT_MAP')
  if (!raw) return {}
  try {
    const obj = JSON.parse(raw)
    if (obj && typeof obj === 'object') return obj as Record<string, string>
  } catch { /* invalid JSON — treated as empty, unmapped products 400 below */ }
  return {}
}

interface RCEvent {
  type?: string
  id?: string
  app_user_id?: string
  product_id?: string
  original_transaction_id?: string
  expiration_at_ms?: number
  cancellation_reason?: string
  [k: string]: unknown
}

const PROVIDER = 'revenuecat'

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
  // Stable subscription key across the lifecycle: prefer original_transaction_id
  // (constant across renewals), fall back to the store product id.
  const subKey =
    (typeof event.original_transaction_id === 'string' && event.original_transaction_id) ||
    storeProductId
  const periodEnd = msToIso(event.expiration_at_ms)

  const sb = createClient(ENV('SUPABASE_URL')!, ENV('SUPABASE_SERVICE_ROLE_KEY')!)

  // ── LIFECYCLE (UPDATE-only, matched by provider + subKey; no product/user needed) ──
  const syncStatus = async (status: string, cancelAtPeriodEnd: boolean | null) => {
    if (!subKey) return json({ error: 'Missing subscription id', code: 'BAD_REQUEST' }, 400)
    const { data, error } = await sb.rpc('sync_subscription', {
      p_provider: PROVIDER,
      p_provider_subscription_id: subKey,
      p_status: status,
      p_period_end: periodEnd,
      p_cancel_at_period_end: cancelAtPeriodEnd,
    })
    if (error) return rpcErrorResponse(`sync_subscription ${type}`, error.message)
    // {ok:false, reason:'not_found'} is NOT an error — ack 200, do not create.
    return json({ received: true, type, ...(data ?? {}) }, 200)
  }

  const revoke = async () => {
    if (!subKey) return json({ error: 'Missing subscription id', code: 'BAD_REQUEST' }, 400)
    const { data, error } = await sb.rpc('revoke_subscription', {
      p_provider: PROVIDER,
      p_provider_subscription_id: subKey,
    })
    if (error) return rpcErrorResponse(`revoke_subscription ${type}`, error.message)
    return json({ received: true, type, ...(data ?? {}) }, 200)
  }

  // ── GRANT / RENEW (needs the buyer + product; disambiguate credit_pack vs sub) ──
  const grant = async () => {
    // app_user_id must be OUR supabase uid (set via Purchases.logIn). A RevenueCat
    // anonymous id ($RCAnonymousID:…) can't be attributed → ack 200, don't retry.
    if (!UUID_RE.test(appUserId)) {
      console.warn('[revenuecat-webhook]', type, 'non-uuid app_user_id, ignoring:', appUserId)
      return json({ received: true, type, ignored: 'anonymous_or_invalid_user' }, 200)
    }
    const ourProductId = parseProductMap()[storeProductId]
    if (!ourProductId) {
      console.error('[revenuecat-webhook]', type, 'unmapped product:', storeProductId)
      return json({ error: 'Unmapped product', code: 'BAD_REQUEST' }, 400)
    }
    // Server catalog decides kind + credit amount — never the webhook body.
    const { data: prod, error: prodErr } = await sb
      .from('billing_products')
      .select('kind, credits_micro_won')
      .eq('id', ourProductId)
      .maybeSingle()
    if (prodErr) {
      console.error('[revenuecat-webhook] product lookup failed (', ourProductId, '):', prodErr.message)
      return json({ error: 'Grant failed', code: 'GRANT_ERROR' }, 500)
    }
    if (!prod) return json({ error: 'Unknown product', code: 'BAD_REQUEST' }, 400)

    // CONSUMABLE credit pack → top up the micro-WON wallet (idempotent on RC event id).
    if (prod.kind === 'credit_pack') {
      const microWon = Number(prod.credits_micro_won)
      if (!Number.isFinite(microWon) || microWon <= 0) {
        return json({ error: 'Invalid product', code: 'BAD_REQUEST' }, 400)
      }
      const { data, error } = await sb.rpc('add_ai_credits', {
        p_user_id: appUserId,
        p_micro_won: microWon,
        p_reason: 'purchase',
        p_ref: event.id ?? subKey,
      })
      if (error) return rpcErrorResponse(`add_ai_credits ${type}`, error.message)
      return json({ received: true, type, kind: 'credit_pack', balance_micro_won: data ?? null }, 200)
    }

    // SUBSCRIPTION product → UPSERT the sub as active for this user/product.
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
    return json({ received: true, type, kind: 'subscription', ...(data ?? {}) }, 200)
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
      return await grant()

    // Auto-renew turned off: keep access until the period end, but a refund via support
    // (or an explicit REFUND/CHARGEBACK) drops access immediately.
    case 'CANCELLATION':
      return event.cancellation_reason === 'CUSTOMER_SUPPORT'
        ? await revoke()
        : await syncStatus('canceled', true)

    case 'REFUND':
    case 'CHARGEBACK':
      return await revoke()

    case 'EXPIRATION':
      return await syncStatus('expired', null)

    case 'BILLING_ISSUE':
      return await syncStatus('past_due', null)

    case 'SUBSCRIPTION_PAUSED':
      return await syncStatus('paused', null)

    // TRANSFER, SUBSCRIBER_ALIAS, TEST, etc. — nothing to grant. Ack so RC stops retrying.
    default:
      return json({ received: true, type }, 200)
  }
})
