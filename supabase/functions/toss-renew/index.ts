// TossPayments — recurring subscription renewals (scheduled).
//
// Toss does NOT auto-charge subscriptions — WE do. A daily cron (GitHub Actions)
// POSTs here with a shared secret; we:
//   1. get_due_toss_renewals() — subs due within 2 days of expiry (renew BEFORE the
//      period lapses so the plan card-limit never drops), with the stored billingKey +
//      the AGREED price (renewal_amount_krw snapshot) + a dunning attempt counter.
//   2. charge each billingKey. Idempotency-Key = renew:<sub>:<period>:<attempt> — a
//      network retry of the SAME attempt replays (no double-charge); a FAILED charge
//      bumps <attempt> so the next daily run is a genuinely fresh charge (dunning).
//   3. DONE + period extended → record renewal invoice, reset attempt. DONE but the
//      extend failed → leave the key alone so next run replays the captured payment.
//      FAILED → past_due + bump attempt.
//   4. expire_ended_toss_subscriptions() — flip canceled/stale-past_due to 'expired'.
//
// Deploy WITH verify_jwt=false (config.toml) — machine caller gated by TOSS_RENEW_SECRET
// (constant-time compared). Secrets: TOSS_SECRET_KEY, TOSS_RENEW_SECRET.

import { createClient } from '@supabase/supabase-js'
import { tossChargeBilling } from '../_shared/toss.ts'

const ENV = (k: string) => Deno.env.get(k)

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

// constant-time string compare (avoid token timing oracles)
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let r = 0
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return r === 0
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
  renewal_attempt: number
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const renewSecret = ENV('TOSS_RENEW_SECRET')
  if (!renewSecret) return json({ error: 'Not configured', code: 'NOT_CONFIGURED' }, 503)
  const auth = req.headers.get('Authorization') ?? ''
  if (!timingSafeEqual(auth, `Bearer ${renewSecret}`)) return json({ error: 'Unauthorized' }, 401)

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
    const attempt = r.renewal_attempt ?? 0
    const orderId = `toss_renew_${r.provider_subscription_id}_${new Date(r.current_period_end).getTime()}_${attempt}`
    // Key is stable per (period, attempt): a same-attempt retry replays; a FAILED charge
    // bumps attempt (below) so the next run gets a fresh key → dunning can recover.
    const idemKey = `renew:${r.provider_subscription_id}:${r.current_period_end}:${attempt}`

    const charge = await tossChargeBilling(secretKey, r.billing_key, {
      customerKey: r.customer_key,
      amount: r.price_krw,
      orderId,
      orderName: r.title ?? 'Subscription renewal',
      customerEmail: r.user_email,
    }, idemKey)

    if (charge.ok && charge.body?.status === 'DONE') {
      const { data: syncRes, error: syncErr } = await svc.rpc('sync_subscription', {
        p_provider: 'toss',
        p_provider_subscription_id: r.provider_subscription_id,
        p_status: 'active',
        p_period_end: newPeriodEnd,
        p_cancel_at_period_end: false,
      })
      const syncOk = !syncErr && (syncRes as { ok?: boolean } | null)?.ok === true
      if (!syncOk) {
        // Charged but the period did NOT extend. Do NOT bump the attempt — next run
        // replays the SAME captured payment (Idempotency-Key) and extends then. Never
        // records a paid invoice for a period that wasn't actually granted.
        console.error('[toss-renew] CHARGED but sync failed:', r.provider_subscription_id, syncErr?.message ?? JSON.stringify(syncRes))
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
      await svc.rpc('bump_toss_renewal_attempt', { p_provider_subscription_id: r.provider_subscription_id, p_reset: true })
      renewed++
    } else {
      console.error('[toss-renew] charge failed:', r.provider_subscription_id, charge.status, JSON.stringify(charge.body))
      await svc.rpc('sync_subscription', {
        p_provider: 'toss',
        p_provider_subscription_id: r.provider_subscription_id,
        p_status: 'past_due',
        p_period_end: null,
        p_cancel_at_period_end: null,
      })
      // Rotate the idempotency attempt so tomorrow's retry is a genuinely fresh charge.
      await svc.rpc('bump_toss_renewal_attempt', { p_provider_subscription_id: r.provider_subscription_id, p_reset: false })
      failed++
    }
  }

  const { data: expired } = await svc.rpc('expire_ended_toss_subscriptions')

  return json({ ok: true, due: rows.length, renewed, failed, expired: expired ?? 0 }, 200)
})
