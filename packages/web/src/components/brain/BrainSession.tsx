import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { X, Flame } from 'lucide-react'
import { formatCount } from '@reeeeecall/shared/lib/format-number'
import { displayLevel } from '@reeeeecall/shared/lib/brain-games'
import { useBrainSession, type BrainMode, type SessionStats } from '@reeeeecall/shared/hooks/useBrainSession'
import { BrainBoard } from './BrainBoard'

/** One endless run. Unmounting it is how the run stops — every timer lives inside the hook. */
export function BrainSession({ mode, onFinish }: { mode: BrainMode; onFinish: (stats: SessionStats) => void }) {
  const { t } = useTranslation('brain')
  const s = useBrainSession(mode)
  const leveledUp = s.result !== null && displayLevel(s.result.levelAfter) > displayLevel(s.result.levelBefore)

  return (
    <div className="min-h-dvh flex flex-col bg-background">
      <header className="flex items-center gap-3 px-4 pt-4 pb-2 max-w-2xl w-full mx-auto">
        <button
          type="button"
          onClick={() => onFinish(s.stats)}
          className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-sm text-muted-foreground hover:bg-accent border-none bg-transparent cursor-pointer"
          data-testid="brain-finish"
        >
          <X className="w-4 h-4" aria-hidden="true" />
          {t('play.stop')}
        </button>
        <div className="flex-1 min-w-0 text-center">
          <p className="text-sm font-medium text-foreground truncate">
            {s.mode === 'mix' && <span className="text-brand mr-1.5">{t('play.mixBadge')} ·</span>}
            {t(`games.${s.gameId}.name`)}
          </p>
          <p className="text-xs text-content-tertiary" data-testid="brain-level">{t('home.level', { level: s.level })}</p>
        </div>
        <div className="text-right min-w-16">
          <p className="text-sm font-semibold text-foreground tabular-nums" data-testid="brain-score">{formatCount(s.stats.points)}</p>
          <p className="text-xs text-content-tertiary flex items-center justify-end gap-0.5">
            {s.stats.streak > 1 && <Flame className="w-3 h-3 text-warning" aria-hidden="true" />}
            {t('play.streak')} {s.stats.streak}
          </p>
        </div>
      </header>

      <div className="max-w-2xl w-full mx-auto px-4">
        <TimerBar key={s.roundId} timer={s.timer} />
      </div>

      <main className="flex-1 flex flex-col items-center justify-center gap-5 px-4 pb-8 max-w-2xl w-full mx-auto">
        <p className="text-base font-medium text-foreground text-center min-h-6" data-testid="brain-prompt">
          {t(s.view.prompt.key, s.view.prompt.params)}
        </p>
        <div className="w-full">
          <BrainBoard key={s.roundId} view={s.view} onTap={s.tap} />
        </div>
        <div className="h-8 flex items-center justify-center" aria-live="polite">
          {s.result && (
            <p
              className={`text-lg font-semibold ${s.result.correct ? 'text-success' : 'text-destructive'}`}
              data-testid="brain-result"
            >
              {s.result.correct ? t('play.correct') : s.result.timedOut ? t('play.timeUp') : t('play.wrong')}
              {s.result.points > 0 && <span className="ml-2 text-brand">{t('play.points', { value: formatCount(s.result.points) })}</span>}
              {leveledUp && <span className="ml-2 text-warning">{t('play.levelUp', { level: displayLevel(s.result.levelAfter) })}</span>}
            </p>
          )}
        </div>
      </main>
    </div>
  )
}

/** Drains from full to empty over the round's limit — one Web Animation, not a re-render per tick. */
function TimerBar({ timer }: { timer: { startedAt: number; limitMs: number } | null }) {
  const bar = useRef<HTMLDivElement>(null)
  const startedAt = timer?.startedAt
  const limitMs = timer?.limitMs
  useEffect(() => {
    const el = bar.current
    if (!el || startedAt === undefined || limitMs === undefined) return
    const elapsed = Math.max(0, Date.now() - startedAt)
    const from = Math.max(0, 1 - elapsed / limitMs)
    const anim = el.animate([{ transform: `scaleX(${from})` }, { transform: 'scaleX(0)' }], {
      duration: Math.max(0, limitMs - elapsed),
      easing: 'linear',
      fill: 'forwards',
    })
    return () => anim.cancel()
  }, [startedAt, limitMs])
  return (
    <div className="h-1.5 rounded-full bg-muted overflow-hidden">
      {timer && <div ref={bar} className="h-full w-full bg-brand rounded-full origin-left" />}
    </div>
  )
}
