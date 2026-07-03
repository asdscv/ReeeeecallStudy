// Lemon Squeezy webhook — reconciles a SERVER-AUTHORITATIVE payment intent (mig 120)
// and drives the FULL subscription LIFECYCLE (mig 121).
//
// Lemon Squeezy is a Merchant of Record: the client only REDIRECTS to a hosted
// checkout (no server checkout-session call). When the buyer pays, Lemon Squeezy's
// server POSTs THIS signed webhook, which carries the merchant_uid we tagged onto
// the checkout as `checkout[custom][merchant_uid]` back in `meta.custom_data`.
//
// FIRST-GRANT FLOW (server never trusts a client-shaped money body):
//   1. client → create_payment_intent(product_id): the SERVER snapshots price + kind
//      from billing_products, opens a 'pending' payment_intents row for auth.uid(),
//      returns a fresh `merchant_uid`.
//   2. client → LemonsqueezyProvider redirects to the hosted checkout for the mapped
//      variant, passing checkout[custom][merchant_uid]=<merchant_uid>.
//   3. buyer pays; Lemon Squeezy (as Merchant of Record) charges + remits tax, then
//      its server POSTs this SIGNED webhook.
//   4a. order_created: look up the intent for merchant_uid. A SUBSCRIPTION purchase
//       ALSO fires order_created — if intent.kind='subscription' this is that duplicate
//       and we NO-OP (ack 200): subscription_created is the SOLE first-grant path for
//       subscriptions. (Routing a subscription order through confirm_payment here too
//       would create a base grant_subscription row that then COLLIDES with
//       subscription_created's (provider,provider_ref) unique index → a perpetual 500
//       retry loop + an unrevokable, sub-id-less active grant.) Only a credit_pack intent
//       proceeds → confirm_payment(merchant_uid,'lemonsqueezy',order_id): locks the
//       intent, marks it 'paid' (idempotently), grants from the SNAPSHOT —
//       add_ai_credits (mig 114, idempotent on merchant_uid).
//   4b. subscription_created          → activate_subscription_from_intent(merchant_uid,
//       'lemonsqueezy', <LS subscription id>, renews_at): reconciles the paid intent
//       into a lifecycle-trackable billing_subscriptions row that RECORDS the LS
//       subscription id, so every later lifecycle event can be matched back to it.
//   BEFORE either grant, the purchased LS variant id (first_order_item.variant_id /
//   first_subscription_item.variant_id) is mapped back to OUR product via the
//   LEMONSQUEEZY_VARIANT_MAP secret and asserted === the intent's product_id, so a
//   cheap-variant checkout can't claim an expensive plan via injected custom_data.
//   Because price + kind live on the server intent, the webhook body only names WHICH
//   order/subscription settled — it can neither pick a price nor self-grant.
//
// LIFECYCLE FLOW (existing row, matched by (provider, provider_subscription_id)):
//   Ongoing events carry the PROVIDER'S subscription id (not our merchant_uid), so they
//   route through sync_subscription (UPDATE-only) / revoke_subscription. No matching
//   row → the RPC returns {ok:false, reason:'not_found'} and we ACK 200 (never create).
//
//   ── HANDLED LS EVENTS (meta.event_name) → RPC ──────────────────────────────────
//   order_created (credit_pack)   → confirm_payment(3-arg)      (credit_pack intent only)
//   order_created (subscription)  → NO-OP ack 200               (subscription_created grants)
//   subscription_created          → activate_subscription_from_intent    (records sub id)
//   subscription_updated          → sync_subscription(map(status), renews_at, cancelled)
//   subscription_cancelled        → sync_subscription('canceled', ends_at, cancel=true)
//   subscription_resumed          → sync_subscription('active',  renews_at, cancel=false)
//   subscription_unpaused         → sync_subscription('active',  renews_at, cancel=false)
//   subscription_paused           → sync_subscription('paused',  renews_at, keep-cancel)
//   subscription_expired          → sync_subscription('expired', ends_at,   keep-cancel)
//   subscription_payment_failed   → sync_subscription('past_due', keep,     keep-cancel)  [invoice]
//   subscription_payment_success  → sync_subscription('active',  renews_at, cancel=false) [invoice]
//   subscription_payment_recovered→ sync_subscription('active',  renews_at, cancel=false) [invoice]
//   subscription_payment_refunded → revoke_subscription  → status='refunded'              [invoice]
//   order_refunded                → revoke_subscription if a sub id is present, else
//                                    log + ACK 200 (one-time credit clawback is a TODO)
//   anything else                 → ACK 200 {received:true}
//
//   NOTE on the subscription id LOCATION: the subscription lifecycle events above put
//   the LS subscription id in `data.id` (data.type='subscriptions'). The three PAYMENT
//   events (payment_failed/success/recovered/refunded) send a `subscription-invoices`
//   object whose `data.id` is the INVOICE id — the subscription id is at
//   `data.attributes.subscription_id`. This fn reads the right field per event.
//
// This function MINTS money, so it is FAIL-CLOSED and signature-gated by construction:
//   * requires LEMONSQUEEZY_WEBHOOK_SECRET — if unset → 503 (NEVER grants unconfigured).
//   * Lemon Squeezy signs each delivery with the `X-Signature` header = hex
//     HMAC-SHA256(rawBody, signing secret). We recompute it with Web Crypto and
//     compare constant-time; a mismatch → 401. (docs.lemonsqueezy.com → Webhooks →
//     "Signing requests".)
//   * Every RPC is idempotent (confirm_payment/add_ai_credits on merchant_uid;
//     activate/sync serialize per-user on advisory lock 77 and UPSERT/UPDATE in place),
//     so LS retries never double-apply. A thrown RPC error → 500 so LS retries.
//
// ── OWNER GO-LIVE SETUP ──
//   env secret: LEMONSQUEEZY_WEBHOOK_SECRET  (the webhook's signing secret)
//   env secret: LEMONSQUEEZY_VARIANT_MAP     (JSON {"<LS variant id>":"<our product id>"} —
//               the server-side INVERSE of the client's VITE_LEMONSQUEEZY_VARIANTS
//               {product_id→variant_id}). Used to assert the purchased LS variant maps to
//               the intent's product BEFORE granting. If UNSET, the assertion is SKIPPED
//               with a logged warning (the intent is still server-authoritative on price +
//               product); if SET-but-malformed we FAIL CLOSED (never grant). SET it to
//               close the injected-custom_data plan-swap hole. Example (variant→product,
//               the inverse of the VITE map): {"111":"credits_1000","444":"sub_pro_monthly"}.
//   In the Lemon Squeezy dashboard: Settings → Webhooks → add a webhook with
//     URL    https://<project-ref>.functions.supabase.co/lemonsqueezy-webhook
//     Events order_created, order_refunded, subscription_created, subscription_updated,
//            subscription_cancelled, subscription_resumed, subscription_paused,
//            subscription_expired, subscription_payment_success,
//            subscription_payment_failed, subscription_payment_refunded
//   then copy the generated SIGNING SECRET into LEMONSQUEEZY_WEBHOOK_SECRET.
//
// Deploy: config.toml sets verify_jwt = false (Lemon Squeezy, not a user JWT, calls
// this); the HMAC signature is the auth. No `[functions.lemonsqueezy-webhook]` JWT
// is expected. Until LEMONSQUEEZY_WEBHOOK_SECRET is set → 503 (safe default).

