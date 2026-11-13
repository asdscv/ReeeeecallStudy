import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { useReducedMotion } from 'motion/react'
import { X, Pause, Play, Heart, Flame, Check, Trophy, Flag, HeartCrack, Volume2, VolumeX, Lightbulb, Compass } from 'lucide-react'
import { formatCount } from '@reeeeecall/shared/lib/format-number'
import { GAME_THEMES, QE_WARM, QUICK_EYE_PIPS, buildDemo, comboMultiplier, maxColsFor, quickEyePlace, streakTier, type BrainGameId, type GameTheme } from '@reeeeecall/shared/lib/brain-games'
import { useBrainRound, type LegMark, type RoundStats, type StageUp } from '@reeeeecall/shared/hooks/useBrainRound'
import { useBrainFx, type BrainFx } from '@reeeeecall/shared/hooks/useBrainFx'
import { useBrainStore } from '@reeeeecall/shared/stores/brain-store'
import { BrainBoard } from './BrainBoard'
import { Countdown, GameCanvas } from './GameCanvas'
import { webPlatform } from './brain-ui'
import { QuickEyeBoard } from './QuickEyeBoard'
import { RuleCard } from './RuleCard'
import { sfx } from './sfx'

/**
 * A round of one game, full screen on the game's canvas: a countdown, then trials until the
 * chances run out, the round's cap is reached, or the player stops. The board's width is measured
 * first — the round is built for it (the column cap keeps every cell ≥ 56px).
 *
 * Quick Eye has no chances: a leg of 20 counted trials, drawn as a bar of 20 cells under the score.
 * Its header says «Stage N · speed level L» with four pips and how many right answers the next
 * speed step is away (at the shortest flash: «hold top speed n/14»); a stage reached shows a short
 * card between trials. While its display is measured (`r.quiet`: fixation, stimulus, mask) nothing
 * new is shown, animated or sounded — chips, "+N", notices wait until it is over.
 */
export function RoundView({
  gameId,
  onOver,
  caption,
  countdown = true,
  timeBudgetMs,
}: {
  gameId: BrainGameId
  onOver: (stats: RoundStats) => void
  caption?: string
  countdown?: boolean
  /** Today's Training: the slot's play time left; the round ends after the trial in play when it is up. */
  timeBudgetMs?: number
}) {
  const { t } = useTranslation('brain')
  const theme = GAME_THEMES[gameId]
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState<number | null>(null)
  const [counting, setCounting] = useState(countdown)
  // The CONTENT width: the measured box has no padding of its own (clientWidth counts padding,
  // and a padded measure let a 6-column grid overflow a 390px phone by its gutters).
  useLayoutEffect(() => {
    if (ref.current) setWidth(Math.min(ref.current.clientWidth, 560))
  }, [])
  const sound = useBrainStore((s) => s.progress.settings.sound)
  useEffect(() => {
    sfx.enabled = sound
  }, [sound])
  return (
    <GameCanvas theme={theme} testId="brain-round">
      <div className="max-w-2xl w-full mx-auto px-4">
        <div ref={ref} className="w-full">
          {width === null ? null : counting ? (
            <>
              <HudShell gameId={gameId} caption={caption} />
              <Countdown goLabel={t('play.go')} onDone={() => setCounting(false)} />
            </>
          ) : (
            <Round gameId={gameId} onOver={onOver} caption={caption} width={width} theme={theme} timeBudgetMs={timeBudgetMs} />
          )}
        </div>
      </div>
    </GameCanvas>
  )
}

/** The header as it will look, while the countdown runs — so nothing jumps when play starts. */
function HudShell({ gameId, caption }: { gameId: BrainGameId; caption?: string }) {
  const { t } = useTranslation('brain')
  return (
    <header className="flex items-center gap-2 pt-4 pb-2 min-h-[72px]">
      <div className="w-24" />
      <div className="flex-1 min-w-0 text-center">
        {caption && <p className="text-sm text-white/70 truncate">{caption}</p>}
        <h1 className="text-lg font-bold truncate">{t(`games.${gameId}.name`)}</h1>
      </div>
      <div className="w-24" />
    </header>
  )
}

interface Pop {
  id: number
  text: string
  /** The trial it belongs to: Quick Eye drops it when the next trial starts (its fixation is quiet). */
  trial: number
}

const noop = () => {}

