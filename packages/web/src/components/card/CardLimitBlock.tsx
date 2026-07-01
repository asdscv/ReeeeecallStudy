import { useTranslation } from 'react-i18next'

/**
 * Inline block shown on card-creation surfaces when the owned-card limit is
 * reached/would be exceeded. Server (mig 116) is the authority; this is pre-flight
 * UX. The Subscribe CTA is a disabled placeholder until payment (Phase 2) lands.
 */
export function CardLimitBlock() {
  const { t } = useTranslation(['errors', 'settings'])
  return (
    <div className="p-3 bg-destructive/10 text-destructive rounded-lg">
      <p className="text-sm font-medium">{t('errors:card.limitReached')}</p>
      <p className="text-xs text-destructive/80 mt-1">{t('settings:cardUsage.reached')}</p>
      <button
        type="button"
        disabled
        className="mt-2 px-3 py-1.5 bg-brand/20 text-brand rounded text-xs opacity-50 cursor-not-allowed"
      >
        {t('settings:cardUsage.subscribe')}
      </button>
    </div>
  )
}
