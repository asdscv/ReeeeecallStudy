import { useEffect, useRef, useState } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Loader2 } from 'lucide-react'
import { supabase } from '../../lib/supabase'

// TossPayments checkout host (opens in the new tab the billing store pre-opened).
// Reads only the server-issued merchant_uid, re-reads the intent (RLS: own) for the
// KRW amount + kind, loads the Toss SDK, and hands off:
//   credit_pack  → payment.requestPayment (one-time)
//   subscription → payment.requestBillingAuth (card registration → billing key)
// Toss then redirects to /checkout/toss/return, which confirms server-side.
const TOSS_CLIENT_KEY = String(import.meta.env.VITE_TOSS_CLIENT_KEY ?? '').trim()

export function TossCheckoutPage() {
  const { t } = useTranslation('billing')
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const mu = params.get('mu') ?? ''
  const [error, setError] = useState<string | null>(null)
  const startedRef = useRef(false)
  const closeOrReturn = () => {
    if (window.opener) window.close()
    else navigate('/settings', { replace: true })
  }

  useEffect(() => {
    if (startedRef.current) return
    startedRef.current = true

    void (async () => {
      try {
        if (!mu) return setError('unknown_order')
        if (!TOSS_CLIENT_KEY) return setError('not_configured')

        // SERVER-authoritative intent (RLS: caller reads own).
        const { data: intent } = await supabase
          .from('payment_intents')
          .select('kind, amount_krw, product_id, status')
          .eq('merchant_uid', mu)
          .maybeSingle()
        const it = intent as
          | { kind: string; amount_krw: number; product_id: string; status: string }
          | null
        if (!it) return setError('unknown_order')
        if (it.status !== 'pending') return setError('already_processed')

        // Product title for orderName (best-effort; Toss needs 1–100 chars).
        let orderName = 'ReeeeecallStudy'
        try {
          const { data: prods } = await supabase.rpc('get_billing_products')
          const p = ((prods ?? []) as Array<{ id: string; title: string }>).find((x) => x.id === it.product_id)
          if (p?.title) orderName = p.title
        } catch { /* keep default */ }

        const email = (await supabase.auth.getSession()).data.session?.user?.email ?? undefined
        const origin = window.location.origin
        const { loadTossPayments, ANONYMOUS } = await import('@tosspayments/tosspayments-sdk')
        const tossPayments = await loadTossPayments(TOSS_CLIENT_KEY)

        if (it.kind === 'subscription') {
          // Recurring: register a card (billing auth). customerKey is stable per user.
          const { data: customerKey } = await supabase.rpc('get_or_create_toss_customer_key')
          if (!customerKey) return setError('failed')
          const payment = tossPayments.payment({ customerKey: String(customerKey) })
          await payment.requestBillingAuth({
            method: 'CARD',
            successUrl: `${origin}/checkout/toss/return?flow=billing&mu=${encodeURIComponent(mu)}`,
            failUrl: `${origin}/checkout/toss/return?flow=billing&failed=1`,
            customerEmail: email,
            windowTarget: 'self',
          })
        } else {
          // One-time credit pack.
          const payment = tossPayments.payment({ customerKey: ANONYMOUS })
          await payment.requestPayment({
            method: 'CARD',
            amount: { currency: 'KRW', value: it.amount_krw },
            orderId: mu,
            orderName,
            successUrl: `${origin}/checkout/toss/return`,
            failUrl: `${origin}/checkout/toss/return?failed=1`,
            customerEmail: email,
            windowTarget: 'self',
          })
        }
      } catch (e) {
        console.error('[toss-checkout]', e)
        setError('failed')
      }
    })()
  }, [mu])

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-background p-6 text-center">
      {error ? (
        <>
          <p className="text-sm font-medium text-destructive">
            {t(`toss.error.${error}`, { defaultValue: t('toss.error.failed') })}
          </p>
          <button
            onClick={closeOrReturn}
            className="rounded-lg border border-border bg-card px-4 py-2 text-sm font-medium text-foreground hover:bg-accent"
          >
            {t('toss.close')}
          </button>
        </>
      ) : (
        <>
          <Loader2 className="h-6 w-6 animate-spin text-brand" />
          <p className="text-sm text-muted-foreground">{t('toss.opening')}</p>
        </>
      )}
    </div>
  )
}
