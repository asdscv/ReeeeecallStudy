import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { X, Play, Clock, Target, ListChecks, ArrowRight, Home } from 'lucide-react'
import { formatCount } from '@reeeeecall/shared/lib/format-number'
import { GAME_THEMES, TRAINING_THEME, brainGame, courseStatus, displayLevel, localDayKey, weekProgress, type AchievementId, type BrainGameId } from '@reeeeecall/shared/lib/brain-games'
import { useTodaysTraining } from '@reeeeecall/shared/hooks/useTodaysTraining'
import type { RoundStats } from '@reeeeecall/shared/hooks/useBrainRound'
import { useBrainStore } from '@reeeeecall/shared/stores/brain-store'
import { useTrackEvent } from '../../hooks/useTrackEvent'
import { RoundView } from '../../components/brain/RoundView'
import { GameIntro } from '../../components/brain/GameIntro'
import { Confetti, GameCanvas } from '../../components/brain/GameCanvas'
import { WeekRing } from '../../components/brain/WeekRing'
import { BRAIN_ICONS, cardBackground, focusIfKeyboard } from '../../components/brain/brain-ui'
import { sfx } from '../../components/brain/sfx'
import { useBrainHydrated } from '../../components/brain/useBrainHydrated'
import { AchievementCards } from '../../components/brain/AchievementsGrid'
import { TierBadge } from '../../components/brain/TierBadge'
import { quickEyeSpeedLevel } from '../../components/brain/tier-ui'

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
  const [stage, setStage] = useState<'lineup' | 'intro' | 'play'>('lineup')
  const [askingStop, setAskingStop] = useState(false)
  // What the session's rounds earned on the way — told once, at the session's end (no results
  // screen between rounds here).
  const [earned, setEarned] = useState<{ achievements: AchievementId[]; tierUps: Partial<Record<BrainGameId, number>> }>({ achievements: [], tierUps: {} })
  // Placement per game: the level its climb started from once placement found it, or null while a
  // placement stopped part-way has no level to show yet. Games that never placed are not listed.
  const [placed, setPlaced] = useState<PlacedLevels>({})
  const onOver = useCallback(
    (stats: RoundStats) => {
      const gameId = s.slot.gameId
      if (stats.achievements.length || stats.tierUp) {
        setEarned((e) => ({
          achievements: [...e.achievements, ...stats.achievements.filter((a) => !e.achievements.includes(a))],
          tierUps: stats.tierUp ? { ...e.tierUps, [gameId]: Math.max(stats.tierUp, e.tierUps[gameId] ?? 0) } : e.tierUps,
        }))
      }
      if (stats.placement !== 'none') setPlaced((p) => ({ ...p, [gameId]: stats.placement === 'done' ? stats.levelStart : null }))
      s.onRoundOver(gameId, stats)
    },
    [s],
  )
  const reported = useRef(false)
  useEffect(() => {
    if (s.phase === 'done' && !reported.current) {
      reported.current = true
      trackEvent({ category: 'brain', action: 'training_done', value: s.totals.trials })
    }
  }, [s.phase, s.totals.trials, trackEvent])
  const games = s.slots.map((slot) => slot.gameId)
  const stepsLabel = t('training.title')

  const stopSheet = askingStop && (
    <StopSheet onKeep={() => setAskingStop(false)} onStop={() => navigate('/brain')} />
  )

  if (s.phase === 'playing' && stage === 'lineup') {
    return <Lineup games={games} minutes={s.plannedMinutes} onStart={() => setStage('intro')} onClose={() => navigate('/brain')} />
  }
  if (s.phase === 'playing' && stage === 'intro') {
    return (
      <>
        <GameIntro gameId={s.slot.gameId} onStart={() => setStage('play')} onClose={() => setAskingStop(true)} closeLabel={t('play.stop')} steps={{ games, index: s.slotIndex, label: stepsLabel }} />
        {stopSheet}
      </>
    )
  }
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
    return (
      <>
        <GameIntro
          gameId={s.next.gameId}
          onStart={() => { s.continueSession(); setStage('play') }}
          onClose={() => setAskingStop(true)}
          closeLabel={t('play.stop')}
          steps={{ games, index: s.slotIndex + 1, label: stepsLabel }}
        />
        {stopSheet}
      </>
    )
  }
  const achievements = [...earned.achievements, ...s.achievements.filter((a) => !earned.achievements.includes(a))]
  return <SessionEnd done={s.phase === 'done'} totals={s.totals} activeMinutes={s.activeMinutes} achievements={achievements} tierUps={earned.tierUps} placed={placed} />
}

