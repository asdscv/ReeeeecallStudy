import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { formatCount } from '@reeeeecall/shared/lib/format-number'
import { displayLevel, type BrainGameId } from '@reeeeecall/shared/lib/brain-games'
import type { SessionStats } from '@reeeeecall/shared/hooks/useBrainSession'

export function BrainSummary({ stats, onAgain }: { stats: SessionStats; onAgain: () => void }) {
  const { t } = useTranslation('brain')
  const accuracy = stats.rounds > 0 ? Math.round((stats.correct / stats.rounds) * 100) : 0
  const levels = Object.entries(stats.levels) as [BrainGameId, { start: number; now: number }][]
  return (
    <div className="min-h-dvh flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm p-6 bg-card rounded-2xl border border-border space-y-5" data-testid="brain-summary">
        <h1 className="text-xl font-semibold text-foreground text-center">{t('summary.title')}</h1>
        <div className="grid grid-cols-2 gap-3">
          <Stat label={t('summary.rounds')} value={formatCount(stats.rounds)} />
          <Stat label={t('summary.accuracy')} value={`${accuracy}%`} />
          <Stat label={t('summary.points')} value={formatCount(stats.points)} />
          <Stat label={t('summary.bestStreak')} value={formatCount(stats.bestStreak)} />
        </div>
        {levels.length > 0 && (
          <div>
            <p className="text-xs text-content-tertiary mb-2">{t('summary.levels')}</p>
            <ul className="space-y-1">
              {levels.map(([id, l]) => {
                const from = displayLevel(l.start)
                const to = displayLevel(l.now)
                return (
                  <li key={id} className="flex justify-between text-sm">
                    <span className="text-foreground">{t(`games.${id}.name`)}</span>
                    <span className={to > from ? 'text-success' : to < from ? 'text-destructive' : 'text-muted-foreground'}>
                      Lv. {from} → {to}
                    </span>
                  </li>
                )
              })}
            </ul>
          </div>
        )}
        <div className="flex gap-2">
          <Link
            to="/brain"
            className="flex-1 text-center px-3 py-2.5 text-sm font-medium rounded-lg border border-border text-foreground no-underline hover:bg-accent"
          >
            {t('summary.home')}
          </Link>
          <button
            type="button"
            onClick={onAgain}
            className="flex-1 px-3 py-2.5 text-sm font-medium rounded-lg bg-brand text-white hover:bg-brand-hover border-none cursor-pointer"
            data-testid="brain-again"
          >
            {t('summary.again')}
          </button>
        </div>
      </div>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="p-3 rounded-xl bg-muted text-center">
      <p className="text-xl font-semibold text-foreground tabular-nums">{value}</p>
      <p className="text-xs text-content-tertiary">{label}</p>
    </div>
  )
}
