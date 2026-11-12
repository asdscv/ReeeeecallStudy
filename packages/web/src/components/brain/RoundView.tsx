import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { X, Pause, Play, Heart } from 'lucide-react'
import { formatCount } from '@reeeeecall/shared/lib/format-number'
import { displayLevel, maxColsFor, type BrainGameId } from '@reeeeecall/shared/lib/brain-games'
import { useBrainRound, type RoundStats } from '@reeeeecall/shared/hooks/useBrainRound'
import { useBrainStore } from '@reeeeecall/shared/stores/brain-store'
import { BrainBoard } from './BrainBoard'
import { webPlatform } from './brain-ui'

/**
 * A round of one game, full screen. The board's width is measured first — the round is built for
 * it (the column cap keeps every cell ≥ 56px) — and then the round mounts.
 */
export function RoundView({ gameId, onOver, caption }: { gameId: BrainGameId; onOver: (stats: RoundStats) => void; caption?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState<number | null>(null)
  useLayoutEffect(() => {
    if (ref.current) setWidth(Math.min(ref.current.clientWidth, 560))
  }, [])
  return (
    <main className="min-h-dvh flex flex-col bg-background">
      <div ref={ref} className="max-w-2xl w-full mx-auto px-4">
        {width === null ? null : <Round gameId={gameId} onOver={onOver} caption={caption} width={width} />}
      </div>
    </main>
  )
}

function Round({ gameId, onOver, caption, width }: { gameId: BrainGameId; onOver: (stats: RoundStats) => void; caption?: string; width: number }) {
  const { t } = useTranslation('brain')
  const [platform] = useState(() => webPlatform(width, maxColsFor(width)))
  const r = useBrainRound(gameId, platform)
  const timing = useBrainStore((s) => s.progress.settings.timing)
  const variant = useBrainStore((s) => s.progress.quickEye.variant)
  const reported = useRef(false)
  // Number Hunt spends lives per wrong tap inside a grid; show them going as they go, not when the
  // grid ends.
  const liveLives = gameId === 'schulte' && typeof r.view.prompt.params?.lives === 'number' && !r.result ? Number(r.view.prompt.params.lives) : r.lives
  const leveledUp = r.result !== null && !r.result.practice && displayLevel(r.result.levelAfter) > displayLevel(r.result.levelBefore) && gameId !== 'quickEye'

  // On `done`, not `over`: one render later the personal-best flag is settled.
  useEffect(() => {
    if (r.done && !reported.current) {
      reported.current = true
      onOver(r.stats)
    }
  }, [r.done, r.stats, onOver])

  const finish = () => {
    if (r.stats.trials === 0 || window.confirm(t('play.stopConfirm'))) r.stop()
  }

  const levelText = gameId === 'quickEye' ? `${t('quickEye.stage', { stage: variant })} · ${Math.round(r.level)}/12` : t('home.level', { level: r.level })
  const resultText = !r.result
    ? null
    : r.result.void
      ? t('play.void')
      : r.result.correct
        ? t('play.correct')
        : r.result.timedOut
          ? r.result.livesLost === 0 && timing !== 1
            ? t('play.timeUpForgiven')
            : t('play.timeUp')
          : t('play.wrong')

  return (
    <>
      <header className="flex items-center gap-2 pt-4 pb-2">
        <button
          type="button"
          onClick={finish}
          className="flex items-center gap-1 min-h-11 px-3 rounded-lg text-sm text-muted-foreground hover:bg-accent border-none bg-transparent cursor-pointer"
          data-testid="brain-finish"
        >
          <X className="w-4 h-4" aria-hidden="true" />
          {t('play.stop')}
        </button>
        <div className="flex-1 min-w-0 text-center">
          {caption && <p className="text-xs text-muted-foreground">{caption}</p>}
          <h1 className="text-base font-semibold text-foreground truncate">{t(`games.${gameId}.name`)}</h1>
          <p className="text-sm text-muted-foreground" data-testid="brain-level">{levelText}</p>
        </div>
        <button
          type="button"
          onClick={r.paused ? r.resume : r.pause}
          disabled={!r.canPause}
          aria-label={r.paused ? t('play.resume') : t('play.pause')}
          className="w-11 h-11 flex items-center justify-center rounded-lg text-muted-foreground hover:bg-accent border-none bg-transparent cursor-pointer disabled:opacity-40"
          data-testid="brain-pause"
        >
          {r.paused ? <Play className="w-5 h-5" aria-hidden="true" /> : <Pause className="w-5 h-5" aria-hidden="true" />}
        </button>
        <p className="min-w-14 text-right text-base font-semibold text-foreground tabular-nums" data-testid="brain-score">
          {formatCount(r.stats.points)}
        </p>
      </header>

      {/* Chances, calm: no red flash, no countdown sound — gamification already makes a task feel harder. */}
      <div className="flex items-center justify-center gap-3 min-h-8" data-testid="brain-lives">
        {r.practice ? (
          <p className="text-sm text-brand-active font-medium">
            {t('play.practice', { done: Math.min(r.practiceTotal, r.practiceDone + (r.result ? 0 : 1)), total: r.practiceTotal })} · {t('play.practiceHint')}
          </p>
        ) : (
          <span
            className="flex items-center gap-1"
            role="img"
            aria-label={t(r.group === 'span' ? 'play.livesSpan' : 'play.lives', { value: liveLives })}
          >
            {Array.from({ length: r.maxLives }, (_, i) => (
              <Heart
                key={i}
                className={`w-5 h-5 ${i < liveLives ? 'fill-current text-foreground' : 'text-muted-foreground/50'}`}
                aria-hidden="true"
              />
            ))}
          </span>
        )}
        {r.roundCap !== null && !r.practice && (
          <span className="text-sm text-muted-foreground tabular-nums">{t('play.trial', { done: r.trialInRound, total: r.roundCap })}</span>
        )}
      </div>

      <TimerBar key={r.trialId} timer={r.timer} />

      <section className="relative flex flex-col items-center justify-center gap-5 pt-6 pb-10">
        <p className="text-lg font-medium text-foreground text-center min-h-7" data-testid="brain-prompt">
          {t(r.view.prompt.key, r.view.prompt.params)}
        </p>
        <div className="w-full">
          <BrainBoard key={r.trialId} view={r.view} onTap={r.tap} onExposure={r.reportExposure} width={width} />
        </div>
        <div className="min-h-8 flex items-center justify-center" aria-live="polite">
          {r.result && (
            <p
              className={`text-lg font-semibold ${r.result.void ? 'text-muted-foreground' : r.result.correct ? 'text-success' : 'text-destructive'}`}
              data-testid="brain-result"
            >
              {resultText}
              {r.result.points > 0 && <span className="ml-2 text-brand-active">{t('play.points', { value: formatCount(r.result.points) })}</span>}
              {leveledUp && <span className="ml-2 text-foreground">{t('play.levelUp', { level: displayLevel(r.result.levelAfter) })}</span>}
            </p>
          )}
        </div>

        {r.paused && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-background/95 rounded-2xl" data-testid="brain-paused">
            <p className="text-xl font-semibold text-foreground">{t('play.paused')}</p>
            <button
              type="button"
              onClick={r.resume}
              className="min-h-12 px-6 rounded-xl bg-brand text-white text-base font-semibold hover:bg-brand-hover border-none cursor-pointer"
            >
              {t('play.resume')}
            </button>
          </div>
        )}
      </section>
    </>
  )
}

/** Drains from full to empty over the trial's limit — one Web Animation, not a re-render per tick. */
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
    <div className="h-1.5 rounded-full bg-muted overflow-hidden mt-2">
      {timer && <div ref={bar} className="h-full w-full bg-brand rounded-full origin-left" />}
    </div>
  )
}
