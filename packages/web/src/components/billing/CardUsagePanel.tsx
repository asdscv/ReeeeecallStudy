import { useTranslation } from 'react-i18next'
import { Archive, Layers, Users, ShieldCheck, Infinity as InfinityIcon } from 'lucide-react'
import type { CardUsageDetail } from '@reeeeecall/shared/stores/deck-store'
import { isUnlimitedCardLimit } from './PlanSelector'

/**
 * Detailed owned-card usage panel (get_card_usage_detail, mig 137). Renders the split
 * behind the single "used" number the meter shows: a segmented bar (my cards vs
 * subscribed), utilization %, remaining, and a breakdown that names WHY the count
 * differs from total cards — official-deck cards are excluded from the cap, and any
 * over-cap excess is archived from study (never deleted). Pure presentation; the caller
 * fetches `detail`. Theme-aware via CSS tokens.
 */
export interface CardUsagePanelProps {
  detail: CardUsageDetail
  /** Optional plan display name (from billing-store). Falls back to a limit-derived label. */
  planName?: string
  className?: string
}

export function CardUsagePanel({ detail, planName, className = '' }: CardUsagePanelProps) {
  const { t } = useTranslation('settings')
  const unlimited = detail.isUnlimited || isUnlimitedCardLimit(detail.limit)

  const used = detail.usedTotal
  const limit = detail.limit
  const pct = unlimited ? 0 : Math.min(100, Math.round((used / Math.max(1, limit)) * 100))
  const ownPct = unlimited ? 0 : Math.min(100, (detail.ownedOwn / Math.max(1, limit)) * 100)
  const subPct = unlimited ? 0 : Math.min(100 - ownPct, (detail.ownedSubscribed / Math.max(1, limit)) * 100)

  const atLimit = !unlimited && detail.available <= 0
  const nearLimit = !unlimited && !atLimit && pct >= 80

  const plan =
    planName ??
    (unlimited
      ? t('cardUsage.detail.planUnlimited', 'Unlimited plan')
      : t('cardUsage.detail.planCards', '{{limit}} card plan', { limit: limit.toLocaleString() }))

  return (
    <div className={className}>
      {/* Header: plan + status chip */}
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-foreground truncate">{plan}</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {t('cardUsage.detail.subtitle', "Owned + subscribed cards. Official decks don't count.")}
          </p>
        </div>
        {atLimit ? (
          <span className="shrink-0 px-2.5 py-1 text-xs font-medium rounded-full bg-destructive/10 text-destructive">
            {t('cardUsage.detail.atLimit', 'Limit reached')}
          </span>
        ) : nearLimit ? (
          <span className="shrink-0 px-2.5 py-1 text-xs font-medium rounded-full bg-warning/10 text-warning">
            {t('cardUsage.detail.nearLimit', 'Approaching limit')}
          </span>
        ) : null}
      </div>

      {/* Big number + bar, or Unlimited hero */}
      {unlimited ? (
        <div className="mt-4 flex items-center gap-3 rounded-xl bg-accent/60 px-4 py-3">
          <InfinityIcon className="w-6 h-6 text-brand shrink-0" />
          <div>
            <p className="text-sm font-semibold text-foreground">
              {t('cardUsage.detail.unlimitedTitle', 'Unlimited storage')}
            </p>
            <p className="text-xs text-muted-foreground">
              {t('cardUsage.detail.lifetimeTotal', '{{count}} cards', { count: used })}
            </p>
          </div>
        </div>
      ) : (
        <>
          <div className="mt-4 flex items-baseline gap-2">
            <span
              className={`text-3xl font-bold tabular-nums ${atLimit ? 'text-destructive' : 'text-foreground'}`}
            >
              {used.toLocaleString()}
            </span>
            <span className="text-sm text-muted-foreground tabular-nums">
              / {limit.toLocaleString()}
            </span>
            <span className="ml-auto text-xs font-medium text-muted-foreground tabular-nums">
              {t('cardUsage.detail.percentUsed', '{{percent}}% used', { percent: pct })}
            </span>
          </div>

          {/* Segmented progress bar (own + subscribed) */}
          <div
            className="mt-2 flex h-2.5 w-full overflow-hidden rounded-full bg-accent"
            role="progressbar"
            aria-valuenow={Math.min(used, limit)}
            aria-valuemin={0}
            aria-valuemax={limit}
          >
            <div
              className={`h-full transition-all ${atLimit ? 'bg-destructive' : 'bg-brand'}`}
              style={{ width: `${ownPct}%` }}
            />
            <div
              className={`h-full transition-all ${atLimit ? 'bg-destructive/60' : 'bg-brand/45'}`}
              style={{ width: `${subPct}%` }}
            />
          </div>

          <p className={`mt-2 text-xs tabular-nums ${atLimit ? 'text-destructive' : 'text-muted-foreground'}`}>
            {atLimit
              ? t('cardUsage.reached')
              : t('cardUsage.detail.remaining', '{{count}} remaining', {
                  count: detail.available,
                })}
          </p>
        </>
      )}

      {/* Breakdown */}
      <ul className="mt-4 space-y-2.5">
        <BreakdownRow
          icon={<Layers className="w-4 h-4" />}
          dotClass="bg-brand"
          label={t('cardUsage.detail.own', 'My cards')}
          value={detail.ownedOwn}
        />
        <BreakdownRow
          icon={<Users className="w-4 h-4" />}
          dotClass="bg-brand/45"
          label={t('cardUsage.detail.subscribed', 'Subscribed')}
          value={detail.ownedSubscribed}
        />
        {detail.officialExcluded > 0 && (
          <BreakdownRow
            icon={<ShieldCheck className="w-4 h-4" />}
            dotClass="bg-muted-foreground/40"
            label={t('cardUsage.detail.official', 'Official decks')}
            note={t('cardUsage.detail.officialNote', 'Excluded from limit')}
            value={detail.officialExcluded}
            muted
          />
        )}
        {detail.archivedTotal > 0 && (
          <BreakdownRow
            icon={<Archive className="w-4 h-4" />}
            dotClass="bg-warning"
            label={t('cardUsage.detail.archived', 'Archived')}
            note={t('cardUsage.detail.archivedNote', 'Study locked')}
            value={detail.archivedTotal}
            warning
          />
        )}
      </ul>
    </div>
  )
}

function BreakdownRow({
  icon,
  dotClass,
  label,
  note,
  value,
  muted,
  warning,
}: {
  icon: React.ReactNode
  dotClass: string
  label: string
  note?: string
  value: number
  muted?: boolean
  warning?: boolean
}) {
  return (
    <li className="flex items-center gap-2.5">
      <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${dotClass}`} aria-hidden />
      <span className={`shrink-0 ${warning ? 'text-warning' : muted ? 'text-muted-foreground' : 'text-muted-foreground'}`}>
        {icon}
      </span>
      <span className={`text-sm ${warning ? 'text-warning' : 'text-foreground'}`}>{label}</span>
      {note && <span className="text-xs text-muted-foreground">· {note}</span>}
      <span className={`ml-auto text-sm font-semibold tabular-nums ${warning ? 'text-warning' : 'text-foreground'}`}>
        {value.toLocaleString()}
      </span>
    </li>
  )
}
