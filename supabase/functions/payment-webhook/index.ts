// Payment webhook — grants prepaid micro-WON credits on a VERIFIED payment.
//
// This function MINTS wallet balance (= money), so it is FAIL-CLOSED and
// signature-gated by construction:
//   * requires PAYMENT_WEBHOOK_SECRET — if unset → 503 (NEVER grants unconfigured).
//   * verifies HMAC-SHA256(raw body, secret) == the signature header, constant-time.
//     A forged request without the shared secret cannot produce a valid signature.
//   * grants via add_ai_credits (mig 114) which is IDEMPOTENT on the payment id →
//     a webhook redelivery/retry can never double-credit.
//   * caps the grant (sanity) and validates the payload.
//
// Body (JSON): { user_id: uuid, amount_won: number, payment_id: string }
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
  const wonAmount = body.amount_won
  // Strictly a positive whole-WON integer within the cap — reject non-numbers,
  // NaN/Infinity, fractions (would round to 0), negatives, and over-cap.
  if (!UUID_RE.test(userId) || !paymentId ||
      typeof wonAmount !== 'number' || !Number.isInteger(wonAmount) ||
      wonAmount <= 0 || wonAmount > MAX_GRANT_WON) {
    return json({ error: 'Invalid payload', code: 'BAD_REQUEST' }, 400)
  }

  // Grant micro-WON (₩ × 1e6). Idempotent on the payment id → retries can't double-credit.
  const sb = createClient(ENV('SUPABASE_URL')!, ENV('SUPABASE_SERVICE_ROLE_KEY')!)
  const { data, error } = await sb.rpc('add_ai_credits', {
    p_user_id: userId,
    p_micro_won: wonAmount * 1_000_000,
    p_reason: 'purchase',
    p_ref: paymentId,
  })
  if (error) {
    console.error('[payment-webhook] grant failed (payment', paymentId, '):', error.message)
    return json({ error: 'Grant failed', code: 'GRANT_ERROR' }, 500)
  }
  return json({ ok: true, balance_micro_won: data ?? null }, 200)
})
