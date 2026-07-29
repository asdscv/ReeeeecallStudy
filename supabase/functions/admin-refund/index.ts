// admin-refund — ADMIN one-click refund. Issues the REAL money refund at the provider
// (LemonSqueezy order / subscription-invoice, or TossPayments payment cancel) and then
// reconciles OUR side (wallet clawback / subscription revoke). The provider webhook ALSO
// reconciles, but every internal RPC here is idempotent so double-application is safe.
//
// FLOW:
//   1. verify_jwt=true → the platform has verified the caller's JWT.
//   2. admin_refund_target(kind, ref) is called with the CALLER'S JWT (user client) — its
//      is_admin() guard authorizes the request AND returns the provider + the exact ids to
//      refund. A non-admin caller → 42501 → 403. Unknown target → 404.
//   3. Provider money refund (service-role secrets), dispatched on the CHANNEL — not
//      the provider — because RevenueCat fronts two stores with opposite capabilities
//      (mig 156 records which):
//        lemonsqueezy credit_pack  → POST /v1/orders/{order_id}/refund
//        lemonsqueezy subscription → POST /v1/subscription-invoices/{invoice_id}/refund
//        toss (either)             → POST /v1/payments/{paymentKey}/cancel
//        android (either)          → POST androidpublisher .../orders/{orderId}:refund?revoke=true
//        ios                       → NOTHING. Apple exposes no developer refund API;
//                                     the money refund is Apple's to issue. We revoke
//                                     access and say so — we never report a refund.
//        mobile_unknown            → treated as ios (fail safe): a row with no recorded
//                                     store might be Apple, so never claim a refund.
//        admin comp                → no money ever moved → internal reversal only.
//   4. Internal reversal (service-role, idempotent):
//        credit_pack (web intent)  → clawback_credits(merchant_uid)
//        credit_pack (IAP ledger)  → clawback_ai_credits_by_ref(ref)   ← no intent exists
//        subscription              → revoke_subscription(provider, provider_subscription_id)
//
// FAIL-CLOSED: a provider refund with the provider's secret UNSET → 503 (never silently
// "refund" without moving money). A provider API error → 502 with the provider status.
// `providerRefunded` in the response is the ONLY truth about whether money moved; the
// admin UI must render it rather than assuming a 200 means a refund.
//
// Deploy: verify_jwt=true (needs the admin's JWT). Secrets: LEMONSQUEEZY_API_KEY (LS),
// TOSS_SECRET_KEY (Toss), GOOGLE_PLAY_SERVICE_ACCOUNT + GOOGLE_PLAY_PACKAGE_NAME
// (Play — see _shared/google-play.ts for the Play Console grants). ALLOWED_ORIGINS for CORS.

import { createClient } from '@supabase/supabase-js'
import { tossCancelPayment } from '../_shared/toss.ts'
import { DEFAULT_PACKAGE_NAME, playAlreadyRefunded, playRefundOrder } from '../_shared/google-play.ts'

const ENV = (k: string) => Deno.env.get(k)

const ALLOWED_ORIGINS = (ENV('ALLOWED_ORIGINS') ??
  'https://reeeeecallstudy.xyz,http://localhost:5173')
  .split(',').map((s) => s.trim()).filter(Boolean)

function corsHeadersFor(origin: string | null): Record<string, string> {
  const h: Record<string, string> = {
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, content-type, x-client-info, apikey',
    'Vary': 'Origin',
  }
  if (origin && ALLOWED_ORIGINS.includes(origin)) h['Access-Control-Allow-Origin'] = origin
  return h
}

function json(body: unknown, status: number, cors: Record<string, string>): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
}

const LS_API = 'https://api.lemonsqueezy.com'

