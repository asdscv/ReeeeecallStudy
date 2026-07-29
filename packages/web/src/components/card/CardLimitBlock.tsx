import { useTranslation } from 'react-i18next'
import { SubscribeButton } from '../billing/SubscribeButton'

/**
 * Inline block shown on card-creation surfaces when the owned-card limit is
 * reached/would be exceeded. Server (mig 116) is the authority; this is pre-flight
 * UX.
 *
 * The upgrade CTA is the data-driven {@link SubscribeButton} (never a hardcoded
 * disabled stub): it targets the cheapest active plan from the billing catalog and
 * starts the real checkout when payments are live (PAYMENTS_ACTIVE), or shows an
 * honest "coming soon" note while the provider is still gated off — so the user is
 * never left at a dead-end button. If the catalog has no active plan it fails closed
 * and renders nothing, leaving just the limit message.
 */
export function CardLimitBlock() {
  const { t } = useTranslation(['errors', 'settings'])
  return (
    <div className="p-3 bg-destructive/10 rounded-lg">
      <p className="text-sm font-medium text-destructive">{t('errors:card.limitReached')}</p>
      <p className="text-xs text-destructive/80 mt-1">{t('settings:cardUsage.reached')}</p>
      <SubscribeButton />
    </div>
  )
}