/** Per game: where its climb started once placement found it, or null while placement is unfinished. */
type PlacedLevels = Partial<Record<BrainGameId, number | null>>

/** The session's line-up before it starts: four games, about how long, one start. */
function Lineup({ games, minutes, onStart, onClose }: { games: BrainGameId[]; minutes: number; onStart: () => void; onClose: () => void }) {
  const { t } = useTranslation('brain')
  const progress = useBrainStore((st) => st.progress)
  const week = weekProgress(progress, localDayKey())
  const start = useRef<HTMLButtonElement>(null)
  useEffect(() => focusIfKeyboard(start.current), [])
  return (
    <GameCanvas theme={TRAINING_THEME} testId="brain-training-lineup">
      <div className="max-w-xl mx-auto px-4 pb-10">
        <header className="flex items-center pt-4 min-h-16">
          <button type="button" onClick={onClose} className="flex items-center gap-1.5 min-h-11 px-3 rounded-xl bg-white/10 hover:bg-white/20 border-none text-white text-base cursor-pointer">
            <X className="w-5 h-5" aria-hidden="true" />
            {t('play.back')}
          </button>
        </header>
        <section className="bfx-rise flex items-center justify-between gap-4 pt-4">
          <div>
            <h1 className="text-4xl font-extrabold tracking-tight">{t('training.title')}</h1>
            <p className="mt-2 text-lg text-white/80">{t('training.desc', { minutes })}</p>
          </div>
          <WeekRing done={week.done} goal={week.goal} label={t('training.week', { done: week.done, goal: week.goal })} color={TRAINING_THEME.accent} />
        </section>
        <ol className="mt-8 space-y-3" aria-label={t('training.lineup')}>
          {games.map((g, i) => {
            const Icon = BRAIN_ICONS[brainGame(g).icon]
            return (
              <li key={i} className="bfx-rise flex items-center gap-4 p-3 rounded-2xl bg-white/[0.07] border border-white/10" style={{ animationDelay: `${i * 70}ms` }}>
                <span className="w-8 text-center text-lg font-black text-white/60 tabular-nums">{i + 1}</span>
                <span className="w-14 h-14 rounded-2xl flex items-center justify-center shrink-0" style={{ background: cardBackground(GAME_THEMES[g]) }}>
                  {Icon && <Icon className="w-7 h-7 text-white" aria-hidden="true" />}
                </span>
                <span className="flex-1 min-w-0">
                  <span className="block text-lg font-bold truncate">{t(`games.${g}.name`)}</span>
                  <span className="block text-sm text-white/75 truncate">{t(`games.${g}.desc`)}</span>
                </span>
                <span className="flex items-center gap-1 text-sm text-white/75 shrink-0">
                  <Clock className="w-4 h-4" aria-hidden="true" />
                  {t('training.minutesShort', { value: i === 0 ? 10 : 4 })}
                </span>
              </li>
            )
          })}
        </ol>
        <p className="mt-5 text-base text-white/75">{t('training.dose')}</p>
        <button
          ref={start}
          type="button"
          onClick={onStart}
          className="mt-6 w-full min-h-16 flex items-center justify-center gap-2 rounded-2xl bg-white text-xl font-extrabold border-none cursor-pointer shadow-[0_14px_40px_rgba(0,0,0,0.35)] hover:scale-[1.01] active:scale-[0.98] transition-transform"
          style={{ color: TRAINING_THEME.cardTo }}
          data-testid="brain-training-begin"
        >
          <Play className="w-6 h-6 fill-current" aria-hidden="true" />
          {t('training.start')}
        </button>
      </div>
    </GameCanvas>
  )
}

