import { useCallback, useEffect, useRef } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { formatCount } from '@reeeeecall/shared/lib/format-number'
import { brainGame, courseStatus, displayLevel, localDayKey, weekProgress, type BrainGameId } from '@reeeeecall/shared/lib/brain-games'
import { useTodaysTraining } from '@reeeeecall/shared/hooks/useTodaysTraining'
import type { RoundStats } from '@reeeeecall/shared/hooks/useBrainRound'
import { useBrainStore } from '@reeeeecall/shared/stores/brain-store'
import { useTrackEvent } from '../../hooks/useTrackEvent'
import { RoundView } from '../../components/brain/RoundView'
import { Stat } from '../../components/brain/RoundSummary'
import { BRAIN_ICONS } from '../../components/brain/brain-ui'
import { useBrainHydrated } from '../../components/brain/useBrainHydrated'

/** `/brain/training` — Today's Training. Waits for the player's progress, which plans the session. */
export function BrainTrainingPage() {
  useTranslation('brain')
  const ready = useBrainHydrated()
  return ready ? <Training /> : null
}

function Training() {
  const { t } = useTranslation('brain')
  const s = useTodaysTraining()
  const navigate = useNavigate()
  const trackEvent = useTrackEvent()
  const progress = useBrainStore((st) => st.progress)
  const onOver = useCallback((stats: RoundStats) => s.onRoundOver(s.slot.gameId, stats), [s])
  const reported = useRef(false)
  useEffect(() => {
    if (s.phase === 'done' && !reported.current) {
      reported.current = true
      trackEvent({ category: 'brain', action: 'training_done', value: s.totals.trials })
    }
  }, [s.phase, s.totals.trials, trackEvent])

  if (s.phase === 'playing') {
    return (
      <RoundView
        key={s.roundKey}
        gameId={s.slot.gameId}
        caption={`${t('training.title')} · ${t('training.slot', { index: s.slotIndex + 1, total: s.slots.length })}`}
        onOver={onOver}
      />
    )
  }

  if (s.phase === 'between' && s.next) {
    const entry = brainGame(s.next.gameId)
    const Icon = BRAIN_ICONS[entry.icon]
    return (
      <Centered>
        <p className="text-sm text-muted-foreground">{t('training.slot', { index: s.slotIndex + 2, total: s.slots.length })}</p>
        <h1 className="text-xl font-semibold text-foreground">{t('training.next')}</h1>
        <div className="flex items-center gap-3 p-4 rounded-xl bg-muted text-left">
          <div className="w-12 h-12 rounded-lg bg-brand/10 text-brand-active flex items-center justify-center shrink-0">
            {Icon && <Icon className="w-6 h-6" aria-hidden="true" />}
          </div>
          <div>
            <p className="text-lg font-semibold text-foreground">{t(`games.${s.next.gameId}.name`)}</p>
            <p className="text-sm text-muted-foreground">{t(`games.${s.next.gameId}.desc`)}</p>
          </div>
        </div>
        <button
          type="button"
          onClick={s.continueSession}
          className="w-full min-h-14 rounded-xl bg-brand text-brand-foreground text-lg font-semibold hover:bg-brand-hover border-none cursor-pointer"
          data-testid="brain-training-continue"
        >
          {t('training.continue')}
        </button>
        {/* A way out between games, not only mid-round. Rounds so far are saved; the session is not counted. */}
        <button
          type="button"
          onClick={() => { if (window.confirm(t('play.stopConfirm'))) navigate('/brain') }}
          className="w-full min-h-12 rounded-xl border border-border bg-transparent text-base text-muted-foreground hover:bg-accent cursor-pointer"
          data-testid="brain-training-stop"
        >
          {t('play.stop')}
        </button>
      </Centered>
    )
  }

  const today = localDayKey()
  const week = weekProgress(progress, today)
  const course = courseStatus(progress, today)
  const done = s.phase === 'done'
  const accuracy = s.totals.trials > 0 ? Math.round((s.totals.correct / s.totals.trials) * 100) : 0
  const levels = Object.entries(s.totals.levels) as [BrainGameId, { start: number; end: number }][]
  return (
    <Centered>
      <h1 className="text-2xl font-semibold text-foreground">{done ? t('training.doneTitle') : t('training.quitTitle')}</h1>
      <p className="text-base text-muted-foreground">{done ? t('training.doneBody') : t('training.quitBody')}</p>
      {done && (
        <div className="flex flex-wrap justify-center gap-2 text-sm">
          <span className="px-3 py-1 rounded-full bg-muted text-foreground">
            {week.done >= week.goal ? t('training.weekDone') : t('training.week', { done: week.done, goal: week.goal })}
          </span>
          <span className="px-3 py-1 rounded-full bg-muted text-foreground">
            {course.phase === 'booster' && course.booster
              ? t('training.booster', { done: course.booster.done, total: course.booster.total })
              : t('training.course', { done: course.coreDone, total: course.coreTotal })}
          </span>
        </div>
      )}
      <div className="grid grid-cols-2 gap-3 w-full">
        <Stat label={t('summary.trials')} value={formatCount(s.totals.trials)} />
        <Stat label={t('summary.accuracy')} value={`${accuracy}%`} />
      </div>
      {levels.length > 0 && (
        <ul className="w-full space-y-1 text-left">
          {levels.map(([id, l]) => {
            // Quick Eye's level is a 0-12 speed step, shown whole like on its card.
            const qe = id === 'quickEye'
            const from = qe ? Math.round(l.start) : displayLevel(l.start)
            const to = qe ? Math.round(l.end) : displayLevel(l.end)
            return (
              <li key={id} className="flex justify-between text-base">
                <span className="text-foreground">{t(`games.${id}.name`)}</span>
                <span className={to > from ? 'text-success' : 'text-muted-foreground'}>
                  {t('summary.levelChange', { from, to })}{qe ? '/12' : ''}
                </span>
              </li>
            )
          })}
        </ul>
      )}
      <Link
        to="/brain"
        className="w-full flex items-center justify-center min-h-14 rounded-xl bg-brand text-brand-foreground text-lg font-semibold no-underline hover:bg-brand-hover"
        data-testid="brain-training-home"
      >
        {t('training.backHome')}
      </Link>
    </Centered>
  )
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm p-6 bg-card rounded-2xl border border-border flex flex-col items-center gap-4 text-center" data-testid="brain-training-card">
        {children}
      </div>
    </div>
  )
}