import { createClient } from '@supabase/supabase-js'

const ENV = (k: string) => Deno.env.get(k)

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

async function hmacHex(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body))
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, '0')).join('')
}

// constant-time string compare (avoid signature timing oracles)
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let r = 0
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return r === 0
}

// Lemon Squeezy: X-Signature = hex HMAC-SHA256 over the RAW request body, keyed
// with the webhook signing secret.
async function verifySignature(rawBody: string, header: string | null, secret: string): Promise<boolean> {
  if (!header) return false
  const expected = await hmacHex(secret, rawBody)
  return timingSafeEqual(header.trim().toLowerCase(), expected)
}

interface LemonSqueezyPayload {
  meta?: {
    event_name?: string
    custom_data?: Record<string, unknown>
  }
  data?: {
    id?: string | number
    type?: string
    attributes?: Record<string, unknown>
  }
}

// ── LS subscription status → our billing_subscriptions.status domain ──────────────
// LS statuses: on_trial | active | paused | past_due | unpaid | cancelled | expired.
// 'cancelled' keeps access until ends_at → we store 'canceled' (paid-through). unpaid
// is dunning → 'past_due'. Unknown → null (caller ACKs 200 without touching the row).
function mapLsStatus(s: unknown): string | null {
  switch (s) {
    case 'on_trial':
    case 'active':
      return 'active'
    case 'past_due':
    case 'unpaid':
      return 'past_due'
    case 'paused':
      return 'paused'
    case 'cancelled':
      return 'canceled'
    case 'expired':
      return 'expired'
    default:
      return null
  }
}