/** Session complete (or stopped): the week ring fills, the course moves, each game's change, what was earned. */
function SessionEnd({
  done,
  totals,
  activeMinutes,
  achievements,
  tierUps,
  placed,
}: {
  done: boolean
  totals: ReturnType<typeof useTodaysTraining>['totals']
  activeMinutes: number
  achievements: AchievementId[]
  tierUps: Partial<Record<BrainGameId, number>>
  placed: PlacedLevels
}) {
  const { t } = useTranslation('brain')
  const progress = useBrainStore((st) => st.progress)
  const today = localDayKey()
  const week = weekProgress(progress, today)
  const course = courseStatus(progress, today)
  const accuracy = totals.trials > 0 ? Math.round((totals.correct / totals.trials) * 100) : 0
  const minutes = Math.max(1, Math.round(activeMinutes))
  const levels = Object.entries(totals.levels) as [BrainGameId, { start: number; end: number }][]
  useEffect(() => {
    if (done) sfx.play({ kind: 'newBest' })
  }, [done])
  const courseLabel =
    course.phase === 'booster' && course.booster
      ? t('training.booster', { done: course.booster.done, total: course.booster.total })
      : t('training.course', { done: course.coreDone, total: course.coreTotal })
  const courseFrac = course.phase === 'booster' && course.booster ? course.booster.done / course.booster.total : course.coreDone / course.coreTotal
  return (
    <GameCanvas theme={TRAINING_THEME} testId="brain-training-card">
      {done && <Confetti colors={['#FDE68A', '#A5B4FC', '#FFFFFF', '#F0ABFC', '#86EFAC']} />}
      <div className="max-w-md mx-auto px-4 py-8 min-h-dvh flex flex-col justify-center gap-5">
        <div className="flex flex-col items-center text-center gap-4">
          {done && <WeekRing done={week.done} goal={week.goal} size={132} label={t('training.week', { done: week.done, goal: week.goal })} color="#FDE68A" />}
          <h1 className="bfx-rise text-4xl font-extrabold">{done ? t('training.doneTitle') : t('training.quitTitle')}</h1>
          <p className="text-lg text-white/80">{done ? (week.done >= week.goal ? t('training.weekDone') : t('training.doneBody')) : t('training.quitBody')}</p>
        </div>

        {done && (
          <div className="rounded-2xl bg-white/[0.07] border border-white/10 p-4">
            <div className="flex items-baseline justify-between text-base">
              <span className="font-semibold">{courseLabel}</span>
            </div>
            <div className="mt-3 h-2.5 rounded-full bg-white/10 overflow-hidden">
              <div className="h-full rounded-full" style={{ width: `${Math.max(4, courseFrac * 100)}%`, background: TRAINING_THEME.accent, transition: 'width 900ms cubic-bezier(.2,.8,.2,1)' }} />
            </div>
          </div>
        )}

        <div className="grid grid-cols-3 gap-2">
          <EndStat icon={<Clock className="w-5 h-5" aria-hidden="true" />} label={t('summary.minutes')} value={formatCount(minutes)} />
          <EndStat icon={<ListChecks className="w-5 h-5" aria-hidden="true" />} label={t('summary.trials')} value={formatCount(totals.trials)} />
          <EndStat icon={<Target className="w-5 h-5" aria-hidden="true" />} label={t('summary.accuracy')} value={`${accuracy}%`} />
        </div>

        {levels.length > 0 && (
          <ul className="space-y-2">
            {levels.map(([id, l]) => {
              // A placement stopped part-way has no level yet (its probe levels are not progress):
              // no change is shown. A finished one counts from where the climb started.
              const start = placed[id]
              const showLevel = start !== null
              const startLevel = start ?? l.start
              // Quick Eye's level is its speed level, a whole number (never milliseconds): higher is better.
              const qe = id === 'quickEye'
              const from = qe ? quickEyeSpeedLevel(startLevel) : displayLevel(startLevel)
              const to = qe ? quickEyeSpeedLevel(l.end) : displayLevel(l.end)
              const better = to > from
              const tierUp = tierUps[id]
              const Icon = BRAIN_ICONS[brainGame(id).icon]
              return (
                <li key={id} className="flex items-center gap-3 p-3 rounded-2xl bg-white/[0.07] border border-white/10">
                  <span className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0" style={{ background: cardBackground(GAME_THEMES[id]) }}>
                    {Icon && <Icon className="w-5 h-5 text-white" aria-hidden="true" />}
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="block text-base font-semibold truncate">{t(`games.${id}.name`)}</span>
                    {/* A tier reached during the session — said here, since rounds in a session have no results screen. */}
                    {tierUp ? (
                      <span className="block mt-1">
                        <TierBadge tier={tierUp} size="sm" label={t('tiers.up', { tier: t(`tiers.t${tierUp}`) })} testId={`brain-training-tier-up-${id}`} />
                      </span>
                    ) : null}
                  </span>
                  {showLevel && (
                    <span className="flex items-center gap-1.5 text-base tabular-nums shrink-0" style={{ color: better ? '#86EFAC' : 'rgba(255,255,255,0.8)' }}>
                      {qe ? t('quickEye.speedLevel', { level: from }) : from.toFixed(1)}
                      <ArrowRight className="w-4 h-4" aria-hidden="true" />
                      {qe ? to : to.toFixed(1)}
                    </span>
                  )}
                </li>
              )
            })}
          </ul>
        )}

        <AchievementCards ids={achievements} delayMs={600} />

        <Link
          to="/brain"
          className="w-full min-h-16 flex items-center justify-center gap-2 rounded-2xl bg-white text-xl font-extrabold no-underline shadow-[0_14px_40px_rgba(0,0,0,0.35)]"
          style={{ color: TRAINING_THEME.cardTo }}
          data-testid="brain-training-home"
        >
          <Home className="w-6 h-6" aria-hidden="true" />
          {t('training.backHome')}
        </Link>
      </div>
    </GameCanvas>
  )
}

