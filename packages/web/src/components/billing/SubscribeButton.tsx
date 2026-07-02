import { useTranslation } from 'react-i18next'
import { Loader2 } from 'lucide-react'
import { useBillingStore, PAYMENTS_ACTIVE } from '../../stores/billing-store'

const PRO_PRODUCT_ID = 'sub_pro_monthly'

/**
 * Card-limit "upgrade" CTA → subscribe to the Pro monthly plan. When no provider
 * is wired (VITE_PAYMENT_PROVIDER unset), `startCheckout` flips a `comingSoon` flag
 * (no provider call) and we reveal a short coming-soon note. With a provider live
 * it runs the real create_payment_intent → provider.checkout flow and reflects
 * processing / success / canceled state.
 */
export function SubscribeButton() {
  const { t } = useTranslation('billing')
  const startCheckout = useBillingStore((s) => s.startCheckout)
  const comingSoon = useBillingStore((s) => s.comingSoon)
  const checkoutProductId = useBillingStore((s) => s.checkoutProductId)
  const checkoutStatus = useBillingStore((s) => s.checkoutStatus)
  const error = useBillingStore((s) => s.error)

  const isThis = checkoutProductId === PRO_PRODUCT_ID
  const showSoon = comingSoon && isThis
  const processing = isThis && checkoutStatus === 'processing'
  const succeeded = isThis && checkoutStatus === 'success'
  const canceled = isThis && checkoutStatus === 'canceled'
  const failed = isThis && error === 'checkout_failed'

  return (
    <div>
      <button
        type="button"
        onClick={() => void startCheckout(PRO_PRODUCT_ID)}
        disabled={processing}
        title={PAYMENTS_ACTIVE ? undefined : t('comingSoon.title')}
        className={
          PAYMENTS_ACTIVE
            ? 'mt-2 flex items-center gap-1.5 cursor-pointer rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-hover disabled:opacity-60'
            : 'mt-2 cursor-pointer rounded-lg bg-accent px-4 py-2 text-sm font-medium text-muted-foreground transition hover:bg-accent/70'
        }
      >
        {processing && <Loader2 className="h-4 w-4 animate-spin" />}
        {t('subscribe.cta')}
      </button>
      {showSoon && <p className="mt-2 text-xs text-muted-foreground">{t('comingSoon.body')}</p>}
      {succeeded && <p className="mt-2 text-xs text-success">{t('subscribe.success')}</p>}
      {canceled && <p className="mt-2 text-xs text-muted-foreground">{t('checkout.canceled')}</p>}
      {failed && <p className="mt-2 text-xs text-destructive">{t('checkout.failed')}</p>}
    </div>
  )
}