type RpcResult = { data: unknown; error: { message: string } | null }

// Grant path (order_created / subscription_created): a bad/unknown merchant_uid is a
// provider-payload error → 400; anything else → 500 so LS retries (RPCs idempotent).
function grantResult(res: RpcResult, ref: string): Response {
  if (res.error) {
    const badRef = /invalid_parameter_value|Unknown payment intent|not a subscription/i.test(res.error.message)
    console.error('[lemonsqueezy-webhook] grant failed (', ref, '):', res.error.message)
    return badRef
      ? json({ error: 'Unknown or invalid intent', code: 'BAD_REQUEST' }, 400)
      : json({ error: 'Grant failed', code: 'GRANT_ERROR' }, 500)
  }
  return json({ ok: true, ...(typeof res.data === 'object' && res.data ? res.data : {}) }, 200)
}

// Lifecycle path (sync_subscription / revoke_subscription): the RPC returns
// {ok:false, reason:'not_found'} for an UNMATCHED subscription — a benign no-op we ACK
// 200 (do NOT create). A thrown RPC error → 500 so LS retries (UPDATE-only/idempotent).
function lifecycleResult(res: RpcResult, event: string): Response {
  if (res.error) {
    console.error('[lemonsqueezy-webhook]', event, 'RPC error:', res.error.message)
    return json({ error: 'Lifecycle sync failed', code: 'SYNC_ERROR' }, 500)
  }
  return json({ received: true, event, ...(typeof res.data === 'object' && res.data ? res.data : {}) }, 200)
}

function badMissing(field: string, event: string): Response {
  console.error(`[lemonsqueezy-webhook] missing ${field} on ${event}`)
  return json({ error: `Missing ${field}`, code: 'BAD_REQUEST' }, 400)
}

// ── variant↔product verification (AUDIT FIX #2) ───────────────────────────────────
// A Lemon Squeezy checkout price lives on the LS VARIANT, not on our intent. The intent is
// already server-authoritative on price + product (snapshotted by create_payment_intent,
// grants key off it), BUT the merchant_uid→product binding rides in checkout custom data
// the buyer's browser passes; a tampered checkout could pay for a CHEAP variant while
// pointing custom_data at an EXPENSIVE product's intent. To close that, we re-derive WHICH
// product the buyer actually bought from the SIGNED payload's variant id and assert it
// equals the intent's product_id. LEMONSQUEEZY_VARIANT_MAP holds the variant_id→product_id
// map (the inverse of the client's VITE_LEMONSQUEEZY_VARIANTS product_id→variant_id).
type VariantMapState =
  | { kind: 'unset' }             // secret not configured → assertion SKIPPED (logged warn)
  | { kind: 'invalid' }           // configured but unparseable → FAIL CLOSED (never grant)
  | { kind: 'map'; map: Record<string, string> }

function loadVariantMap(): VariantMapState {
  const raw = ENV('LEMONSQUEEZY_VARIANT_MAP')
  if (!raw) return { kind: 'unset' }
  try {
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const map: Record<string, string> = {}
      for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
        if (v != null && v !== '') map[String(k)] = String(v)
      }
      return { kind: 'map', map }
    }
  } catch { /* fall through to invalid */ }
  return { kind: 'invalid' }
}

// The LS variant id the buyer actually purchased, per event shape:
//   order_created         → data.attributes.first_order_item.variant_id
//   subscription_created  → data.attributes.first_subscription_item.variant_id
function purchasedVariantId(event: string, attrs: Record<string, unknown>): string | null {
  const item = (event === 'subscription_created'
    ? attrs.first_subscription_item
    : attrs.first_order_item) as Record<string, unknown> | undefined
  const vid = item?.variant_id
  return vid == null || vid === '' ? null : String(vid)
}