// LemonSqueezy full refund of an order or a subscription-invoice (JSON:API). No amount
// attribute → LS issues a FULL refund. Returns {ok, status, body}.
async function lsRefund(
  apiKey: string,
  resource: 'orders' | 'subscription-invoices',
  id: string,
): Promise<{ ok: boolean; status: number; body: unknown }> {
  const resp = await fetch(`${LS_API}/v1/${resource}/${id}/refund`, {
    method: 'POST',
    headers: {
      Accept: 'application/vnd.api+json',
      'Content-Type': 'application/vnd.api+json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ data: { type: resource, id: String(id), attributes: {} } }),
  })
  const body = await resp.json().catch(() => null)
  return { ok: resp.ok, status: resp.status, body }
}

// LemonSqueezy cancel a subscription (DELETE) — stops future renewals. Best-effort: called
// after a subscription refund so LS doesn't re-charge a customer who no longer has access.
async function lsCancelSubscription(
  apiKey: string,
  id: string,
): Promise<{ ok: boolean; status: number; body: unknown }> {
  const resp = await fetch(`${LS_API}/v1/subscriptions/${id}`, {
    method: 'DELETE',
    headers: { Accept: 'application/vnd.api+json', Authorization: `Bearer ${apiKey}` },
  })
  const body = await resp.json().catch(() => null)
  return { ok: resp.ok, status: resp.status, body }
}

// Treat a LS refund error as idempotent ONLY on an explicit "already ... refunded" / "fully
// refunded" detail — NEVER a bare "refunded" mention (which could be an eligibility/validation
// message), so a real failure is never silently reported as an already-issued refund.
function lsAlreadyRefunded(r: { body: unknown }): boolean {
  const s = JSON.stringify(r.body ?? '')
  return /already[^"]*refund|fully[ _-]?refunded/i.test(s)
}

interface Target {
  ok: boolean
  reason?: string
  kind?: 'credit_pack' | 'subscription'
  provider?: string
  /** 'web' | 'ios' | 'android' | null — the store, recorded by mig 156. */
  platform?: string | null
  /** 'web_lemonsqueezy' | 'web_toss' | 'ios' | 'android' | 'mobile_unknown' | 'admin' */
  channel?: string
  /** Whether OUR server can issue this channel's money refund at all. */
  can_refund_money?: boolean
  /** credit_pack only: 'payment_intent' (web) | 'credit_ledger' (mobile IAP). */
  source?: string
  user_id?: string
  merchant_uid?: string
  provider_payment_id?: string | null
  provider_subscription_id?: string | null
  latest_invoice_id?: string | null
  status?: string
}

// A mobile IAP credit pack's "merchant_uid" is its LEDGER ref, which the RevenueCat
// webhook namespaces: 'rc:<store transaction id>' for a real store transaction, or
// 'rcev:<RevenueCat event id>' when the event carried no transaction key at all.
// Only the former is a Play order id. An 'rcev:' grant is NOT refundable at the
// store — returning null makes the caller say so instead of posting a bogus id.
function playOrderIdFromRef(ref: string | null | undefined): string | null {
  if (!ref) return null
  if (ref.startsWith('rcev:')) return null
  return ref.startsWith('rc:') ? ref.slice(3) : ref
}

Deno.serve(async (req) => {
  const origin = req.headers.get('origin')
  const cors = corsHeadersFor(origin)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405, cors)

  const authHeader = req.headers.get('authorization')
  if (!authHeader) return json({ error: 'Unauthorized', code: 'NO_AUTH' }, 401, cors)

  let payload: { kind?: string; ref?: string; reason?: string } | null
  try { payload = JSON.parse(await req.text()) } catch { payload = null }
  const kind = payload?.kind
  const ref = payload?.ref
  const reason = (payload?.reason && String(payload.reason).slice(0, 200)) || 'admin refund'
  if ((kind !== 'credit_pack' && kind !== 'subscription') || !ref) {
    return json({ error: 'kind (credit_pack|subscription) and ref required', code: 'BAD_REQUEST' }, 400, cors)
  }

  const url = ENV('SUPABASE_URL')!
  // 1) Authorize + resolve via the CALLER'S JWT (admin_refund_target enforces is_admin).
  const userClient = createClient(url, ENV('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authHeader } },
  })
  const { data: tData, error: tErr } = await userClient.rpc('admin_refund_target', {
    p_kind: kind, p_ref: ref,
  })
  if (tErr) {
    // 42501 from the is_admin guard → forbidden; anything else → 400.
    const forbidden = /Admin only|42501|permission denied/i.test(tErr.message)
    console.error('[admin-refund] target/authz error:', tErr.message)
    return json({ error: forbidden ? 'Forbidden' : 'Invalid request', code: forbidden ? 'FORBIDDEN' : 'BAD_REQUEST' },
      forbidden ? 403 : 400, cors)
  }
  const target = tData as Target
  if (!target?.ok) return json({ error: 'Refund target not found', reason: target?.reason ?? 'not_found', code: 'NOT_FOUND' }, 404, cors)

  const provider = target.provider ?? ''
  // Dispatch on the CHANNEL, not the provider: 'revenuecat' covers both stores, and
  // only one of them (Play) has a refund API. mig 156 derives this server-side, so a
  // pre-156 row with no recorded store arrives as 'mobile_unknown' → treated as Apple.
  const channel = target.channel ?? (provider === 'revenuecat' ? 'mobile_unknown' : provider)
  const sb = createClient(url, ENV('SUPABASE_SERVICE_ROLE_KEY')!)

  // 2) PROVIDER money refund (fail-closed on a missing secret).
  if (kind === 'credit_pack' && target.status !== 'paid') {
    // Never call the provider for an intent that never settled.
    return json({ error: 'Payment is not in a refundable (paid) state', code: 'NOT_PAID', status: target.status }, 409, cors)
  }

  let providerRefunded = false
  let providerResult: unknown = { skipped: true }

  const revokeOnly = async (note: string): Promise<Response> => {
    const rev = await sb.rpc('revoke_subscription', { p_provider: provider, p_provider_subscription_id: target.provider_subscription_id })
    if (rev.error) {
      console.error('[admin-refund] revoke_subscription error:', rev.error.message)
      return json({ ok: false, code: 'REVERSAL_FAILED', providerRefunded: false, error: rev.error.message }, 500, cors)
    }
    return json({ ok: true, providerRefunded: false, note, internal: rev.data }, 200, cors)
  }

  if (provider === 'lemonsqueezy') {
    const apiKey = ENV('LEMONSQUEEZY_API_KEY')
    if (!apiKey) return json({ error: 'LemonSqueezy not configured', code: 'NOT_CONFIGURED' }, 503, cors)
    const resource = kind === 'credit_pack' ? 'orders' : 'subscription-invoices'
    const id = kind === 'credit_pack' ? target.provider_payment_id : target.latest_invoice_id
    if (!id) {
      // Subscription with no recorded invoice → revoke access only; the money refund is a dashboard action.
      return await revokeOnly('no_invoice_to_refund; access revoked — issue the money refund in the LemonSqueezy dashboard')
    }
    const r = await lsRefund(apiKey, resource, id)
    // Idempotent ONLY on a precise "already fully refunded" signal (never a bare "refunded").
    const already = !r.ok && lsAlreadyRefunded(r)
    if (!r.ok && !already) {
      console.error('[admin-refund] LS refund failed:', r.status, JSON.stringify(r.body))
      return json({ error: 'Provider refund failed', code: 'PROVIDER_ERROR', providerStatus: r.status, providerBody: r.body }, 502, cors)
    }
    providerRefunded = true
    const pr: Record<string, unknown> = { provider: 'lemonsqueezy', status: r.status, alreadyRefunded: !!already }
    // A subscription refund must ALSO cancel the LS subscription, else it renews + re-charges
    // while our terminal-guard blocks re-entitlement (charged with NO access). Best-effort; the
    // result is surfaced so the admin can cancel manually if it failed.
    if (kind === 'subscription' && target.provider_subscription_id) {
      const c = await lsCancelSubscription(apiKey, target.provider_subscription_id)
      pr.subscriptionCanceled = c.ok
      if (!c.ok) console.error('[admin-refund] LS cancel-subscription failed:', c.status, JSON.stringify(c.body))
    }
    providerResult = pr

  } else if (provider === 'toss') {
    const secret = ENV('TOSS_SECRET_KEY')
    if (!secret) return json({ error: 'Toss not configured', code: 'NOT_CONFIGURED' }, 503, cors)
    const paymentKey = kind === 'credit_pack' ? target.provider_payment_id : target.latest_invoice_id
    if (!paymentKey) {
      return await revokeOnly('no_paymentKey_to_cancel; access revoked — cancel the payment in the Toss dashboard')
    }
    const r = await tossCancelPayment(secret, paymentKey, reason, `refund:${paymentKey}`)
    // Idempotent ONLY on Toss's exact ALREADY_CANCELED_PAYMENT code (never a bare "already").
    const code = r.body && typeof r.body === 'object' ? (r.body as Record<string, unknown>).code : null
    const already = !r.ok && code === 'ALREADY_CANCELED_PAYMENT'
    if (!r.ok && !already) {
      console.error('[admin-refund] Toss cancel failed:', r.status, JSON.stringify(r.body))
      return json({ error: 'Provider refund failed', code: 'PROVIDER_ERROR', providerStatus: r.status, providerBody: r.body }, 502, cors)
    }
    providerRefunded = true
    providerResult = { provider: 'toss', status: r.status, alreadyRefunded: !!already }
    // Toss: a 'refunded' sub is excluded from get_due_toss_renewals (mig 132), so the revoke
    // below already stops future charges — no extra provider cancel needed.

  } else if (channel === 'android') {
    // GOOGLE PLAY — the one store whose refunds we can issue ourselves.
    const saJson = ENV('GOOGLE_PLAY_SERVICE_ACCOUNT')
    if (!saJson) return json({ error: 'Google Play not configured', code: 'NOT_CONFIGURED' }, 503, cors)
    const pkg = ENV('GOOGLE_PLAY_PACKAGE_NAME') || DEFAULT_PACKAGE_NAME

    // The Play order id. For a consumable it is the ledger ref's store transaction;
    // for a subscription it is the ORIGINAL order (original_transaction_id), which is
    // also exactly the charge our policy allows refunding — renewals are out of scope
    // (mig 157 refund_eligibility returns 'renewal_charge' for those).
    const orderId = kind === 'credit_pack'
      ? playOrderIdFromRef(target.provider_payment_id ?? target.merchant_uid)
      : playOrderIdFromRef(target.provider_subscription_id)

    if (!orderId) {
      // No usable store order id. For a subscription we can still drop access; for a
      // consumable there is nothing to revoke, so report it rather than claim success.
      if (kind === 'subscription') {
        return await revokeOnly('no_play_order_id; access revoked — issue the money refund in the Play Console')
      }
      return json({
        error: 'This grant has no Google Play order id (it was recorded from an event id), ' +
               'so it cannot be refunded via the API — refund it in the Play Console',
        code: 'NO_STORE_ORDER_ID',
      }, 409, cors)
    }

    // revoke=true also cancels a subscription, so Play cannot renew and re-charge a
    // customer whose money we just returned (our terminal-state guard would refuse to
    // re-entitle them — charged with NO access).
    const r = await playRefundOrder(saJson, pkg, orderId, { revoke: true, nowSec: Math.floor(Date.now() / 1000) })
    if (r.notConfigured) return json({ error: 'Google Play not configured', code: 'NOT_CONFIGURED' }, 503, cors)
    const already = !r.ok && playAlreadyRefunded(r)
    if (!r.ok && !already) {
      console.error('[admin-refund] Play refund failed:', r.status, JSON.stringify(r.body))
      return json({ error: 'Provider refund failed', code: 'PROVIDER_ERROR', providerStatus: r.status, providerBody: r.body }, 502, cors)
    }
    providerRefunded = true
    providerResult = { provider: 'google_play', orderId, status: r.status, alreadyRefunded: !!already, revoked: true }

  } else if (channel === 'ios' || channel === 'mobile_unknown') {
    // APPLE — there is no developer refund API. Apple alone issues App Store refunds
    // (the user requests one via reportaproblem.apple.com or the in-app refund sheet),
    // and RevenueCat's REFUND webhook then reconciles our side automatically. All we
    // can do here is revoke access, so we must NOT report a money movement.
    // 'mobile_unknown' (a row predating mig 156) lands here on purpose: it might be an
    // Apple purchase, and claiming a refund we cannot make is the worse failure.
    providerRefunded = false
    providerResult = {
      provider: 'revenuecat',
      channel,
      skipped: true,
      note: channel === 'ios'
        ? 'Apple issues App Store refunds; access revoked only. Ask the user to request the refund from Apple, or approve it in App Store Connect.'
        : 'Store not recorded for this row, so it may be an Apple purchase; access revoked only. Verify the store before promising a refund.',
    }

  } else {
    // Admin comp grant (no money ever moved) or an unrecognised provider.
    providerRefunded = false
    providerResult = { provider: provider || 'none', channel, skipped: true, note: 'no server-side provider refund for this channel' }
  }

  // 3) Internal reversal (idempotent — the provider webhook may also do it). If it FAILS after a
  //    successful provider refund, return non-2xx so a money-moved-but-not-reversed state is never
  //    reported as green (the operator must retry/reconcile).
  let internal: unknown
  let reversalError: string | null = null
  if (kind === 'credit_pack') {
    // Two different clawbacks, because the two channels record the purchase differently:
    // a web pack has a payment_intents row (clawback_credits keys on merchant_uid), a
    // mobile IAP consumable has ONLY a ledger grant (clawback_ai_credits_by_ref keys on
    // the ledger ref — mig 134). Using the web one on an IAP pack finds no intent and
    // reverses nothing, which would leave the credits granted after a real refund.
    const viaLedger = target.source === 'credit_ledger'
    const { data, error } = viaLedger
      ? await sb.rpc('clawback_ai_credits_by_ref', {
          p_user_id: target.user_id ?? null, p_ref: target.merchant_uid,
        })
      : await sb.rpc('clawback_credits', { p_merchant_uid: target.merchant_uid })
    if (error) {
      reversalError = error.message
      console.error(`[admin-refund] ${viaLedger ? 'clawback_ai_credits_by_ref' : 'clawback_credits'} error:`, error.message)
    }
    internal = error ? { error: error.message } : data
  } else {
    const { data, error } = await sb.rpc('revoke_subscription', {
      p_provider: provider, p_provider_subscription_id: target.provider_subscription_id,
    })
    if (error) { reversalError = error.message; console.error('[admin-refund] revoke_subscription error:', error.message) }
    internal = error ? { error: error.message } : data
  }

  if (reversalError) {
    return json({
      ok: false, code: 'REVERSAL_FAILED', kind, provider, providerRefunded,
      error: `Provider refund ${providerRefunded ? 'succeeded' : 'skipped'} but internal reversal FAILED — retry/reconcile: ${reversalError}`,
      provider_result: providerResult,
    }, 500, cors)
  }

  // `providerRefunded` distinguishes "money returned" from "access revoked only" — the
  // admin UI MUST surface it, since a 200 alone does not mean the customer was paid back.
  return json({
    ok: true, kind, provider, channel, platform: target.platform ?? null,
    providerRefunded, provider_result: providerResult, internal,
  }, 200, cors)
})
