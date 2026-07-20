import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CreditCard, ChevronRight, Archive } from 'lucide-react'
import { useDeckStore } from '../../stores/deck-store'
import { registerCardUsageDetailInterest, releaseCardUsageDetailInterest } from '@reeeeecall/shared/stores/deck-store'
import { isUnlimitedCardLimit } from './PlanSelector'
import { CardUsageModal } from './CardUsageModal'

/**
 * Compact card-storage widget for the Dashboard — an at-a-glance meter so users near
 * the cap get a proactive signal instead of the number being buried in Settings.
 * Tapping opens the full CardUsageModal. Renders nothing until usage is known.
 */
export function CardUsageCard() {
  const { t } = useTranslation('settings')
  const detail = useDeckStore((s) => s.cardUsageDetail)
  const fetchDetail = useDeckStore((s) => s.fetchCardUsageDetail)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    registerCardUsageDetailInterest()
    void fetchDetail()
    return () => releaseCardUsageDetailInterest()
  }, [fetchDetail])

  // Skeleton (not null) while loading → no layout shift when the card pops in. Tapping
  // force-refetches so a transient first-fetch failure can't strand a permanent skeleton.
  if (!detail) {
    return (
      <button
        type="button"
        onClick={() => void fetchDetail({ force: true })}
        className="w-full rounded-2xl border border-border bg-card p-4 text-left"
        data-testid="dashboard-card-usage-skeleton"
        aria-label={t('cardUsage.detail.title')}
      >
        <div className="h-4 w-28 rounded bg-accent animate-pulse" />
        <div className="mt-3 h-7 w-24 rounded bg-accent animate-pulse" />
        <div className="mt-2 h-1.5 w-full rounded-full bg-accent animate-pulse" />
      </button>
    )
  }

  const unlimited = detail.isUnlimited || isUnlimitedCardLimit(detail.limit)
  const pct = unlimited ? 0 : Math.min(100, Math.round((detail.usedTotal / Math.max(1, detail.limit)) * 100))
  const atLimit = !unlimited && detail.available <= 0
  const nearLimit = !unlimited && !atLimit && pct >= 80

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="group w-full rounded-2xl border border-border bg-card p-4 text-left transition-colors hover:bg-accent/40"
        data-testid="dashboard-card-usage"
      >
        <div className="flex items-center gap-2">
          <CreditCard className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium text-foreground">{t('cardUsage.detail.title', 'Card storage')}</span>
          {atLimit && (
            <span className="ml-1 px-2 py-0.5 text-[10px] font-medium rounded-full bg-destructive/10 text-destructive">
              {t('cardUsage.detail.atLimit', 'Limit reached')}
            </span>
          )}
          {nearLimit && (
            <span className="ml-1 px-2 py-0.5 text-[10px] font-medium rounded-full bg-warning/10 text-warning">
              {t('cardUsage.detail.nearLimit', 'Approaching limit')}
            </span>
          )}
          <ChevronRight className="ml-auto h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
        </div>

        <div className="mt-3 flex items-baseline gap-1.5">
          <span className={`text-2xl font-bold tabular-nums ${atLimit ? 'text-destructive' : 'text-foreground'}`}>
            {detail.usedTotal.toLocaleString()}
          </span>
          <span className="text-xs text-muted-foreground tabular-nums">
            {unlimited
              ? t('cardUsage.detail.planUnlimited', 'Unlimited plan')
              : `/ ${detail.limit.toLocaleString()}`}
          </span>
        </div>

        {!unlimited && (
          <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-accent">
            <div
              className={`h-full rounded-full transition-all ${atLimit ? 'bg-destructive' : nearLimit ? 'bg-warning' : 'bg-brand'}`}
              style={{ width: `${pct}%` }}
            />
          </div>
        )}

        {detail.archivedTotal > 0 && (
          <p className="mt-2 flex items-center gap-1 text-[11px] text-warning">
            <Archive className="h-3 w-3" />
            {t('cardUsage.detail.archivedCount', '{{count}} archived', { count: detail.archivedTotal })}
          </p>
        )}
      </button>

      <CardUsageModal open={open} onClose={() => setOpen(false)} />
    </>
  )
}
