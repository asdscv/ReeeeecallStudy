import { useTranslation } from 'react-i18next'
import { Crown, Gem, Medal } from 'lucide-react'
import { tierLook, type TierStanding } from './tier-ui'

/** The tier's medal: a medal for the first three, a gem for the next two, a crown for master. */
function TierIcon({ tier, className }: { tier: number; className: string }) {
  if (tier <= 0) return null
  const Icon = tier >= 6 ? Crown : tier >= 4 ? Gem : Medal
  return <Icon className={className} aria-hidden="true" />
}

const SIZES = {
  sm: { box: 'h-7 px-2.5 gap-1 text-sm', icon: 'w-3.5 h-3.5' },
  md: { box: 'h-9 px-3 gap-1.5 text-base', icon: 'w-4 h-4' },
} as const

/** A game's tier as a chip — the name in the tier's colours (0: "no tier yet", quietly). `label` replaces the name (e.g. "Gold reached!"). */
export function TierBadge({ tier, size = 'md', label, testId }: { tier: number; size?: keyof typeof SIZES; label?: string; testId?: string }) {
  const { t } = useTranslation('brain')
  const look = tierLook(tier)
  const s = SIZES[size]
  return (
    <span
      className={`inline-flex items-center shrink-0 rounded-full font-bold whitespace-nowrap ${s.box} ${tier > 0 ? 'shadow-[0_4px_14px_rgba(0,0,0,0.25)]' : ''}`}
      style={{ background: look.bg, color: look.fg }}
      data-testid={testId}
    >
      <TierIcon tier={tier} className={s.icon} />
      {label ?? (
        <>
          {tier > 0 && <span className="sr-only">{t('tiers.label')} </span>}
          {tier > 0 ? t(`tiers.t${tier}`) : t('tiers.none')}
        </>
      )}
    </span>
  )
}

/** The tier as a big medal — the tier-up moment's centrepiece. */
export function TierMedal({ tier }: { tier: number }) {
  const look = tierLook(tier)
  return (
    <span
      className="relative w-28 h-28 rounded-full flex items-center justify-center"
      style={{ background: look.bg, color: look.fg, boxShadow: `0 0 0 6px rgba(255,255,255,0.12), 0 0 70px ${look.solid}`, animation: 'bfx-pop 420ms cubic-bezier(.2,.9,.3,1.4) both' }}
      aria-hidden="true"
    >
      <TierIcon tier={tier} className="w-14 h-14" />
    </span>
  )
}

/** The bar toward the next tier (full at the top). */
export function TierBar({ standing, fill, track = 'rgba(255,255,255,0.12)', height = 'h-2' }: { standing: TierStanding; fill: string; track?: string; height?: string }) {
  const { t } = useTranslation('brain')
  const label = standing.max ? t('tiers.max') : `${t('tiers.next')} · ${t(`tiers.t${standing.tier + 1}`)}`
  const pct = Math.round(standing.frac * 100)
  return (
    <div
      className={`${height} rounded-full overflow-hidden`}
      style={{ background: track }}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
      aria-label={label}
    >
      <div
        className="h-full rounded-full"
        style={{ width: `${standing.frac > 0 ? Math.max(4, pct) : 0}%`, background: fill, transition: 'width 900ms cubic-bezier(.2,.8,.2,1)' }}
      />
    </div>
  )
}

/**
 * The tier panel on the game's canvas: the tier reached, what comes next and how far there is to
 * go. One game's own ladder — never a total or an average across games.
 */
export function TierMeter({ standing, accent, compact = false, testId }: { standing: TierStanding; accent: string; compact?: boolean; testId?: string }) {
  const { t } = useTranslation('brain')
  const next = standing.max ? null : standing.tier + 1
  return (
    <div className={compact ? 'w-full max-w-xs mx-auto space-y-2' : 'rounded-2xl bg-white/[0.07] border border-white/10 p-4 space-y-3'} data-testid={testId}>
      <div className="flex items-center justify-between gap-3">
        <TierBadge tier={standing.tier} size={compact ? 'sm' : 'md'} />
        <span className="text-sm font-medium text-white/80 text-right min-w-0">
          {next === null ? (
            t('tiers.max')
          ) : (
            <>
              {t('tiers.next')} <span className="font-bold" style={{ color: tierColor(next) }}>{t(`tiers.t${next}`)}</span>
            </>
          )}
        </span>
      </div>
      <TierBar standing={standing} fill={next === null ? tierColor(6) : accent} height={compact ? 'h-1.5' : 'h-2.5'} />
    </div>
  )
}

function tierColor(tier: number): string {
  return tierLook(tier).solid
}
