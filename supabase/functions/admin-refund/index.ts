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
//   3. Provider money refund (service-role secrets):
//        lemonsqueezy credit_pack  → POST /v1/orders/{order_id}/refund
//        lemonsqueezy subscription → POST /v1/subscription-invoices/{invoice_id}/refund
//        toss (either)             → POST /v1/payments/{paymentKey}/cancel
//        revenuecat / admin        → no provider money API here (IAP refunds are Apple/Google;
//                                     admin comp grants moved no money) → internal reversal only.
//   4. Internal reversal (service-role, idempotent):
//        credit_pack  → clawback_credits(merchant_uid)
//        subscription → revoke_subscription(provider, provider_subscription_id)
//
// FAIL-CLOSED: a provider refund with the provider's secret UNSET → 503 (never silently
// "refund" without moving money). A provider API error → 502 with the provider status.
//
// Deploy: verify_jwt=true (needs the admin's JWT). Secrets: LEMONSQUEEZY_API_KEY (LS),
// TOSS_SECRET_KEY (Toss). ALLOWED_ORIGINS for CORS.

import { createClient } from '@supabase/supabase-js'
import { tossCancelPayment } from '../_shared/toss.ts'

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
  user_id?: string
  merchant_uid?: string
  provider_payment_id?: string | null
  provider_subscription_id?: string | null
  latest_invoice_id?: string | null
  status?: string
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

  } else {
    // revenuecat (Apple/Google issue the money) or admin comp (no money moved) → internal only.
    providerRefunded = false
    providerResult = { provider: provider || 'none', skipped: true, note: 'no server-side provider refund for this provider' }
  }

  // 3) Internal reversal (idempotent — the provider webhook may also do it). If it FAILS after a
  //    successful provider refund, return non-2xx so a money-moved-but-not-reversed state is never
  //    reported as green (the operator must retry/reconcile).
  let internal: unknown
  let reversalError: string | null = null
  if (kind === 'credit_pack') {
    const { data, error } = await sb.rpc('clawback_credits', { p_merchant_uid: target.merchant_uid })
    if (error) { reversalError = error.message; console.error('[admin-refund] clawback_credits error:', error.message) }
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

  return json({ ok: true, kind, provider, providerRefunded, provider_result: providerResult, internal }, 200, cors)
})
