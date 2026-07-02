import { useTranslation } from 'react-i18next'
import { useBillingStore, PAYMENTS_ENABLED } from '../../stores/billing-store'

const PRO_PRODUCT_ID = 'sub_pro_monthly'

/**
 * Card-limit "upgrade" CTA → subscribe to the Pro monthly plan. Payment is gated
 * OFF until a provider is wired: `startCheckout` flips a `comingSoon` flag (no
 * provider call) and we reveal a short coming-soon note under the button. Wired
 * and functional-shaped so it activates the moment VITE_PAYMENTS_ENABLED is true.
 */
export function SubscribeButton() {
  const { t } = useTranslation('billing')
  const startCheckout = useBillingStore((s) => s.startCheckout)
  const comingSoon = useBillingStore((s) => s.comingSoon)
  const checkoutProductId = useBillingStore((s) => s.checkoutProductId)
  const showSoon = comingSoon && checkoutProductId === PRO_PRODUCT_ID

  return (
    <div>
      <button
        type="button"
        onClick={() => void startCheckout(PRO_PRODUCT_ID)}
        title={PAYMENTS_ENABLED ? undefined : t('comingSoon.title')}
        className={
          PAYMENTS_ENABLED
            ? 'mt-2 cursor-pointer rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-hover'
            : 'mt-2 cursor-pointer rounded-lg bg-accent px-4 py-2 text-sm font-medium text-muted-foreground transition hover:bg-accent/70'
        }
      >
        {t('subscribe.cta')}
      </button>
      {showSoon && <p className="mt-2 text-xs text-muted-foreground">{t('comingSoon.body')}</p>}
    </div>
  )
}
