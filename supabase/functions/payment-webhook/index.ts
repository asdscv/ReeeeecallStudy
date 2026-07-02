// Payment webhook — on a VERIFIED payment, either MINTS prepaid micro-WON credits
// OR activates a subscription (mig 119), selected by the body `kind` field.
//
// This function MINTS wallet balance / grants entitlements (= money), so it is
// FAIL-CLOSED and signature-gated by construction:
//   * requires PAYMENT_WEBHOOK_SECRET — if unset → 503 (NEVER grants unconfigured).
//   * verifies HMAC-SHA256(raw body, secret) == the signature header, constant-time.
//     A forged request without the shared secret cannot produce a valid signature.
//   * credit grants via add_ai_credits (mig 114), IDEMPOTENT on the payment id;
//     subscription grants via grant_subscription (mig 119), IDEMPOTENT on
//     (provider, provider_ref) → a webhook redelivery/retry can never double-apply.
//   * caps the credit grant (sanity) and validates the payload.
//
// Body (JSON), discriminated on `kind` (defaults to 'credit' when absent):
//   credit:       { kind?: 'credit', user_id: uuid, payment_id: string,
//                   // amount, first that applies:
//                   product_id?: string      // → billing_products.credits_micro_won
//                   | micro_won?: number     // explicit micro-WON integer
//                   | amount_won?: number }  // whole-WON integer × 1e6 (original contract)
//   subscription: { kind: 'subscription', user_id: uuid, payment_id: string,
//                   product_id: string, provider?: string,
//                   provider_ref?: string,   // defaults to payment_id
//                   period_end?: string }    // ISO-8601 timestamp (nullable)
// Header:      x-webhook-signature: hex(HMAC-SHA256(rawBody, PAYMENT_WEBHOOK_SECRET))
//
// PROVIDER SEAM — adapt `verifySignature` + the payload fields to the chosen provider:
//   * PortOne v2 (web): the webhook is svix-signed (`webhook-signature` header over
//     `${id}.${timestamp}.${body}`); for extra safety re-fetch GET /payments/{paymentId}
//     with the PortOne API secret and trust THAT amount/status, not the body.
//   * RevenueCat (mobile IAP): auth via the `Authorization` shared-secret header (not
//     an HMAC); map `product_id` → ₩ from a server-side SKU table (don't trust a body amount).
// The grant/idempotency/fail-closed core below is provider-independent.
//
// Deploy: config.toml sets verify_jwt = false (a provider, not a user JWT, calls this);
// the HMAC signature is the auth. Until PAYMENT_WEBHOOK_SECRET is set → 503 (safe default).

import { createClient } from '@supabase/supabase-js'

const ENV = (k: string) => Deno.env.get(k)
const MAX_GRANT_WON = 1_000_000 // sanity ceiling per top-up: ₩1,000,000
const MAX_GRANT_MICRO = MAX_GRANT_WON * 1_000_000 // same ceiling, in micro-WON

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

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

  const userId = typeof body.user_id === 'string' ? body.user_id : ''
  const paymentId = body.payment_id != null ? String(body.payment_id) : ''
  const kind = typeof body.kind === 'string' ? body.kind : 'credit'
  if (!UUID_RE.test(userId) || !paymentId) {
    return json({ error: 'Invalid payload', code: 'BAD_REQUEST' }, 400)
  }

  const sb = createClient(ENV('SUPABASE_URL')!, ENV('SUPABASE_SERVICE_ROLE_KEY')!)

  // ── SUBSCRIPTION branch (mig 119) — activate/refresh a plan. Idempotent on
  //    (provider, provider_ref) inside grant_subscription → retries never double-apply.
  if (kind === 'subscription') {
    const productId = typeof body.product_id === 'string' ? body.product_id : ''
    const provider = typeof body.provider === 'string' && body.provider ? body.provider : 'webhook'
    const providerRef = body.provider_ref != null ? String(body.provider_ref) : paymentId
    if (!productId) {
      return json({ error: 'Invalid payload', code: 'BAD_REQUEST' }, 400)
    }
    let periodEnd: string | null = null
    if (body.period_end != null) {
      const t = Date.parse(String(body.period_end))
      if (Number.isNaN(t)) return json({ error: 'Invalid period_end', code: 'BAD_REQUEST' }, 400)
      periodEnd = new Date(t).toISOString()
    }
    const { error } = await sb.rpc('grant_subscription', {
      p_user: userId,
      p_product_id: productId,
      p_provider: provider,
      p_provider_ref: providerRef,
      p_period_end: periodEnd,
    })
    if (error) {
      console.error('[payment-webhook] subscription grant failed (', providerRef, '):', error.message)
      return json({ error: 'Grant failed', code: 'GRANT_ERROR' }, 500)
    }
    return json({ ok: true, kind: 'subscription' }, 200)
  }

  // ── CREDIT branch (default / kind:'credit') — mint prepaid micro-WON. ──
  // Resolve the amount, first that applies:
  //   1) product_id → billing_products.credits_micro_won (trusted server catalog)
  //   2) micro_won  → explicit micro-WON integer
  //   3) amount_won → whole-WON integer × 1e6 (original webhook contract)
  let microWon: number | null = null
  const productId = typeof body.product_id === 'string' ? body.product_id : ''
  if (productId) {
    const { data: prod, error: prodErr } = await sb
      .from('billing_products')
      .select('credits_micro_won, kind, is_active')
      .eq('id', productId)
      .maybeSingle()
    if (prodErr) {
      console.error('[payment-webhook] product lookup failed (', productId, '):', prodErr.message)
      return json({ error: 'Grant failed', code: 'GRANT_ERROR' }, 500)
    }
    if (!prod || prod.kind !== 'credit_pack' || !prod.is_active || prod.credits_micro_won == null) {
      return json({ error: 'Invalid product', code: 'BAD_REQUEST' }, 400)
    }
    microWon = Number(prod.credits_micro_won)
  } else if (typeof body.micro_won === 'number') {
    microWon = body.micro_won
  } else if (typeof body.amount_won === 'number') {
    microWon = body.amount_won * 1_000_000
  }

  // Strictly a positive whole micro-WON integer within the cap — reject non-numbers,
  // NaN/Infinity, fractions, negatives, and over-cap.
  if (microWon == null || !Number.isInteger(microWon) || microWon <= 0 || microWon > MAX_GRANT_MICRO) {
    return json({ error: 'Invalid payload', code: 'BAD_REQUEST' }, 400)
  }

  // Grant micro-WON. Idempotent on the payment id → retries can't double-credit.
  const { data, error } = await sb.rpc('add_ai_credits', {
    p_user_id: userId,
    p_micro_won: microWon,
    p_reason: 'purchase',
    p_ref: paymentId,
  })
  if (error) {
    console.error('[payment-webhook] grant failed (payment', paymentId, '):', error.message)
    return json({ error: 'Grant failed', code: 'GRANT_ERROR' }, 500)
  }
  return json({ ok: true, balance_micro_won: data ?? null }, 200)
})