function EndStat({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-white/[0.07] border border-white/10 p-3 text-center">
      <p className="flex items-center justify-center gap-1 text-sm text-white/75">{icon}{label}</p>
      <p className="mt-1 text-2xl font-bold tabular-nums">{value}</p>
    </div>
  )
}

function StopSheet({ onKeep, onStop }: { onKeep: () => void; onStop: () => void }) {
  const { t } = useTranslation('brain')
  return (
    <div className="fixed inset-0 z-40 flex flex-col items-center justify-center gap-4 bg-slate-950/70 backdrop-blur-md px-6 text-white" role="dialog" aria-modal="true" aria-labelledby="brain-training-stop-title">
      <p id="brain-training-stop-title" className="text-2xl font-extrabold">{t('play.stopTitle')}</p>
      <p className="text-base text-white/80 max-w-xs text-center">{t('training.stopBody')}</p>
      <button type="button" onClick={onKeep} className="w-64 min-h-14 rounded-2xl bg-white text-lg font-bold border-none cursor-pointer" style={{ color: TRAINING_THEME.cardTo }} autoFocus>
        {t('play.keepPlaying')}
      </button>
      <button type="button" onClick={onStop} className="w-64 min-h-12 rounded-2xl bg-white/10 hover:bg-white/20 text-base font-semibold text-white border-none cursor-pointer" data-testid="brain-training-stop">
        {t('play.stopNow')}
      </button>
    </div>
  )
}
