import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { X, Pause, Play, Heart, Flame, Check, Trophy, Flag, HeartCrack } from 'lucide-react'
import { formatCount } from '@reeeeecall/shared/lib/format-number'
import { GAME_THEMES, comboMultiplier, maxColsFor, streakTier, type BrainGameId, type GameTheme } from '@reeeeecall/shared/lib/brain-games'
import { useBrainRound, type RoundStats } from '@reeeeecall/shared/hooks/useBrainRound'
import { useBrainFx, type BrainFx } from '@reeeeecall/shared/hooks/useBrainFx'
import { useBrainStore } from '@reeeeecall/shared/stores/brain-store'
import { BrainBoard } from './BrainBoard'
import { Countdown, GameCanvas } from './GameCanvas'
import { webPlatform } from './brain-ui'
import { sfx } from './sfx'

/**
 * A round of one game, full screen on the game's canvas: a countdown, then trials until the
 * chances run out, the round's cap is reached, or the player stops. The board's width is measured
 * first — the round is built for it (the column cap keeps every cell ≥ 56px).
 */
export function RoundView({
  gameId,
  onOver,
  caption,
  countdown = true,
}: {
  gameId: BrainGameId
  onOver: (stats: RoundStats) => void
  caption?: string
  countdown?: boolean
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
            <Round gameId={gameId} onOver={onOver} caption={caption} width={width} theme={theme} />
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
}

function Round({ gameId, onOver, caption, width, theme }: { gameId: BrainGameId; onOver: (stats: RoundStats) => void; caption?: string; width: number; theme: GameTheme }) {
  const { t } = useTranslation('brain')
  const [platform] = useState(() => webPlatform(width, maxColsFor(width)))
  const r = useBrainRound(gameId, platform)
  const timing = useBrainStore((s) => s.progress.settings.timing)
  const variant = useBrainStore((s) => s.progress.quickEye.variant)
  const reported = useRef(false)
  const [pops, setPops] = useState<Pop[]>([])
  const [banner, setBanner] = useState<{ id: number; text: string } | null>(null)
  const [burst, setBurst] = useState<{ id: number; ok: boolean } | null>(null)
  const [heartHit, setHeartHit] = useState(0)
  const [confirming, setConfirming] = useState(false)
  const [ending, setEnding] = useState(false)
  const seq = useRef(0)

  // Number Hunt spends lives per wrong tap inside a grid; show them going as they go, not when the
  // grid ends.
  const liveLives = gameId === 'schulte' && typeof r.view.prompt.params?.lives === 'number' && !r.result ? Number(r.view.prompt.params.lives) : r.lives

  const onFx = useCallback(
    (fx: BrainFx) => {
      sfx.play(fx)
      const id = ++seq.current
      if (fx.kind === 'correct') {
        setBurst({ id, ok: true })
        if (!fx.practice && fx.points > 0) setPops((p) => [...p.slice(-3), { id, text: `+${formatCount(fx.points)}` }])
        if ([5, 10, 15, 20, 30, 40, 50].includes(fx.streak)) setBanner({ id, text: t('play.streakBanner', { value: fx.streak }) })
      }
      if (fx.kind === 'wrong') {
        setBurst({ id, ok: false })
        navigator.vibrate?.(40)
      }
      if (fx.kind === 'miss') navigator.vibrate?.(30)
      if (fx.kind === 'lifeLost') setHeartHit(id)
      if (fx.kind === 'levelUp' && gameId !== 'quickEye') setBanner({ id, text: t('play.levelUpBanner', { level: fx.level }) })
      if (fx.kind === 'levelUp' && gameId === 'quickEye') setBanner({ id, text: t('play.fasterBanner') })
      if (fx.kind === 'roundEnd' && fx.reason !== 'stop') setEnding(true)
    },
    [gameId, t],
  )
  useBrainFx(r, onFx)

  useEffect(() => {
    if (!banner) return
    const tm = setTimeout(() => setBanner(null), 1600)
    return () => clearTimeout(tm)
  }, [banner])
  useEffect(() => {
    if (!burst) return
    const tm = setTimeout(() => setBurst(null), 650)
    return () => clearTimeout(tm)
  }, [burst])

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
  const askStop = () => {
    if (r.stats.trials === 0) return r.stop()
    pausedForSheet.current = r.canPause && !r.paused
    if (pausedForSheet.current) r.pause()
    setConfirming(true)
  }
  const cancelStop = () => {
    setConfirming(false)
    if (pausedForSheet.current) r.resume()
    pausedForSheet.current = false
  }

  // Escape pauses (or closes the stop sheet); the pause screen's buttons take over from there.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (confirming) return cancelStop()
      if (r.paused) r.resume()
      else if (r.canPause) r.pause()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const levelText = gameId === 'quickEye' ? `${t('quickEye.stage', { stage: variant })} · ${t('quickEye.speedStep', { step: Math.round(r.level) })}` : t('home.level', { level: r.level.toFixed(1) })
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
  const tier = streakTier(r.stats.streak)
  const capProgress = r.roundCap !== null && !r.practice ? r.trialInRound / r.roundCap : null

  return (
    <>
      <header className="flex items-center gap-2 pt-4 pb-1 min-h-[72px]">
        <button
          type="button"
          onClick={askStop}
          className="flex items-center gap-1.5 min-h-11 px-3 rounded-xl bg-white/10 hover:bg-white/20 border-none text-white text-base cursor-pointer"
          data-testid="brain-finish"
        >
          <X className="w-5 h-5" aria-hidden="true" />
          <span className="hidden sm:inline">{t('play.stop')}</span>
        </button>
        <div className="flex-1 min-w-0 text-center">
          {caption && <p className="text-sm text-white/70 truncate">{caption}</p>}
          <h1 className="text-lg font-bold truncate">{t(`games.${gameId}.name`)}</h1>
          <p className="text-sm font-medium" style={{ color: theme.accent }} data-testid="brain-level">{levelText}</p>
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

      {/* Score, run and chances. */}
      <div className="flex items-center justify-between gap-3 min-h-12">
        <div className="relative min-w-24">
          <p className="text-3xl font-black tabular-nums leading-none" style={{ textShadow: `0 0 24px ${theme.glow}` }} data-testid="brain-score">
            {formatCount(r.stats.points)}
          </p>
          <p className="text-xs font-semibold uppercase tracking-wider text-white/60 mt-1">{t('play.score')}</p>
          {pops.map((p) => (
            <span
              key={p.id}
              className="absolute top-0 text-xl font-extrabold pointer-events-none whitespace-nowrap"
              style={{ left: 'calc(100% + 8px)', color: theme.accent, animation: 'bfx-float 900ms ease-out forwards' }}
              onAnimationEnd={() => setPops((list) => list.filter((x) => x.id !== p.id))}
              aria-hidden="true"
            >
              {p.text}
            </span>
          ))}
        </div>

        {tier > 0 && !r.practice ? (
          <div
            key={tier}
            className="bfx-pop flex items-center gap-1.5 px-3 h-10 rounded-full text-base font-bold"
            style={{ background: tier >= 3 ? 'linear-gradient(90deg,#F59E0B,#EF4444)' : tier === 2 ? 'rgba(251,146,60,0.9)' : 'rgba(255,255,255,0.14)' }}
            data-testid="brain-streak"
          >
            <Flame className="w-5 h-5" aria-hidden="true" />
            <span>{t('play.streakCount', { value: r.stats.streak })}</span>
            <span className="text-white/80 text-sm">×{comboMultiplier(r.stats.streak)}</span>
          </div>
        ) : (
          <div />
        )}

        {r.practice ? (
          <p className="text-sm font-semibold px-3 h-10 flex items-center rounded-full bg-white/15" data-testid="brain-lives">
            {t('play.practice', { done: Math.min(r.practiceTotal, r.practiceDone + (r.result ? 0 : 1)), total: r.practiceTotal })}
          </p>
        ) : (
          <span
            key={heartHit}
            className={`flex items-center gap-1 ${heartHit ? 'bfx-shake' : ''}`}
            role="img"
            aria-label={t(r.group === 'span' ? 'play.livesSpan' : 'play.lives', { value: liveLives })}
            data-testid="brain-lives"
          >
            {Array.from({ length: r.maxLives }, (_, i) =>
              i < liveLives ? (
                <Heart key={i} className="w-6 h-6 fill-[#FB7185] text-[#FB7185] drop-shadow-[0_0_8px_rgba(251,113,133,0.6)]" aria-hidden="true" />
              ) : (
                <HeartCrack key={i} className="w-6 h-6 text-white/30" aria-hidden="true" />
              ),
            )}
          </span>
        )}
      </div>

      {r.practice && <p className="text-center text-sm text-white/75 mt-1">{t('play.practiceHint')}</p>}

      {/* The round's progress (capped rounds), then this trial's clock. */}
      <div className="mt-3 space-y-1.5">
        {capProgress !== null && (
          <div className="h-1.5 rounded-full bg-white/10 overflow-hidden" aria-hidden="true">
            <div className="h-full rounded-full transition-[width] duration-300" style={{ width: `${capProgress * 100}%`, background: 'rgba(255,255,255,0.55)' }} />
          </div>
        )}
        <TimerBar key={r.trialId} timer={r.timer} accent={theme.accent} />
      </div>

      <section className="relative flex flex-col items-center justify-center gap-5 pt-6 pb-10">
        <p key={`${r.trialId}-${r.view.prompt.key}`} className="bfx-rise text-xl font-semibold text-center min-h-8" data-testid="brain-prompt">
          {t(r.view.prompt.key, r.view.prompt.params)}
        </p>
        <div className="relative w-full">
          <BrainBoard key={r.trialId} view={r.view} onTap={r.tap} onExposure={r.reportExposure} width={width} theme={theme} />
          {/* The verdict, big and brief, over the board. */}
          {burst && (
            <div key={burst.id} className="pointer-events-none absolute inset-0 flex items-center justify-center" aria-hidden="true">
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
          {banner ? (
            <span key={banner.id} className="bfx-pop px-5 py-2.5 rounded-full text-lg font-extrabold text-slate-900 shadow-[0_10px_30px_rgba(0,0,0,0.35)]" style={{ background: `linear-gradient(90deg, #FDE68A, ${theme.accent})` }} data-testid="brain-banner">
              {banner.text}
            </span>
          ) : r.result && (
            <p
              key={r.trialId}
              className="bfx-rise text-xl font-bold flex items-center gap-2"
              style={{ color: r.result.void ? 'rgba(255,255,255,0.7)' : r.result.correct ? '#86EFAC' : '#FCA5A5' }}
              data-testid="brain-result"
            >
              {resultText}
            </p>
          )}
        </div>

      </section>

      {r.paused && !confirming && (
        <Overlay testId="brain-paused">
          <p className="text-3xl font-extrabold">{t('play.paused')}</p>
          <button type="button" onClick={r.resume} className="w-64 min-h-14 rounded-2xl bg-white text-lg font-bold border-none cursor-pointer" style={{ color: theme.cardTo }} autoFocus>
            {t('play.resume')}
          </button>
          <button type="button" onClick={askStop} className="w-64 min-h-12 rounded-2xl bg-white/10 hover:bg-white/20 text-base font-semibold text-white border-none cursor-pointer">
            {t('play.stop')}
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
            onClick={() => { setConfirming(false); r.stop() }}
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
            {r.stats.endedBy === 'cap' ? <Trophy className="w-12 h-12" style={{ color: '#FDE68A' }} aria-hidden="true" /> : r.stats.endedBy === 'lives' ? <HeartCrack className="w-12 h-12 text-[#FB7185]" aria-hidden="true" /> : <Flag className="w-12 h-12" aria-hidden="true" />}
          </span>
          <p className="bfx-rise text-3xl font-extrabold">{r.stats.endedBy === 'cap' ? t('play.roundCleared') : t('play.roundOver')}</p>
        </Overlay>
      )}
    </>
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

