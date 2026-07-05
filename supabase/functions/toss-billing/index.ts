// TossPayments — issue a billing key and grant the FIRST subscription period.
//
// Toss has no hosted subscription: the buyer authorizes a card (requestBillingAuth),
// Toss redirects to /checkout/toss/return?authKey&customerKey, and that page POSTs
// {authKey, customerKey, merchantUid} HERE. We then:
//   1. re-read the SERVER intent (merchantUid), assert the caller owns it + kind=subscription
//   2. assert customerKey == the caller's stored customerKey (no borrowing another's key)
//   3. exchange authKey -> billingKey (store it, server-only), OR reuse a stored key on retry
//   4. charge the first period on the billingKey (amount = intent.amount_krw)
//   5. activate_subscription_from_intent(merchantUid,'toss',<minted sub id>, +1 month)
//      + record the initial invoice (KRW)
// The daily toss-renew cron charges every subsequent period.
//
// Idempotent: an already-activated intent (status='paid') returns ok without re-charging.
// Deploy: default verify_jwt=true. Secret: TOSS_SECRET_KEY.

import { createClient } from '@supabase/supabase-js'
import { tossIssueBillingKey, tossChargeBilling } from '../_shared/toss.ts'

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

function plusOneMonthISO(): string {
  const d = new Date()
  d.setMonth(d.getMonth() + 1)
  return d.toISOString()
}

Deno.serve(async (req) => {
  const cors = corsHeadersFor(req.headers.get('Origin'))
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405, cors)

  const userId = await verifyUser(req.headers.get('Authorization'))
  if (!userId) return json({ error: 'Unauthorized' }, 401, cors)

  const secretKey = ENV('TOSS_SECRET_KEY')
  if (!secretKey) return json({ error: 'Not configured', code: 'NOT_CONFIGURED' }, 503, cors)

  let body: { authKey?: string; customerKey?: string; merchantUid?: string } | null = null
  try { body = await req.json() } catch { body = null }
  const authKey = body?.authKey
  const customerKey = body?.customerKey
  const merchantUid = body?.merchantUid
  if (!authKey || !customerKey || !merchantUid) {
    return json({ error: 'Bad request', code: 'BAD_REQUEST' }, 400, cors)
  }

  const svc = createClient(ENV('SUPABASE_URL')!, ENV('SUPABASE_SERVICE_ROLE_KEY')!)

  // Intent (SERVER-authoritative): must be the caller's own subscription intent.
  const { data: intent, error: intErr } = await svc
    .from('payment_intents')
    .select('user_id, kind, amount_krw, status')
    .eq('merchant_uid', merchantUid)
    .maybeSingle()
  if (intErr) {
    console.error('[toss-billing] intent lookup failed:', intErr.message)
    return json({ error: 'Lookup failed' }, 500, cors)
  }
  const it = intent as { user_id: string; kind: string; amount_krw: number; status: string } | null
  if (!it) return json({ error: 'Unknown order', code: 'UNKNOWN_ORDER' }, 404, cors)
  if (it.user_id !== userId) return json({ error: 'Forbidden', code: 'NOT_OWNER' }, 403, cors)
  if (it.status === 'paid') return json({ ok: true, already: true }, 200, cors) // already activated
  if (it.status !== 'pending') return json({ error: 'Intent not payable', code: 'BAD_STATE' }, 409, cors)
  if (it.kind !== 'subscription') return json({ error: 'Not a subscription', code: 'WRONG_KIND' }, 400, cors)

  // customerKey must be THIS user's stored key (issued by get_or_create_toss_customer_key).
  const { data: cust } = await svc
    .from('toss_customers')
    .select('customer_key, billing_key')
    .eq('user_id', userId)
    .maybeSingle()
  const stored = cust as { customer_key: string; billing_key: string | null } | null
  if (!stored || stored.customer_key !== customerKey) {
    return json({ error: 'Customer key mismatch', code: 'CUSTOMER_MISMATCH' }, 403, cors)
  }

  // Get a billingKey: exchange the one-time authKey; on failure fall back to a stored
  // key (retry after a mid-flight failure — authKey is single-use).
  let billingKey = stored.billing_key ?? null
  const issue = await tossIssueBillingKey(secretKey, authKey, customerKey)
  if (issue.ok && typeof issue.body?.billingKey === 'string') {
    billingKey = issue.body.billingKey as string
    const card = (issue.body.card ?? {}) as Record<string, unknown>
    await svc.from('toss_customers').update({
      billing_key: billingKey,
      card_brand: (card.cardType as string) ?? null,
      card_last4: typeof card.number === 'string' ? (card.number as string).slice(-4) : null,
      updated_at: new Date().toISOString(),
    }).eq('user_id', userId)
  } else if (!billingKey) {
    console.error('[toss-billing] issue failed and no stored key:', issue.status, JSON.stringify(issue.body))
    return json({ error: 'Billing key issue failed', code: 'ISSUE_FAILED' }, 402, cors)
  }

  // Mint a stable subscription id (Toss has none) for lifecycle matching.
  const subId = 'toss_sub_' + crypto.randomUUID().replace(/-/g, '')

  // Charge the first period. Idempotency-Key keyed on the intent → a retry is safe.
  const email = null // (email is optional; the intent doesn't carry it)
  const charge = await tossChargeBilling(secretKey, billingKey!, {
    customerKey,
    amount: it.amount_krw,
    orderId: merchantUid,
    orderName: 'Subscription',
    customerEmail: email,
  }, `charge:${merchantUid}`)
  if (!charge.ok || charge.body?.status !== 'DONE') {
    console.error('[toss-billing] first charge failed:', charge.status, JSON.stringify(charge.body))
    return json({ error: 'Charge failed', code: 'CHARGE_FAILED', tossStatus: charge.body?.status ?? null }, 402, cors)
  }
  const paymentKey = (charge.body.paymentKey as string) ?? subId
  const receiptUrl = ((charge.body.receipt ?? {}) as Record<string, unknown>).url as string | undefined

  // Activate the subscription (idempotent; marks the intent paid, records provider sub id).
  const periodEnd = plusOneMonthISO()
  const { data: activated, error: actErr } = await svc.rpc('activate_subscription_from_intent', {
    p_merchant_uid: merchantUid,
    p_provider: 'toss',
    p_provider_subscription_id: subId,
    p_period_end: periodEnd,
  })
  if (actErr) {
    console.error('[toss-billing] activate failed after charge:', actErr.message, 'order', merchantUid)
    return json({ error: 'Activation failed', code: 'ACTIVATE_FAILED' }, 500, cors)
  }

  // Record the initial invoice (KRW). billing_reason='initial' → not shown in history
  // (the intent already represents it), but kept for completeness. Best-effort.
  await svc.rpc('record_subscription_invoice', {
    p_provider: 'toss',
    p_provider_invoice_id: paymentKey,
    p_provider_subscription_id: subId,
    p_amount_usd_cents: null,
    p_billing_reason: 'initial',
    p_status: 'paid',
    p_invoice_url: receiptUrl ?? null,
    p_created_at: new Date().toISOString(),
    p_currency: 'krw',
    p_amount_krw: it.amount_krw,
  }).then((r: { error?: { message?: string } }) => {
    if (r?.error) console.error('[toss-billing] invoice record failed:', r.error.message)
  })

  return json({ ok: true, subscription: activated }, 200, cors)
})
