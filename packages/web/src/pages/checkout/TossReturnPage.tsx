import { useEffect, useRef, useState } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Loader2, CheckCircle2, XCircle } from 'lucide-react'
import { supabase } from '../../lib/supabase'

// TossPayments redirect landing (in the checkout tab). Toss appends:
//   one-time → ?paymentType&amount&orderId&paymentKey
//   billing  → ?flow=billing&mu=<merchant_uid>&customerKey&authKey
// We POST the result to the SERVER (toss-confirm / toss-billing), which verifies with
// the secret key and grants. The app tab is separately polling the intent, so it also
// updates. This page just shows the outcome; the user can close it.
export function TossReturnPage() {
  const { t } = useTranslation('billing')
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const [state, setState] = useState<'processing' | 'success' | 'error'>('processing')
  const ranRef = useRef(false)

  // New-tab flow (opened by the billing store) → close this tab. Same-tab fallback
  // (popup blocked → we navigated here in place) has no opener → return into the app
  // instead of a dead close button.
  const closeOrReturn = () => {
    if (window.opener) window.close()
    else navigate('/settings', { replace: true })
  }

  useEffect(() => {
    if (ranRef.current) return
    ranRef.current = true

    void (async () => {
      if (params.get('failed')) return setState('error')
      try {
        if (params.get('flow') === 'billing') {
          const authKey = params.get('authKey')
          const customerKey = params.get('customerKey')
          const mu = params.get('mu')
          if (!authKey || !customerKey || !mu) return setState('error')
          const { data, error } = await supabase.functions.invoke('toss-billing', {
            body: { authKey, customerKey, merchantUid: mu },
          })
          setState(!error && (data as { ok?: boolean } | null)?.ok ? 'success' : 'error')
        } else {
          const paymentKey = params.get('paymentKey')
          const orderId = params.get('orderId')
          const amount = Number(params.get('amount'))
          if (!paymentKey || !orderId || !Number.isFinite(amount)) return setState('error')
          const { data, error } = await supabase.functions.invoke('toss-confirm', {
            body: { paymentKey, orderId, amount },
          })
          setState(!error && (data as { ok?: boolean } | null)?.ok ? 'success' : 'error')
        }
      } catch {
        setState('error')
      }
    })()
  }, [params])

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-background p-6 text-center">
      {state === 'processing' && (
        <>
          <Loader2 className="h-6 w-6 animate-spin text-brand" />
          <p className="text-sm text-muted-foreground">{t('toss.confirming')}</p>
        </>
      )}
      {state === 'success' && (
        <>
          <CheckCircle2 className="h-8 w-8 text-success" />
          <p className="text-base font-semibold text-foreground">{t('toss.success.title')}</p>
          <p className="text-sm text-muted-foreground">{t('toss.success.body')}</p>
          <button
            onClick={closeOrReturn}
            className="mt-2 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-hover"
          >
            {t('toss.close')}
          </button>
        </>
      )}
      {state === 'error' && (
        <>
          <XCircle className="h-8 w-8 text-destructive" />
          <p className="text-base font-semibold text-foreground">{t('toss.error.title')}</p>
          <p className="text-sm text-muted-foreground">{t('toss.error.body')}</p>
          <button
            onClick={closeOrReturn}
            className="mt-2 rounded-lg border border-border bg-card px-4 py-2 text-sm font-medium text-foreground hover:bg-accent"
          >
            {t('toss.close')}
          </button>
        </>
      )}
    </div>
  )
}
