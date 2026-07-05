// TossPayments — confirm a ONE-TIME (credit-pack) payment.
//
// Toss (unlike LemonSqueezy's signed push webhook) requires an explicit server-side
// CONFIRM after the buyer authorizes payment in the widget. Flow:
//   1. client requestPayment(orderId=merchant_uid, amount=amount_krw) → Toss redirect
//      to /checkout/toss/return?paymentKey&orderId&amount
//   2. that page POSTs {paymentKey, orderId, amount} HERE (with the user's JWT)
//   3. we re-read the payment_intent (SERVER-authoritative), assert amount===amount_krw
//      and the caller OWNS it and it is a credit_pack, then POST Toss /v1/payments/confirm
//      with the SECRET key, and on DONE call confirm_payment(orderId,'toss',paymentKey).
//
// The amount is NEVER trusted from the client — we confirm with the intent's amount_krw.
// Idempotent: a re-submit of an already-paid intent returns ok without re-charging.
//
// Deploy: default verify_jwt=true (needs the buyer's JWT). Secret: TOSS_SECRET_KEY.

import { createClient } from '@supabase/supabase-js'
import { tossConfirmPayment } from '../_shared/toss.ts'

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

async function verifyUser(authHeader: string | null): Promise<string | null> {
  if (!authHeader) return null
  const token = authHeader.replace('Bearer ', '')
  const sb = createClient(ENV('SUPABASE_URL')!, ENV('SUPABASE_ANON_KEY')!)
  const { data: { user } } = await sb.auth.getUser(token)
  return user?.id ?? null
}

Deno.serve(async (req) => {
  const cors = corsHeadersFor(req.headers.get('Origin'))
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405, cors)

  const userId = await verifyUser(req.headers.get('Authorization'))
  if (!userId) return json({ error: 'Unauthorized' }, 401, cors)

  const secretKey = ENV('TOSS_SECRET_KEY')
  if (!secretKey) return json({ error: 'Not configured', code: 'NOT_CONFIGURED' }, 503, cors)

  let body: { paymentKey?: string; orderId?: string; amount?: number } | null = null
  try { body = await req.json() } catch { body = null }
  const paymentKey = body?.paymentKey
  const orderId = body?.orderId
  const clientAmount = Number(body?.amount)
  if (!paymentKey || !orderId || !Number.isFinite(clientAmount)) {
    return json({ error: 'Bad request', code: 'BAD_REQUEST' }, 400, cors)
  }

  const svc = createClient(ENV('SUPABASE_URL')!, ENV('SUPABASE_SERVICE_ROLE_KEY')!)

  // Re-read the SERVER-authoritative intent (orderId == merchant_uid).
  const { data: intent, error: intErr } = await svc
    .from('payment_intents')
    .select('user_id, kind, amount_krw, status')
    .eq('merchant_uid', orderId)
    .maybeSingle()
  if (intErr) {
    console.error('[toss-confirm] intent lookup failed:', intErr.message)
    return json({ error: 'Lookup failed' }, 500, cors)
  }
  const it = intent as { user_id: string; kind: string; amount_krw: number; status: string } | null
  if (!it) return json({ error: 'Unknown order', code: 'UNKNOWN_ORDER' }, 404, cors)

  // Ownership: the caller must own this intent (no confirming someone else's order).
  if (it.user_id !== userId) return json({ error: 'Forbidden', code: 'NOT_OWNER' }, 403, cors)

  // Idempotent: already granted → ok, don't re-charge.
  if (it.status === 'paid') return json({ ok: true, already: true }, 200, cors)
  if (it.status !== 'pending') return json({ error: 'Intent not payable', code: 'BAD_STATE' }, 409, cors)

  // This endpoint is for one-time credit packs; subscriptions go through toss-billing.
  if (it.kind !== 'credit_pack') {
    return json({ error: 'Not a one-time order', code: 'WRONG_KIND' }, 400, cors)
  }

  // Server-authoritative amount: the client-reported amount MUST equal the snapshot,
  // and we confirm with the SNAPSHOT (never the client value).
  if (clientAmount !== it.amount_krw) {
    console.error('[toss-confirm] amount mismatch: client', clientAmount, 'intent', it.amount_krw, 'order', orderId)
    return json({ error: 'Amount mismatch', code: 'AMOUNT_MISMATCH' }, 400, cors)
  }

  // Confirm with Toss (Idempotency-Key = orderId → a retry returns the same result).
  const confirm = await tossConfirmPayment(secretKey, paymentKey, orderId, it.amount_krw, `confirm:${orderId}`)
  const tossStatus = confirm.body?.status
  if (!confirm.ok || tossStatus !== 'DONE') {
    console.error('[toss-confirm] Toss confirm failed:', confirm.status, JSON.stringify(confirm.body))
    return json({ error: 'Payment not approved', code: 'CONFIRM_FAILED', tossStatus: tossStatus ?? null }, 402, cors)
  }

  // Grant server-side (idempotent; provider-agnostic RPC).
  const { data: grant, error: grantErr } = await svc.rpc('confirm_payment', {
    p_merchant_uid: orderId,
    p_provider: 'toss',
    p_provider_payment_id: paymentKey,
  })
  if (grantErr) {
    // Payment IS captured at Toss but our grant failed — surface 500 so the client can
    // retry (confirm_payment is idempotent; a retry re-reads status='paid' and no-ops).
    console.error('[toss-confirm] grant failed after Toss DONE:', grantErr.message, 'order', orderId)
    return json({ error: 'Grant failed', code: 'GRANT_FAILED' }, 500, cors)
  }

  return json({ ok: true, grant }, 200, cors)
})
