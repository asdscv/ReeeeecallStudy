// TossPayments webhook — reconcile out-of-band status changes (a refund/cancel done
// from the Toss dashboard, or an async virtual-account deposit).
//
// AUTHENTICITY: legacy payment webhooks (PAYMENT_STATUS_CHANGED) are UNSIGNED, so we
// NEVER trust the body — we re-fetch GET /v1/payments/{paymentKey} with the secret key
// and act only on the authoritative status. Best-effort + idempotent; always ACK 200
// (a non-200 makes Toss retry for ~4 days).
//
// Handled: a payment that became CANCELED / PARTIAL_CANCELED →
//   - subscription billing payment (matches a billing_invoices row) → revoke_subscription
//   - credit-pack order (matches a paid payment_intent) → clawback_credits + mark refunded
//
// Deploy WITH verify_jwt=false (Toss, not a user, calls this). Secret: TOSS_SECRET_KEY.

import { createClient } from '@supabase/supabase-js'
import { tossGetPayment } from '../_shared/toss.ts'

const ENV = (k: string) => Deno.env.get(k)

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const secretKey = ENV('TOSS_SECRET_KEY')
  if (!secretKey) return json({ received: true, note: 'unconfigured' }, 200) // ack; nothing to do

  let body: { eventType?: string; data?: Record<string, unknown> } | null = null
  try { body = await req.json() } catch { body = null }
  const eventType = body?.eventType
  const data = body?.data ?? {}
  const paymentKey = typeof data.paymentKey === 'string' ? data.paymentKey : null

  // Only payment-status events with a paymentKey are actionable here.
  if (eventType !== 'PAYMENT_STATUS_CHANGED' || !paymentKey) {
    return json({ received: true, event: eventType ?? null }, 200)
  }

  // Re-fetch the authoritative payment (never trust the unsigned body).
  const pay = await tossGetPayment(secretKey, paymentKey)
  if (!pay.ok) {
    console.error('[toss-webhook] re-fetch failed:', pay.status, paymentKey)
    return json({ received: true, note: 're-fetch failed' }, 200) // ack; don't loop
  }
  const status = pay.body?.status as string | undefined
  if (status !== 'CANCELED' && status !== 'PARTIAL_CANCELED') {
    return json({ received: true, status: status ?? null }, 200) // only refunds act here
  }

  // PARTIAL vs FULL cancel (P-H3): the re-fetched payment carries balanceAmount (remaining,
  // = totalAmount − Σ cancels) and a cancels[] history. A FULL cancel leaves balanceAmount 0
  // (or status CANCELED); a PARTIAL_CANCELED keeps balanceAmount > 0. Treating a partial like
  // a full cancel wrongly REVOKED the whole subscription / clawed back the FULL credit pack
  // on a small refund. Only reverse in full on a full cancel; on a partial, keep the sub and
  // claw back ONLY the refunded portion.
  const balanceAmount = Number((pay.body as Record<string, unknown> | undefined)?.balanceAmount ?? 0)
  const isFullCancel = status === 'CANCELED' || balanceAmount === 0
  const cancels = Array.isArray((pay.body as Record<string, unknown> | undefined)?.cancels)
    ? ((pay.body as Record<string, unknown>).cancels as Array<Record<string, unknown>>)
    : []
  const lastCancel = cancels.length > 0 ? cancels[cancels.length - 1] : null
  const cancelAmountWon = Number(lastCancel?.cancelAmount ?? 0)
  const cancelKey = lastCancel?.transactionKey != null ? String(lastCancel.transactionKey) : ''

  const svc = createClient(ENV('SUPABASE_URL')!, ENV('SUPABASE_SERVICE_ROLE_KEY')!)

  // (a) subscription billing charge? billing_invoices records the charge paymentKey.
  const { data: inv } = await svc
    .from('billing_invoices')
    .select('provider_subscription_id')
    .eq('provider', 'toss')
    .eq('provider_invoice_id', paymentKey)
    .maybeSingle()
  const subId = (inv as { provider_subscription_id?: string } | null)?.provider_subscription_id
  if (subId) {
    // A PARTIAL refund of a subscription charge must NOT terminate entitlement — keep the sub.
    if (!isFullCancel) {
      console.log('[toss-webhook] partial cancel of subscription charge — keeping sub', subId, 'balance', balanceAmount)
      return json({ received: true, action: 'partial_cancel_subscription_kept', balance: balanceAmount }, 200)
    }
    const { error } = await svc.rpc('revoke_subscription', {
      p_provider: 'toss',
      p_provider_subscription_id: subId,
    })
    if (error) console.error('[toss-webhook] revoke failed:', error.message)
    return json({ received: true, action: 'revoked_subscription' }, 200)
  }

  // (b) credit-pack order? payment_intents stamps provider_payment_id = paymentKey.
  const { data: intent } = await svc
    .from('payment_intents')
    .select('merchant_uid, kind, status')
    .eq('provider', 'toss')
    .eq('provider_payment_id', paymentKey)
    .maybeSingle()
  const it = intent as { merchant_uid: string; kind: string; status: string } | null
  if (it && it.kind === 'credit_pack' && (it.status === 'paid' || it.status === 'refunded')) {
    if (isFullCancel) {
      const { error } = await svc.rpc('clawback_credits', { p_merchant_uid: it.merchant_uid })
      if (error) console.error('[toss-webhook] clawback failed:', error.message)
      return json({ received: true, action: 'clawed_back_credits' }, 200)
    }
    // Partial credit-pack refund → reverse ONLY the refunded portion, idempotent per cancel key.
    const refundedMicro = Math.round(cancelAmountWon) * 1_000_000
    if (refundedMicro <= 0 || !cancelKey) {
      console.warn('[toss-webhook] partial cancel with no resolvable cancel amount/key — acking', paymentKey)
      return json({ received: true, action: 'partial_cancel_noop' }, 200)
    }
    const { error } = await svc.rpc('clawback_credits_partial', {
      p_merchant_uid: it.merchant_uid,
      p_amount_micro: refundedMicro,
      p_ref: it.merchant_uid + ':' + cancelKey,
    })
    if (error) console.error('[toss-webhook] partial clawback failed:', error.message)
    return json({ received: true, action: 'clawed_back_credits_partial', clawed_micro: refundedMicro }, 200)
  }

  return json({ received: true, action: 'none' }, 200)
})
