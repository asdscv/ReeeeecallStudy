// TossPayments — recurring subscription renewals (scheduled).
//
// Toss does NOT auto-charge subscriptions — WE do. A daily cron (GitHub Actions)
// POSTs here with a shared secret; we:
//   1. get_due_toss_renewals() — subs whose paid period ended, not set to cancel, with
//      a stored billingKey (service-role RPC; billingKey never leaves the server).
//   2. charge each billingKey for amount_krw (Idempotency-Key keyed on the period → a
//      retry of the same period can NEVER double-charge).
//   3. success → sync_subscription('toss', sub_id, 'active', new_period_end, false) +
//      record_subscription_invoice(reason='renewal', KRW). fail → 'past_due'.
//   4. expire_ended_toss_subscriptions() — flip canceled/stale-past_due to 'expired'.
//
// Deploy WITH verify_jwt=false (config.toml) — this is a machine caller, gated by the
// TOSS_RENEW_SECRET bearer token, not a user JWT. Secrets: TOSS_SECRET_KEY, TOSS_RENEW_SECRET.

import { createClient } from '@supabase/supabase-js'
import { tossChargeBilling } from '../_shared/toss.ts'

const ENV = (k: string) => Deno.env.get(k)

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function plusOneMonthISO(from: Date): string {
  const d = new Date(from)
  d.setMonth(d.getMonth() + 1)
  return d.toISOString()
}

interface DueRow {
  subscription_id: string
  user_id: string
  provider_subscription_id: string
  product_id: string
  current_period_end: string
  billing_key: string
  customer_key: string
  price_krw: number
  title: string
  user_email: string | null
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  // Machine auth: a shared bearer secret (NOT a user JWT).
  const renewSecret = ENV('TOSS_RENEW_SECRET')
  if (!renewSecret) return json({ error: 'Not configured', code: 'NOT_CONFIGURED' }, 503)
  const auth = req.headers.get('Authorization') ?? ''
  if (auth !== `Bearer ${renewSecret}`) return json({ error: 'Unauthorized' }, 401)

  const secretKey = ENV('TOSS_SECRET_KEY')
  if (!secretKey) return json({ error: 'Not configured', code: 'NOT_CONFIGURED' }, 503)

  const svc = createClient(ENV('SUPABASE_URL')!, ENV('SUPABASE_SERVICE_ROLE_KEY')!)

  const { data: due, error: dueErr } = await svc.rpc('get_due_toss_renewals', { p_limit: 100 })
  if (dueErr) {
    console.error('[toss-renew] due lookup failed:', dueErr.message)
    return json({ error: 'Lookup failed' }, 500)
  }
  const rows = (due ?? []) as DueRow[]

  let renewed = 0, failed = 0
  for (const r of rows) {
    const periodBase = new Date(Math.max(new Date(r.current_period_end).getTime(), Date.now()))
    const newPeriodEnd = plusOneMonthISO(periodBase)
    const orderId = `toss_renew_${r.provider_subscription_id}_${new Date(r.current_period_end).getTime()}`
    const idemKey = `renew:${r.provider_subscription_id}:${r.current_period_end}` // per-period → retry-safe

    const charge = await tossChargeBilling(secretKey, r.billing_key, {
      customerKey: r.customer_key,
      amount: r.price_krw,
      orderId,
      orderName: r.title ?? 'Subscription renewal',
      customerEmail: r.user_email,
    }, idemKey)

    if (charge.ok && charge.body?.status === 'DONE') {
      const { error: syncErr } = await svc.rpc('sync_subscription', {
        p_provider: 'toss',
        p_provider_subscription_id: r.provider_subscription_id,
        p_status: 'active',
        p_period_end: newPeriodEnd,
        p_cancel_at_period_end: false,
      })
      if (syncErr) {
        // Charged but couldn't extend — log LOUD; the next cron re-reads the (still-due)
        // row, but the Idempotency-Key means the re-charge returns the SAME captured
        // payment (no double charge), and sync will extend then.
        console.error('[toss-renew] CHARGED but sync failed:', r.provider_subscription_id, syncErr.message)
        failed++
        continue
      }
      const paymentKey = (charge.body.paymentKey as string) ?? orderId
      const receiptUrl = ((charge.body.receipt ?? {}) as Record<string, unknown>).url as string | undefined
      await svc.rpc('record_subscription_invoice', {
        p_provider: 'toss',
        p_provider_invoice_id: paymentKey,
        p_provider_subscription_id: r.provider_subscription_id,
        p_amount_usd_cents: null,
        p_billing_reason: 'renewal',
        p_status: 'paid',
        p_invoice_url: receiptUrl ?? null,
        p_created_at: new Date().toISOString(),
        p_currency: 'krw',
        p_amount_krw: r.price_krw,
      })
      renewed++
    } else {
      console.error('[toss-renew] charge failed:', r.provider_subscription_id, charge.status, JSON.stringify(charge.body))
      await svc.rpc('sync_subscription', {
        p_provider: 'toss',
        p_provider_subscription_id: r.provider_subscription_id,
        p_status: 'past_due',
        p_period_end: null, // keep the period (COALESCE keeps current)
        p_cancel_at_period_end: null,
      })
      failed++
    }
  }

  const { data: expired } = await svc.rpc('expire_ended_toss_subscriptions')

  return json({ ok: true, due: rows.length, renewed, failed, expired: expired ?? 0 }, 200)
})
