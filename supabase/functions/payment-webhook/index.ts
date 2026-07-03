// Payment webhook — reconciles a SERVER-AUTHORITATIVE payment intent (mig 120).
//
// This is the GENERIC / PortOne (web) path. It grants ONLY prepaid AI credit top-ups,
// and ONLY via server-intent reconciliation — there is NO direct/body-priced grant path.
//
// ⚠ SUBSCRIPTIONS MUST NOT BE SOLD THROUGH THIS GENERIC WEBHOOK. Recurring plans are
//   settled elsewhere by gateways that carry their own per-user subscription identity
//   (mobile IAP → revenuecat-webhook; web subscriptions → LemonSqueezy). This endpoint
//   deliberately has no subscription branch: a generic body-priced sub grant is a
//   foot-gun — e.g. it could mint a subscription with a NULL period_end (unrevokable).
//
// FULL FLOW (server never trusts a client-shaped money body):
//   1. client → create_payment_intent(product_id): the SERVER snapshots price + kind
//      from billing_products and opens a 'pending' payment_intents row for auth.uid(),
//      returning a fresh `merchant_uid`.
//   2. client → provider checkout, passing THAT merchant_uid as the order id.
//   3. provider charges the card, then its SERVER POSTs this (SIGNED) webhook.
//   4. THIS FN → confirm_payment(merchant_uid, provider, provider_payment_id): locks
//      the intent, marks it 'paid' (idempotently), and grants the credit top-up from the
//      SNAPSHOT (add_ai_credits, mig 114 — idempotent on merchant_uid).
//   Because price + kind live on the server intent, the webhook body only needs to
//   name WHICH order settled — it can neither pick a price nor self-grant.
//
// This function MINTS money, so it is FAIL-CLOSED and signature-gated by construction:
//   * requires PAYMENT_WEBHOOK_SECRET — if unset → 503 (NEVER grants unconfigured).
//   * verifies HMAC-SHA256(raw body, secret) == the signature header, constant-time.
//     A forged request without the shared secret cannot produce a valid signature.
//   * confirm_payment is idempotent → redelivery never double-applies.
//
// Body (JSON) — INTENT reconciliation (the ONLY accepted shape):
//   { merchant_uid: string (required),
//     provider?: string,            // default: x-payment-provider header, else 'webhook'
//     provider_payment_id?: string } // the provider's own charge id (optional)
//   A body WITHOUT merchant_uid → 400 BAD_REQUEST (no grant). There is no legacy
//   direct-grant fallback anymore.
// Header: x-webhook-signature: hex(HMAC-SHA256(rawBody, PAYMENT_WEBHOOK_SECRET))
//
// PROVIDER SEAM — adapt `verifySignature` (+ how merchant_uid/provider_payment_id are
// read) to the chosen provider:
//   * PortOne v2 (web): webhook is svix-signed (`webhook-signature` over
//     `${id}.${timestamp}.${body}`); pass the store's order id as merchant_uid. For
//     extra safety re-fetch GET /payments/{paymentId} and confirm status=PAID first.
// The confirm/idempotency/fail-closed core below is provider-independent.
//
// Deploy: config.toml sets verify_jwt = false (a provider, not a user JWT, calls this);
// the HMAC signature is the auth. Until PAYMENT_WEBHOOK_SECRET is set → 503 (safe default).

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

// Adapt per provider. Default: hex HMAC-SHA256 over the raw body.
async function verifySignature(rawBody: string, header: string | null, secret: string): Promise<boolean> {
  if (!header) return false
  const expected = await hmacHex(secret, rawBody)
  return timingSafeEqual(header.trim().toLowerCase(), expected)
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  // FAIL-CLOSED: no configured secret → never grant.
  const secret = ENV('PAYMENT_WEBHOOK_SECRET')
  if (!secret) {
    console.error('[payment-webhook] PAYMENT_WEBHOOK_SECRET unset — refusing to grant')
    return json({ error: 'Payment webhook not configured', code: 'NOT_CONFIGURED' }, 503)
  }

  const rawBody = await req.text()
  const ok = await verifySignature(rawBody, req.headers.get('x-webhook-signature'), secret)
  if (!ok) {
    console.error('[payment-webhook] invalid signature')
    return json({ error: 'Invalid signature', code: 'BAD_SIGNATURE' }, 401)
  }

  let body: Record<string, unknown> | null
  try { body = JSON.parse(rawBody) as Record<string, unknown> } catch { body = null }
  if (!body) return json({ error: 'Invalid body', code: 'BAD_REQUEST' }, 400)

  const sb = createClient(ENV('SUPABASE_URL')!, ENV('SUPABASE_SERVICE_ROLE_KEY')!)

  // INTENT reconciliation (mig 120) is the ONLY supported path. The body only names
  // WHICH order settled; the server intent (payment_intents) holds the price + kind, so
  // confirm_payment applies the credit top-up from that snapshot — the body can neither
  // pick a price nor self-grant. A body WITHOUT merchant_uid is rejected outright: there
  // is NO legacy direct-grant path and NO subscription branch here (see header).
  const merchantUid = typeof body.merchant_uid === 'string' ? body.merchant_uid : ''
  if (!merchantUid) {
    console.error('[payment-webhook] missing merchant_uid — refusing to grant')
    return json({ error: 'merchant_uid required', code: 'BAD_REQUEST' }, 400)
  }

  const provider =
    (typeof body.provider === 'string' && body.provider) ||
    req.headers.get('x-payment-provider') ||
    'webhook'
  const providerPaymentId =
    body.provider_payment_id != null ? String(body.provider_payment_id) : null

  const { data, error } = await sb.rpc('confirm_payment', {
    p_merchant_uid: merchantUid,
    p_provider: provider,
    p_provider_payment_id: providerPaymentId,
  })
  if (error) {
    // A bad/unknown merchant_uid is a client (provider payload) error, not our fault.
    const badRef = /invalid_parameter_value|Unknown payment intent/i.test(error.message)
    console.error('[payment-webhook] confirm_payment failed (', merchantUid, '):', error.message)
    return badRef
      ? json({ error: 'Unknown or invalid intent', code: 'BAD_REQUEST' }, 400)
      : json({ error: 'Confirm failed', code: 'GRANT_ERROR' }, 500)
  }
  return json({ ok: true, ...(data ?? {}) }, 200)
})
