import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { formatCount } from '@reeeeecall/shared/lib/format-number'
import { displayLevel, type BrainGameId } from '@reeeeecall/shared/lib/brain-games'
import type { RoundStats } from '@reeeeecall/shared/hooks/useBrainRound'

/**
 * The end of a free-practice round. It opens with what went up — the level and any personal best —
 * and says the level is this game's record only, never a measure of memory.
 */
export function RoundSummary({ gameId, stats, onAgain }: { gameId: BrainGameId; stats: RoundStats; onAgain: () => void }) {
  const { t } = useTranslation('brain')
  const accuracy = stats.trials > 0 ? Math.round((stats.correct / stats.trials) * 100) : 0
  const title = stats.endedBy === 'cap' ? t('summary.cleared') : stats.endedBy === 'stop' ? t('summary.stopped') : t('summary.livesOut')
  // Quick Eye's level is a 0-12 speed step, shown whole like on its card.
  const qe = gameId === 'quickEye'
  const from = qe ? Math.round(stats.levelStart) : displayLevel(stats.levelStart)
  const to = qe ? Math.round(stats.levelEnd) : displayLevel(stats.levelEnd)
  return (
    <div className="min-h-dvh flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm p-6 bg-card rounded-2xl border border-border space-y-5" data-testid="brain-summary">
        <div className="text-center space-y-1">
          <p className="text-sm text-muted-foreground">{t(`games.${gameId}.name`)}</p>
          <h1 className="text-2xl font-semibold text-foreground">{title}</h1>
        </div>
        {stats.trials > 0 && (
          <p className="text-center text-base text-foreground">
            {t('summary.levelChange', { from, to })}{qe ? '/12' : ''}
            {to > from && <span className="block text-sm text-success mt-1">{t('summary.improved')}</span>}
          </p>
        )}
        {stats.isNewBest && (
          <p className="text-center text-sm font-semibold text-brand-active bg-brand/10 rounded-lg py-2">{t('summary.newBest')}</p>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Stat label={t('summary.trials')} value={formatCount(stats.trials)} />
          <Stat label={t('summary.accuracy')} value={`${accuracy}%`} />
          <Stat label={t('summary.points')} value={formatCount(stats.points)} />
          <Stat label={t('summary.bestStreak')} value={formatCount(stats.bestStreak)} />
        </div>
        <div className="flex gap-2">
          <Link
            to="/brain"
            className="flex-1 flex items-center justify-center min-h-12 px-3 text-base font-medium rounded-xl border border-border text-foreground no-underline hover:bg-accent"
          >
            {t('summary.home')}
          </Link>
          <button
            type="button"
            onClick={onAgain}
            className="flex-1 min-h-12 px-3 text-base font-semibold rounded-xl bg-brand text-brand-foreground hover:bg-brand-hover border-none cursor-pointer"
            data-testid="brain-again"
          >
            {t('summary.again')}
          </button>
        </div>
      </div>
    </div>
  )
}

export function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="p-3 rounded-xl bg-muted text-center">
      <p className="text-2xl font-semibold text-foreground tabular-nums">{value}</p>
      <p className="text-sm text-muted-foreground">{label}</p>
    </div>
  )
}