function Round({ gameId, onOver, caption, width, theme, timeBudgetMs }: { gameId: BrainGameId; onOver: (stats: RoundStats) => void; caption?: string; width: number; theme: GameTheme; timeBudgetMs?: number }) {
  const { t } = useTranslation('brain')
  // The board's columns from its width, its rows from the window's height (a portrait Flash Grid).
  const [platform] = useState(() => webPlatform(width, maxColsFor(width)))
  const r = useBrainRound(gameId, platform, { timeBudgetMs })
  const timing = useBrainStore((s) => s.progress.settings.timing)
  const sound = useBrainStore((s) => s.progress.settings.sound)
  const setSettings = useBrainStore((s) => s.setSettings)
  const centerOnly = useBrainStore((s) => s.progress.settings.centerOnly)
  const qe = gameId === 'quickEye'
  const reported = useRef(false)
  const [pops, setPops] = useState<Pop[]>([])
  const [banner, setBanner] = useState<Pop | null>(null)
  const [burst, setBurst] = useState<{ id: number; ok: boolean } | null>(null)
  const [heartHit, setHeartHit] = useState(0)
  const [ending, setEnding] = useState(false)
  // Quick Eye's placement: a dot per trial answered («getting ready»), never a level.
  const [warmDots, setWarmDots] = useState(0)
  // Quick Eye's practice, right answers in a row — as the round counts them, to know whether another
  // (shorter) practice flash follows.
  const practiceRun = useRef(0)
  const seq = useRef(0)
  const reduced = useReducedMotion()

  // Number Hunt spends lives per wrong tap inside a grid; show them going as they go, not when the
  // grid ends.
  const liveLives = gameId === 'schulte' && typeof r.view.prompt.params?.lives === 'number' && !r.result ? Number(r.view.prompt.params.lives) : r.lives

  // Quick Eye's measured frames: every sound but the ready cue is dropped. Set before the round's
  // effects below run, so a sound asked for in the same render already sees it.
  useEffect(() => {
    sfx.quiet = r.quiet
    return () => {
      sfx.quiet = false
    }
  }, [r.quiet])

  const trialId = r.trialId
  const result = r.result
  const practiceDone = r.practiceDone
  const practiceTotal = r.practiceTotal
  const onFx = useCallback(
    (fx: BrainFx) => {
      if (qe && fx.kind === 'levelUp') sfx.rungUp()
      // A stage that changes the field's colour (a new stage group) gets the top note too.
      else if (fx.kind === 'stageUp') sfx.stageUp(quickEyePlace(fx.variant, centerOnly) !== quickEyePlace(fx.variant - 1, centerOnly))
      else sfx.play(fx)
      const id = ++seq.current
      const verdict = fx.kind === 'correct' || fx.kind === 'wrong' || fx.kind === 'nearMiss'
      // Quick Eye's reveal is the feedback: no big ✓/✗ over the board (it would cover the scene), never red.
      if (fx.kind === 'correct') {
        if (!qe) setBurst({ id, ok: true })
        if (!fx.practice && fx.points > 0) setPops((p) => [...p.slice(-3), { id, text: `+${formatCount(fx.points)}`, trial: trialId }])
        if ([5, 10, 15, 20, 30, 40, 50].includes(fx.streak)) setBanner({ id, text: t('play.streakBanner', { value: fx.streak }), trial: trialId })
      }
      if (fx.kind === 'wrong' && !qe) setBurst({ id, ok: false })
      if (fx.kind === 'lifeLost') setHeartHit(id)
      if (fx.kind === 'levelUp') setBanner({ id, text: qe ? t('quickEye.speedUp') : t('play.levelUpBanner', { level: fx.level }), trial: trialId })
      if (fx.kind === 'roundEnd' && fx.reason !== 'stop') setEnding(true)
      if (fx.kind === 'correct' && reduced && !fx.practice && fx.points > 0) {
        // No float under reduced motion: the "+N" just shows for a moment, then goes.
        setTimeout(() => setPops((list) => list.filter((x) => x.id !== id)), 900)
      }
      if (qe && verdict && result?.kind === 'placement') setWarmDots((n) => n + 1)
      // Practice flashes get shorter each time: said between the two, never over the flash.
      if (qe && verdict && result?.kind === 'practice') {
        practiceRun.current = fx.kind === 'correct' ? practiceRun.current + 1 : 0
        const ends = (practiceDone >= 2 && practiceRun.current >= 2) || practiceDone >= practiceTotal
        if (!ends) setBanner({ id, text: t('quickEye.slowerStart'), trial: trialId })
      }
    },
    [qe, t, reduced, centerOnly, trialId, result, practiceDone, practiceTotal],
  )
  useBrainFx(r, onFx)

  // Quick Eye: a chip belongs to the reveal it came with — it goes when the next trial starts, and
  // its clock does not run while the display is measured.
  const quietNow = qe && r.quiet
  useEffect(() => {
    if (!banner || quietNow) return
    const tm = setTimeout(() => setBanner(null), 1300)
    return () => clearTimeout(tm)
  }, [banner, quietNow])
  const shownBanner = banner && (!qe || (banner.trial === r.trialId && !r.quiet)) ? banner : null
  const shownPops = qe ? pops.filter((p) => p.trial === r.trialId && !r.quiet) : pops
  useEffect(() => {
    if (!burst) return
    const tm = setTimeout(() => setBurst(null), 650)
    return () => clearTimeout(tm)
  }, [burst])
  // A bigger board's notice shows for a few seconds after it first appears (a new `id`), then goes.
  // It waits under a rule card or a stage-up, and its seconds count from when it shows. Quick Eye's
  // (it arrives as a trial's fixation starts) opens only once the display is not being measured and
  // then stays put across the next flashes — it does not blink off and pop back around each one —
  // and its going waits until a measured stretch is over: nothing on screen changes, and nothing
  // re-renders, while a flash is being counted.
  const toastId = r.toast?.id ?? null
  const cardUp = r.intro !== null || r.stageUp !== null
  const [toastOpen, setToastOpen] = useState<number | null>(null)
  const [toastGone, setToastGone] = useState<number | null>(null)
  const measuring = useRef(r.quiet)
  useEffect(() => {
    measuring.current = r.quiet
  })
  useEffect(() => {
    if (toastId === null || cardUp || r.quiet || toastId === toastOpen || toastId === toastGone) return
    const tm = setTimeout(() => setToastOpen(toastId))
    return () => clearTimeout(tm)
  }, [toastId, cardUp, r.quiet, toastOpen, toastGone])
  const toastDue = useRef<number | null>(null)
  useEffect(() => {
    if (toastOpen === null || cardUp) return
    const id = toastOpen
    const tm = setTimeout(() => {
      if (measuring.current) toastDue.current = id
      else setToastGone(id)
    }, 3200)
    return () => clearTimeout(tm)
  }, [toastOpen, cardUp])
  useEffect(() => {
    if (r.quiet || toastDue.current === null) return
    const tm = setTimeout(() => {
      if (toastDue.current !== null) setToastGone(toastDue.current)
      toastDue.current = null
    })
    return () => clearTimeout(tm)
  }, [r.quiet])
  const toast = r.toast && r.toast.id === toastOpen && !cardUp && r.toast.id !== toastGone ? r.toast : null

  // On `done`, not `over`: one render later the personal-best flag is settled. A round that ran
  // out holds its "round over" stamp for a moment first.
  useEffect(() => {
    if (!r.done || reported.current) return
    const tm = setTimeout(() => {
      if (reported.current) return
      reported.current = true
      onOver(r.stats)
    }, r.stats.endedBy === 'stop' ? 0 : 1300)
    return () => clearTimeout(tm)
  }, [r.done, r.stats, onOver])

  // A hidden tab pauses the round: a timed trial must not run out of chances while the player is
  // away. (A Quick Eye flash in progress cannot pause; the engine voids it instead.)
  const live = useRef(r)
  useEffect(() => {
    live.current = r
  })
  // A pause asked for mid-flash (Quick Eye's stimulus cannot pause) is remembered and taken as soon
  // as the round can pause, rather than dropped.
  const wantPause = useRef(false)
  useEffect(() => {
    const onVisibility = () => {
      const cur = live.current
      if (!document.hidden || cur.paused || cur.over) return
      if (cur.canPause) cur.pause()
      else wantPause.current = true
    }
    document.addEventListener('visibilitychange', onVisibility)
    // A round can start in a hidden tab (the countdown runs out after the player has switched away):
    // it starts paused rather than playing itself out.
    onVisibility()
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [])
  useEffect(() => {
    if (wantPause.current && r.canPause && !r.paused) {
      wantPause.current = false
      r.pause()
    }
  }, [r])

  // The stop sheet pauses the round underneath it: the trial's deadline must not run out while
  // the player decides, or "keep playing" would land straight on a timeout.
  const pausedForSheet = useRef(false)
  const [sheetWanted, setSheetWanted] = useState(false)
  const askStop = () => {
    if (r.stats.trials === 0) return r.stop()
    pausedForSheet.current = !r.paused
    setSheetWanted(true)
    if (r.canPause && !r.paused) r.pause()
  }
  // Mid-flash (Quick Eye) the round cannot pause yet: the sheet waits for the flash to finish and
  // the round to pause — or it would hide a flash that then has to be answered unseen.
  useEffect(() => {
    if (sheetWanted && !r.paused && r.canPause && !r.over) r.pause()
  }, [sheetWanted, r])
  const confirming = sheetWanted && r.paused
  const cancelStop = () => {
    setSheetWanted(false)
    if (pausedForSheet.current) r.resume()
    pausedForSheet.current = false
  }

  // Escape pauses (or closes the stop sheet); the pause screen's buttons take over from there.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (sheetWanted) return cancelStop()
      if (r.paused) r.resume()
      else if (r.canPause) r.pause()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  // While placement finds the start, the level jumps around: it is not shown (not read as a score).
  // Quick Eye: the stage always; the speed level and its gauge on counted trials only.
  const levelText = qe
    ? [r.stage !== null ? t('quickEye.stage', { stage: r.stage }) : null, r.speed ? t('quickEye.speedLevel', { level: r.speed.shown }) : null].filter(Boolean).join(' · ') || null
    : r.placing
      ? null
      : t('home.level', { level: r.level.toFixed(1) })
  const pipsShown = qe && r.speed !== null && !r.speed.atTop
  const gaugeText = !qe || !r.speed
    ? null
    : r.speed.atTop
      ? r.hold
        ? t('quickEye.hold', { n: r.hold.filled })
        : t('quickEye.topSpeed')
      : t('quickEye.gauge', { count: r.speed.toNext })
  const nearMiss = r.view.kind === 'quickEye' && r.view.nearMiss === true
  const resultText = !r.result
    ? null
    : r.result.void
      ? t('play.void')
      : r.result.correct
        ? t('play.correct')
        : qe
          ? nearMiss
            ? t('quickEye.nearMiss')
            : t('quickEye.missFast')
          : r.result.timedOut
            ? r.result.livesLost === 0 && timing !== 1
              ? t('play.timeUpForgiven')
              : t('play.timeUp')
            : t('play.wrong')
  // Quick Eye says a miss without red: amber when it was right next to the star.
  const resultColor = !r.result ? undefined : r.result.void ? 'rgba(255,255,255,0.7)' : r.result.correct ? '#86EFAC' : qe ? (nearMiss ? QE_WARM : 'rgba(255,255,255,0.85)') : '#FCA5A5'
  const tier = streakTier(r.stats.streak)
  // A game without chances (Quick Eye) shows its leg as cells instead, from its first counted trial
  // on — and keeps showing it through a new stage's unscored trials mid-leg.
  const legBar = r.maxLives === 0 && r.roundCap !== null && (r.trialKind === 'counted' || r.legMarks.length > 0)
  const capProgress = r.roundCap !== null && r.maxLives > 0 && !r.practice && !r.placing ? r.trialInRound / r.roundCap : null
  // Under the score row: what kind of trial this is, when it is not a counted one.
  const hint = r.trialKind === 'practice' ? t('play.practiceHint') : r.trialKind === 'intro' ? t('rule.unscored') : r.placing ? t('placement.hint') : null

  return (
    <>
      <header className="flex items-center gap-2 pt-4 pb-1 min-h-[72px]">
        <button
          type="button"
          onClick={askStop}
          aria-label={t('play.stop')}
          className="flex items-center gap-1.5 min-h-11 min-w-11 px-3 rounded-xl bg-white/10 hover:bg-white/20 border-none text-white text-base cursor-pointer"
          data-testid="brain-finish"
        >
          <X className="w-5 h-5" aria-hidden="true" />
          <span className="hidden sm:inline">{t('play.stop')}</span>
        </button>
        <div className="flex-1 min-w-0 text-center">
          {caption && <p className="text-sm text-white/70 truncate">{caption}</p>}
          <h1 className="text-lg font-bold truncate">{t(`games.${gameId}.name`)}</h1>
          {levelText && (
            <p className="flex items-center justify-center gap-1.5 text-sm font-medium" style={{ color: theme.accent }} data-testid="brain-level">
              <span className="truncate">{levelText}</span>
              {pipsShown && r.speed && <SpeedPips filled={r.speed.pips} label={gaugeText ?? ''} accent={theme.accent} />}
            </p>
          )}
          {gaugeText && (
            <p className="text-xs leading-4 text-white/75" aria-hidden={pipsShown || undefined} data-testid="brain-gauge">
              {gaugeText}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={r.paused ? r.resume : r.pause}
          disabled={!r.canPause}
          aria-label={r.paused ? t('play.resume') : t('play.pause')}
          className="w-11 h-11 flex items-center justify-center rounded-xl bg-white/10 hover:bg-white/20 border-none text-white cursor-pointer disabled:opacity-40"
          data-testid="brain-pause"
        >
          {r.paused ? <Play className="w-5 h-5" aria-hidden="true" /> : <Pause className="w-5 h-5" aria-hidden="true" />}
        </button>
      </header>

      {/* Score, run and chances, then the round's bars — a bigger board's notice lies over them for a moment. */}
      <div className="relative">
        <div className="flex items-center justify-between gap-3 min-h-12">
          <div className="relative min-w-16">
            <p className="text-3xl font-black tabular-nums leading-none" style={{ textShadow: `0 0 24px ${theme.glow}` }} data-testid="brain-score">
              {formatCount(r.stats.points)}
            </p>
            <p className="text-xs font-semibold uppercase tracking-wider text-white/60 mt-1">{t('play.score')}</p>
            {shownPops.map((p) => (
              <span
                key={p.id}
                className="absolute top-0 text-xl font-extrabold pointer-events-none whitespace-nowrap"
                style={{ left: 'calc(100% + 8px)', color: theme.accent, animation: reduced ? 'none' : 'bfx-float 900ms ease-out forwards' }}
                onAnimationEnd={() => setPops((list) => list.filter((x) => x.id !== p.id))}
                aria-hidden="true"
              >
                {p.text}
              </span>
            ))}
          </div>

          {tier > 0 && !r.practice ? (
            <div
              key={`streak-${tier}`}
              className="bfx-pop flex items-center gap-1 px-3 h-10 rounded-full text-base font-bold whitespace-nowrap shrink-0"
              style={{ background: tier >= 3 ? 'linear-gradient(90deg,#F59E0B,#EF4444)' : tier === 2 ? 'rgba(251,146,60,0.9)' : 'rgba(255,255,255,0.14)' }}
              aria-label={t('play.streakCount', { value: r.stats.streak })}
              data-testid="brain-streak"
            >
              <Flame className="w-5 h-5" aria-hidden="true" />
              {/* Narrow phones get the flame and the number; the words and multiplier from sm up. */}
              <span className="sm:hidden tabular-nums" aria-hidden="true">{r.stats.streak}</span>
              <span className="hidden sm:inline" aria-hidden="true">{t('play.streakCount', { value: r.stats.streak })}</span>
              <span className="hidden sm:inline text-white/80 text-sm" aria-hidden="true">×{comboMultiplier(r.stats.streak)}</span>
            </div>
          ) : (
            <div />
          )}

          {r.trialKind === 'practice' ? (
            <p className="text-sm font-semibold px-3 h-10 flex items-center rounded-full bg-white/15" data-testid="brain-lives">
              {t('play.practice', { done: Math.min(r.practiceTotal, r.practiceDone + (r.result ? 0 : 1)), total: r.practiceTotal })}
            </p>
          ) : r.trialKind === 'intro' ? (
            <p className="text-sm font-semibold px-3 h-10 flex items-center gap-1.5 rounded-full whitespace-nowrap" style={{ background: theme.accent, color: theme.cardTo }} data-testid="brain-lives">
              <Lightbulb className="w-4 h-4" aria-hidden="true" />
              {t('rule.label')}
            </p>
          ) : r.placing && qe ? (
            <p className="text-sm font-semibold px-3 h-10 flex items-center gap-2 rounded-full bg-white/15 whitespace-nowrap" data-testid="brain-lives">
              {t('quickEye.warmup')}
              <span className="inline-flex items-center gap-1" aria-hidden="true">
                {Array.from({ length: Math.min(10, warmDots + 1) }, (_, i) => (
                  <span key={i} className="w-1.5 h-1.5 rounded-full" style={{ background: i < warmDots ? '#FFFFFF' : 'rgba(255,255,255,0.3)' }} />
                ))}
              </span>
            </p>
          ) : r.placing ? (
            <p className="text-sm font-semibold px-3 h-10 flex items-center gap-1.5 rounded-full bg-white/15 whitespace-nowrap" data-testid="brain-lives">
              <Compass className="w-4 h-4" aria-hidden="true" />
              {t('placement.label')}
            </p>
          ) : r.maxLives === 0 ? (
            // No chances to show: the leg's cells below say how far along it is.
            <div />
          ) : (
            <span
              key={`hearts-${heartHit}`}
              className={`flex items-center gap-1 shrink-0 ${heartHit ? 'bfx-shake' : ''}`}
              role="img"
              aria-label={t(r.group === 'span' ? 'play.livesSpan' : 'play.lives', { value: liveLives })}
              data-testid="brain-lives"
            >
              {Array.from({ length: r.maxLives }, (_, i) =>
                i < liveLives ? (
                  <Heart key={i} className={`${r.maxLives > 3 ? 'w-5 h-5' : 'w-6 h-6'} fill-[#FB7185] text-[#FB7185] drop-shadow-[0_0_8px_rgba(251,113,133,0.6)]`} aria-hidden="true" />
                ) : (
                  <HeartCrack key={i} className={`${r.maxLives > 3 ? 'w-5 h-5' : 'w-6 h-6'} text-white/30`} aria-hidden="true" />
                ),
              )}
            </span>
          )}
        </div>

        {hint && <p className="text-center text-sm text-white/75 mt-1" data-testid="brain-trial-hint">{hint}</p>}

        {/* The round's progress (capped rounds, or Quick Eye's leg), then this trial's clock. */}
        <div className="mt-3 space-y-1.5">
          {/* Before Quick Eye's leg starts (practice, placement) its row is held, so nothing jumps when it does. */}
          {legBar && r.roundCap !== null ? <LegBar marks={r.legMarks} cap={r.roundCap} accent={theme.accent} /> : qe ? <div className="h-2" aria-hidden="true" /> : null}
          {capProgress !== null && (
            <div
              className="h-1.5 rounded-full bg-white/10 overflow-hidden"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={r.roundCap ?? 0}
              aria-valuenow={r.trialInRound}
              aria-label={t('play.trial', { done: r.trialInRound, total: r.roundCap ?? 0 })}
            >
              <div className="h-full rounded-full transition-[width] duration-300" style={{ width: `${capProgress * 100}%`, background: 'rgba(255,255,255,0.55)' }} />
            </div>
          )}
          {/* Quick Eye's answers are never timed: no empty clock track under its leg. */}
          {!qe && <TimerBar key={r.trialId} timer={r.timer} accent={theme.accent} />}
        </div>
        {/* A bigger board's notice: over the score row and the bars, just under the header, for a few
            seconds — never over the prompt or the board, and never in the way of a tap. At most three
            lines of body, so it stays inside the HUD and the gap above the prompt. */}
        <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex justify-center" role="status" aria-live="polite">
          {toast && (
            <p key={toast.id} className="bfx-pop max-w-[min(100%,26rem)] px-4 py-1.5 rounded-2xl bg-slate-950/90 border border-white/15 backdrop-blur-sm text-center shadow-[0_10px_30px_rgba(0,0,0,0.35)]" data-testid="brain-toast">
              <span className="block truncate text-sm leading-5 font-bold" style={{ color: theme.accent }}>
                {t('rule.change')} · {t(`mechanics.${toast.copy}.title`)}
              </span>
              <span className="block line-clamp-3 text-[13px] leading-[17px] text-white/85">{t(`mechanics.${toast.copy}.body`)}</span>
            </p>
          )}
        </div>
      </div>

      <section className="relative flex flex-col items-center justify-center gap-5 pt-6 pb-10">
        {/* Not even the prompt moves while Quick Eye's display is measured. */}
        <p key={`${r.trialId}-${r.view.prompt.key}`} className={`${quietNow ? '' : 'bfx-rise '}text-xl font-semibold text-center min-h-8`} data-testid="brain-prompt">
          {t(r.view.prompt.key, r.view.prompt.params)}
        </p>
        <div className="relative w-full">
          {/* Sibling keys share one namespace: trial ids and effect ids both count from 1. */}
          <BrainBoard
            key={`board-${r.trialId}`}
            view={r.view}
            onTap={r.tap}
            onExposure={r.reportExposure}
            width={width}
            theme={theme}
            ready={quietNow && r.view.kind === 'quickEye' && r.view.phase === 'fixation'}
            onSkip={r.skipReveal}
            paused={r.paused || r.intro !== null || r.stageUp !== null}
          />
          {/* Level-up and streak news, over the top of the board — the prompt and the verdict line stay readable. */}
          {shownBanner && (
            <div key={`banner-${shownBanner.id}`} className="pointer-events-none absolute inset-x-0 top-3 z-10 flex justify-center" role="status">
              <span className="bfx-pop px-5 py-2.5 rounded-full text-lg font-extrabold text-slate-900 shadow-[0_10px_30px_rgba(0,0,0,0.35)]" style={{ background: `linear-gradient(90deg, #FDE68A, ${theme.accent})` }} data-testid="brain-banner">
                {shownBanner.text}
              </span>
            </div>
          )}
          {/* The verdict, big and brief, over the board. */}
          {burst && (
            <div key={`burst-${burst.id}`} className="pointer-events-none absolute inset-0 flex items-center justify-center" aria-hidden="true">
              <span
                className="bfx-pop flex items-center justify-center w-24 h-24 rounded-full"
                style={{ background: burst.ok ? 'rgba(34,197,94,0.92)' : 'rgba(239,68,68,0.92)', boxShadow: burst.ok ? '0 0 60px rgba(34,197,94,0.6)' : '0 0 60px rgba(239,68,68,0.5)', animation: 'bfx-pop 240ms cubic-bezier(.2,.9,.3,1.3), bfx-pulse 650ms ease-out' }}
              >
                {burst.ok ? <Check className="w-14 h-14 text-white" strokeWidth={3.5} /> : <X className="w-14 h-14 text-white" strokeWidth={3.5} />}
              </span>
            </div>
          )}
        </div>
        <div className="min-h-11 flex items-center justify-center" aria-live="polite">
          {r.result && (
            // Quick Eye's miss is a calm chip («that one was quick», amber-edged when right next to it).
            <p
              key={r.trialId}
              className={`bfx-rise font-bold flex items-center gap-2 ${qe && !r.result.correct && !r.result.void ? 'px-4 py-1 rounded-full bg-white/10 text-lg' : 'text-xl'}`}
              style={{ color: resultColor, border: qe && nearMiss && !r.result.correct ? `1.5px solid ${QE_WARM}` : undefined }}
              data-testid="brain-result"
            >
              {resultText}
            </p>
          )}
        </div>
      </section>

      {/* Quick Eye reached a stage: a short card between trials (a new rule's card, if any, comes after it). */}
      {r.stageUp && !r.over && <StageUpInterstitial key={r.stageUp.id} up={r.stageUp} theme={theme} width={width} ringSlots={platform.ringSlots} centerOnly={centerOnly} onAck={r.ackStageUp} />}

      {/* A rule met for the first time: the trial waits, clock stopped, until the player has read it. */}
      {r.intro && !r.over && !r.stageUp && <RuleCard key={r.intro.tag} copy={r.intro.copy} theme={theme} onAck={r.ackIntro} />}

      {r.paused && !sheetWanted && (
        <Overlay testId="brain-paused">
          <p className="text-3xl font-extrabold">{t('play.paused')}</p>
          <button type="button" onClick={r.resume} className="w-64 min-h-14 rounded-2xl bg-white text-lg font-bold border-none cursor-pointer" style={{ color: theme.cardTo }} autoFocus>
            {t('play.resume')}
          </button>
          <button type="button" onClick={askStop} className="w-64 min-h-12 rounded-2xl bg-white/10 hover:bg-white/20 text-base font-semibold text-white border-none cursor-pointer">
            {t('play.stop')}
          </button>
          <button
            type="button"
            role="switch"
            aria-checked={sound}
            onClick={() => setSettings({ sound: !sound })}
            className="flex items-center justify-center gap-2 w-64 min-h-12 rounded-2xl bg-transparent hover:bg-white/10 text-base text-white/85 border border-white/20 cursor-pointer"
            data-testid="brain-pause-sound"
          >
            {sound ? <Volume2 className="w-5 h-5" aria-hidden="true" /> : <VolumeX className="w-5 h-5" aria-hidden="true" />}
            {t('settings.sound')}
          </button>
        </Overlay>
      )}

      {confirming && (
        <Overlay testId="brain-stop-sheet" labelledBy="brain-stop-title">
          <p id="brain-stop-title" className="text-2xl font-extrabold">{t('play.stopTitle')}</p>
          <p className="text-base text-white/80 max-w-xs text-center">{t('play.stopBody')}</p>
          <button type="button" onClick={cancelStop} className="w-64 min-h-14 rounded-2xl bg-white text-lg font-bold border-none cursor-pointer" style={{ color: theme.cardTo }} autoFocus data-testid="brain-stop-cancel">
            {t('play.keepPlaying')}
          </button>
          <button
            type="button"
            onClick={() => { setSheetWanted(false); r.stop() }}
            className="w-64 min-h-12 rounded-2xl bg-white/10 hover:bg-white/20 text-base font-semibold text-white border-none cursor-pointer"
            data-testid="brain-stop-confirm"
          >
            {t('play.stopNow')}
          </button>
        </Overlay>
      )}

      {ending && (
        <Overlay testId="brain-round-over">
          <span className="bfx-pop flex items-center justify-center w-24 h-24 rounded-full bg-white/15">
            {r.stats.cleared && !qe ? <Trophy className="w-12 h-12" style={{ color: '#FDE68A' }} aria-hidden="true" /> : r.stats.endedBy === 'lives' ? <HeartCrack className="w-12 h-12 text-[#FB7185]" aria-hidden="true" /> : <Flag className="w-12 h-12" aria-hidden="true" />}
          </span>
          {/* Quick Eye's leg simply ends — «end of leg», never "over" or "cleared". */}
          <p className="bfx-rise text-3xl font-extrabold text-center">
            {r.stats.endedBy === 'void' ? t('summary.voided') : r.stats.endedBy === 'time' ? t('play.timeUp') : qe ? t('quickEye.legEnd') : r.stats.cleared ? t('play.roundCleared') : t('play.roundOver')}
          </p>
        </Overlay>
      )}
    </>
  )
}

/** Quick Eye's speed level, in quarters: a right answer fills one (two while the round is still unsure). */
function SpeedPips({ filled, label, accent }: { filled: number; label: string; accent: string }) {
  return (
    <span className="inline-flex shrink-0 items-center gap-1" role="img" aria-label={label} data-testid="brain-speed-pips">
      {Array.from({ length: QUICK_EYE_PIPS }, (_, i) => (
        <span key={i} className="w-2 h-2 rounded-full transition-colors duration-300" style={{ background: i < filled ? accent : 'rgba(255,255,255,0.25)' }} />
      ))}
    </span>
  )
}

/** Quick Eye's leg: a cell per counted trial — full when both answers were right, half for one of the two, empty for a miss. Never red. */
function LegBar({ marks, cap, accent }: { marks: readonly LegMark[]; cap: number; accent: string }) {
  const { t } = useTranslation('brain')
  const done = Math.min(cap, marks.length)
  return (
    <div className="flex gap-[3px]" role="progressbar" aria-valuemin={0} aria-valuemax={cap} aria-valuenow={done} aria-label={t('play.trial', { done, total: cap })} data-testid="brain-leg">
      {Array.from({ length: cap }, (_, i) => {
        const mark = marks[i]
        return (
          <span key={i} className="flex-1 h-2 rounded-full overflow-hidden" style={{ background: mark ? 'rgba(255,255,255,0.24)' : 'rgba(255,255,255,0.1)' }}>
            {(mark === 'ok' || mark === 'half') && <span className="block h-full rounded-full" style={{ width: mark === 'ok' ? '100%' : '50%', background: accent }} />}
          </span>
        )
      })}
    </div>
  )
}

/**
 * Quick Eye reached a stage: a short card between trials, the round paused under it (its time is
 * not played time). The stage stamp, what is new, that the flash starts a little slower, and the new
 * field faintly behind — unless a new rule's card follows, which explains it instead. It clears
 * itself after 2s (the round's own timer), or on a tap, Enter, Space or Escape.
 */
function StageUpInterstitial({ up, theme, width, ringSlots, centerOnly, onAck }: { up: StageUp; theme: GameTheme; width: number; ringSlots: number[]; centerOnly: boolean; onAck: () => void }) {
  const { t } = useTranslation('brain')
  const button = useRef<HTMLButtonElement>(null)
  const ack = useRef(onAck)
  useEffect(() => {
    ack.current = onAck
  })
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Escape') || e.target === button.current) return
      e.preventDefault()
      ack.current()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  // The real engine's flash at the new stage (its demo's flash frame), at a quarter strength. Not on
  // the centre-only setting: its demo is always the plain centre task, which is not what is new.
  const preview = useMemo(() => {
    if (up.ruleFollows || centerOnly) return null
    const view = buildDemo('quickEye', { variant: up.variant, centerOnly, ringSlots }).find((f) => f.flash)?.view
    return view?.kind === 'quickEye' ? view : null
  }, [up.ruleFollows, up.variant, centerOnly, ringSlots])
  return (
    <div
      className="fixed inset-0 z-40 flex flex-col items-center justify-center gap-3 bg-slate-950/75 backdrop-blur-md px-6 text-center cursor-pointer"
      role="dialog"
      aria-modal="true"
      aria-labelledby="brain-stage-up-title"
      onClick={onAck}
      data-testid="brain-stage-up"
    >
      <span className="bfx-pop flex items-center justify-center min-w-28 h-28 px-5 rounded-full border-4 text-3xl font-black" style={{ borderColor: QE_WARM, color: QE_WARM }}>
        {t('quickEye.stageUp.stage', { stage: up.to })}
      </span>
      <p id="brain-stage-up-title" className="text-3xl font-extrabold">{t('quickEye.stageUp.title')}</p>
      {up.knob && <p className="text-lg font-semibold max-w-xs" style={{ color: QE_WARM }}>{t(`quickEye.knob.${up.knob}`)}</p>}
      <p className="text-base text-white/80 max-w-xs">{t('quickEye.stageUp.ease')}</p>
      {preview && (
        <div className="pointer-events-none" style={{ opacity: 0.25 }} aria-hidden="true">
          <QuickEyeBoard view={preview} onTap={noop} onExposure={noop} width={Math.min(width, 200)} demo maxSize={200} />
        </div>
      )}
      <button
        ref={button}
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          onAck()
        }}
        autoFocus
        className="mt-2 w-64 min-h-14 rounded-2xl bg-white text-lg font-bold border-none cursor-pointer"
        style={{ color: theme.cardTo }}
        data-testid="brain-stage-up-continue"
      >
        {t('quickEye.stageUp.continue')}
      </button>
    </div>
  )
}

function Overlay({ children, testId, labelledBy }: { children: ReactNode; testId: string; labelledBy?: string }) {
  return (
    <div
      className="fixed inset-0 z-40 flex flex-col items-center justify-center gap-4 bg-slate-950/70 backdrop-blur-md px-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby={labelledBy}
      data-testid={testId}
    >
      {children}
    </div>
  )
}

/**
 * Drains from full to empty over the trial's limit — one Web Animation, not a re-render per tick.
 * The last third warms to amber and the last sixth to red, so time pressure is visible without a
 * ticking sound (which made timed tasks feel harder than they are for older players).
 */
function TimerBar({ timer, accent }: { timer: { startedAt: number; limitMs: number } | null; accent: string }) {
  const bar = useRef<HTMLDivElement>(null)
  const startedAt = timer?.startedAt
  const limitMs = timer?.limitMs
  useEffect(() => {
    const el = bar.current
    if (!el || startedAt === undefined || limitMs === undefined) return
    const elapsed = Math.max(0, Date.now() - startedAt)
    const from = Math.max(0, 1 - elapsed / limitMs)
    const anim = el.animate(
      [
        { transform: `scaleX(${from})`, backgroundColor: from > 0.33 ? accent : from > 0.16 ? '#FBBF24' : '#F87171' },
        ...(from > 0.33 ? [{ transform: 'scaleX(0.33)', backgroundColor: accent, offset: (from - 0.33) / from }] : []),
        ...(from > 0.16 ? [{ transform: 'scaleX(0.16)', backgroundColor: '#FBBF24', offset: (from - 0.16) / from }] : []),
        { transform: 'scaleX(0)', backgroundColor: '#F87171' },
      ],
      { duration: Math.max(0, limitMs - elapsed), easing: 'linear', fill: 'forwards' },
    )
    return () => anim.cancel()
  }, [startedAt, limitMs, accent])
  return (
    <div className="h-2 rounded-full bg-white/10 overflow-hidden" aria-hidden="true">
      {timer && <div ref={bar} className="h-full w-full rounded-full origin-left" style={{ background: accent }} />}
    </div>
  )
}