// Returns null when the purchased variant is verified to match the intent's product (or
// when verification is deliberately SKIPPED because the map is UNSET), else a 400 Response
// that REFUSES the grant. SAFE DEFAULT: skip-on-unset (fail open) but fail CLOSED on a
// set-but-malformed map and on any concrete mismatch.
function verifyVariant(
  event: string,
  attrs: Record<string, unknown>,
  intentProductId: string,
  vm: VariantMapState,
): Response | null {
  if (vm.kind === 'unset') {
    // Documented fail-OPEN-only-on-UNSET (the safe default): with no map we can't re-derive
    // the product from the payload, but the intent is still server-authoritative on price +
    // product, so the base posture holds. Warn loudly so this isn't left unset in prod.
    console.warn('[lemonsqueezy-webhook] LEMONSQUEEZY_VARIANT_MAP unset — skipping variant/product assertion for', event, '(intent product:', intentProductId, ')')
    return null
  }
  if (vm.kind === 'invalid') {
    // Set but unparseable = operator INTENDED verification but mis-typed it → fail closed.
    console.error('[lemonsqueezy-webhook] LEMONSQUEEZY_VARIANT_MAP set but not a valid JSON object — refusing to grant', event)
    return json({ error: 'Variant map misconfigured', code: 'VARIANT_MAP_INVALID' }, 400)
  }
  const variantId = purchasedVariantId(event, attrs)
  const mapped = variantId ? vm.map[variantId] : undefined
  if (!mapped || mapped !== intentProductId) {
    console.error(
      `[lemonsqueezy-webhook] variant/product MISMATCH on ${event}: payload variant=${variantId ?? 'none'} → ${mapped ?? 'unmapped'}, intent product=${intentProductId} — refusing to grant`,
    )
    return json({ error: 'Variant does not match intent product', code: 'VARIANT_MISMATCH' }, 400)
  }
  return null
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  // FAIL-CLOSED: no configured secret → never grant.
  const secret = ENV('LEMONSQUEEZY_WEBHOOK_SECRET')
  if (!secret) {
    console.error('[lemonsqueezy-webhook] LEMONSQUEEZY_WEBHOOK_SECRET unset — refusing to grant')
    return json({ error: 'Payment webhook not configured', code: 'NOT_CONFIGURED' }, 503)
  }

  const rawBody = await req.text()
  const ok = await verifySignature(rawBody, req.headers.get('x-signature'), secret)
  if (!ok) {
    console.error('[lemonsqueezy-webhook] invalid signature')
    return json({ error: 'Invalid signature', code: 'BAD_SIGNATURE' }, 401)
  }

  let body: LemonSqueezyPayload | null
  try { body = JSON.parse(rawBody) as LemonSqueezyPayload } catch { body = null }
  if (!body) return json({ error: 'Invalid body', code: 'BAD_REQUEST' }, 400)

  const event = typeof body.meta?.event_name === 'string' ? body.meta.event_name : ''

  // ── defensive field extraction (all Lemon Squeezy payloads are data.attributes.*) ──
  const attrs = (body.data?.attributes ?? {}) as Record<string, unknown>
  const custom = body.meta?.custom_data
  const merchantUid = custom && typeof custom.merchant_uid === 'string' ? custom.merchant_uid : ''

  // Treat '' / null / undefined uniformly as "absent".
  const asStr = (v: unknown): string | null => (v == null || v === '' ? null : String(v))

  // For subscription LIFECYCLE events data.id IS the LS subscription id (type
  // 'subscriptions'). For the PAYMENT (invoice) events data.id is the invoice id and
  // the subscription id is data.attributes.subscription_id — read per-event below.
  const dataId = asStr(body.data?.id)
  const invoiceSubId = asStr(attrs.subscription_id)
  const renewsAt = asStr(attrs.renews_at)
  const endsAt = asStr(attrs.ends_at)
  const cancelled = attrs.cancelled === true

  const sb = createClient(ENV('SUPABASE_URL')!, ENV('SUPABASE_SERVICE_ROLE_KEY')!)

  // Server-side variant→product map (AUDIT FIX #2), parsed once per request.
  const variantMap = loadVariantMap()

  // Look up the server-authoritative intent (kind + product_id) for a merchant_uid.
  // Distinguishes a real DB error (retryable → 500) from an absent intent (bad payload
  // → 400). Reads via service_role, bypassing RLS.
  const lookupIntent = async (
    merchantUid: string,
  ): Promise<
    | { ok: true; intent: { kind: string; product_id: string } }
    | { ok: false; retryable: boolean }
  > => {
    const { data, error } = await sb
      .from('payment_intents')
      .select('kind, product_id')
      .eq('merchant_uid', merchantUid)
      .maybeSingle()
    if (error) {
      console.error('[lemonsqueezy-webhook] payment_intents lookup failed for', merchantUid, ':', error.message)
      return { ok: false, retryable: true }
    }
    if (!data) return { ok: false, retryable: false }
    return { ok: true, intent: data as { kind: string; product_id: string } }
  }

  // Small helper so lifecycle branches read cleanly.
  const syncSub = (subId: string, status: string, periodEnd: string | null, cancel: boolean | null) =>
    sb.rpc('sync_subscription', {
      p_provider: 'lemonsqueezy',
      p_provider_subscription_id: subId,
      p_status: status,
      p_period_end: periodEnd,
      p_cancel_at_period_end: cancel,
    }) as unknown as Promise<RpcResult>

  switch (event) {
    // ── FIRST GRANT ────────────────────────────────────────────────────────────────
    // Credit pack (one-time order). A SUBSCRIPTION purchase ALSO fires order_created, but
    // subscription_created is the SOLE first-grant path for subscriptions (AUDIT FIX #1):
    // if we ALSO granted here, confirm_payment→grant_subscription would insert a base row
    // (provider_ref=merchant_uid, sub id NULL) that then COLLIDES with
    // _upsert_subscription's (provider,provider_ref) unique index on subscription_created
    // → a perpetual 500 retry loop + an unrevokable sub-id-less active grant. So we
    // resolve the intent first and NO-OP subscription orders here.
    case 'order_created': {
      if (!merchantUid) return badMissing('merchant_uid', event)
      const look = await lookupIntent(merchantUid)
      if (!look.ok) {
        return look.retryable
          ? json({ error: 'Intent lookup failed', code: 'LOOKUP_ERROR' }, 500) // LS retries
          : json({ error: 'Unknown or invalid intent', code: 'BAD_REQUEST' }, 400)
      }
      // Subscription order → NO-OP; subscription_created is authoritative (see above).
      if (look.intent.kind === 'subscription') {
        console.log('[lemonsqueezy-webhook] order_created for subscription intent', merchantUid,
          '— no-op (subscription_created is the first-grant path)')
        return json({ received: true, event, note: 'subscription order acknowledged; granted via subscription_created' }, 200)
      }
      // credit_pack: assert the purchased variant maps to the intent's product, then grant.
      const bad = verifyVariant(event, attrs, look.intent.product_id, variantMap)
      if (bad) return bad
      const res = await sb.rpc('confirm_payment', {
        p_merchant_uid: merchantUid,
        p_provider: 'lemonsqueezy',
        p_provider_payment_id: dataId, // LS order id
      }) as unknown as RpcResult
      return grantResult(res, merchantUid)
    }

    // Subscription first grant: reconcile the paid intent AND record the LS sub id.
    case 'subscription_created': {
      if (!merchantUid) return badMissing('merchant_uid', event)
      if (!dataId) return badMissing('subscription id', event) // data.id = LS subscription id
      // Resolve the intent's product for the variant assertion (activate_… re-validates
      // kind='subscription' + locks the intent itself; this pre-read is only to verify the
      // purchased variant maps to the SAME product the server snapshotted).
      const look = await lookupIntent(merchantUid)
      if (!look.ok) {
        return look.retryable
          ? json({ error: 'Intent lookup failed', code: 'LOOKUP_ERROR' }, 500) // LS retries
          : json({ error: 'Unknown or invalid intent', code: 'BAD_REQUEST' }, 400)
      }
      const bad = verifyVariant(event, attrs, look.intent.product_id, variantMap)
      if (bad) return bad
      const res = await sb.rpc('activate_subscription_from_intent', {
        p_merchant_uid: merchantUid,
        p_provider: 'lemonsqueezy',
        p_provider_subscription_id: dataId,
        p_period_end: renewsAt,
      }) as unknown as RpcResult
      return grantResult(res, merchantUid)
    }

    // ── LIFECYCLE (existing row, matched by provider + provider_subscription_id) ──────
    case 'subscription_updated': {
      if (!dataId) return badMissing('subscription id', event)
      const status = mapLsStatus(attrs.status)
      if (!status) {
        // Unknown LS status — don't guess; ACK so LS stops retrying.
        console.warn('[lemonsqueezy-webhook] subscription_updated unmapped status:', attrs.status)
        return json({ received: true, event, unmappedStatus: attrs.status ?? null }, 200)
      }
      return lifecycleResult(await syncSub(dataId, status, renewsAt, cancelled), event)
    }

    case 'subscription_cancelled': {
      // Cancelled but still entitled until ends_at → 'canceled' + cancel_at_period_end.
      if (!dataId) return badMissing('subscription id', event)
      return lifecycleResult(await syncSub(dataId, 'canceled', endsAt, true), event)
    }

    case 'subscription_resumed':
    case 'subscription_unpaused': {
      if (!dataId) return badMissing('subscription id', event)
      return lifecycleResult(await syncSub(dataId, 'active', renewsAt, false), event)
    }

    case 'subscription_paused': {
      // Paused grants nothing; keep the existing cancel flag (null → COALESCE keeps).
      if (!dataId) return badMissing('subscription id', event)
      return lifecycleResult(await syncSub(dataId, 'paused', renewsAt, null), event)
    }

    case 'subscription_expired': {
      // Period is over; ends_at is the expiry (fall back to renews_at if absent).
      if (!dataId) return badMissing('subscription id', event)
      return lifecycleResult(await syncSub(dataId, 'expired', endsAt ?? renewsAt, null), event)
    }

    // ── PAYMENT (invoice) events — subscription id is at attributes.subscription_id ───
    case 'subscription_payment_failed': {
      // Dunning: keep access during retry. Keep period_end + cancel flag (both null).
      if (!invoiceSubId) return badMissing('subscription id', event)
      return lifecycleResult(await syncSub(invoiceSubId, 'past_due', null, null), event)
    }

    case 'subscription_payment_success':
    case 'subscription_payment_recovered': {
      // Renewal / dunning recovery → back to active. renews_at is (usually) absent on
      // the invoice payload, so period_end stays whatever subscription_updated set on
      // this same renewal (COALESCE keeps it) — see the ASSUMPTIONS note in the header.
      if (!invoiceSubId) return badMissing('subscription id', event)
      return lifecycleResult(await syncSub(invoiceSubId, 'active', renewsAt, false), event)
    }

    // ── REFUND / CHARGEBACK — hard kill now (drop the card-limit grant immediately) ──
    case 'subscription_payment_refunded': {
      if (!invoiceSubId) return badMissing('subscription id', event)
      const res = await sb.rpc('revoke_subscription', {
        p_provider: 'lemonsqueezy',
        p_provider_subscription_id: invoiceSubId,
      }) as unknown as RpcResult
      return lifecycleResult(res, event)
    }

    case 'order_refunded': {
      // A one-time credit-pack order OR a subscription's order. Only subscriptions can
      // be revoked here; a bare credit refund has no sub id.
      const orderSubId =
        asStr(attrs.subscription_id) ??
        asStr((attrs.first_order_item as Record<string, unknown> | undefined)?.subscription_id)
      if (orderSubId) {
        const res = await sb.rpc('revoke_subscription', {
          p_provider: 'lemonsqueezy',
          p_provider_subscription_id: orderSubId,
        }) as unknown as RpcResult
        return lifecycleResult(res, event)
      }
      // TODO(payments): one-time credit-pack refund clawback (deduct add_ai_credits) is
      // not implemented in this draft — we only log it. If clawback is added, reverse
      // the ledger entry keyed on this order/merchant_uid.
      console.warn('[lemonsqueezy-webhook] order_refunded with no subscription id — credit clawback not implemented (TODO):', dataId)
      return json({ received: true, event, note: 'credit refund acknowledged; no auto clawback (TODO)' }, 200)
    }

    // Unknown / unhandled events (license events, subscription_plan_changed, etc.)
    // → ACK 200 so Lemon Squeezy stops retrying.
    default:
      return json({ received: true, event }, 200)
  }
})
