import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { Star, Crown, RotateCcw, LayoutGrid, Target, Flame, ListChecks, TrendingUp, Timer, Hourglass, Check } from 'lucide-react'
import { formatCount } from '@reeeeecall/shared/lib/format-number'
import { GAME_THEMES, brainGame, displayLevel, gameHistory, gameProgress, quickEyeBarLevel, roundStars, type BrainGameId, type GameTheme } from '@reeeeecall/shared/lib/brain-games'
import type { RoundStats, ScoreParts } from '@reeeeecall/shared/hooks/useBrainRound'
import { useBrainStore } from '@reeeeecall/shared/stores/brain-store'
import { Confetti, GameCanvas } from './GameCanvas'
import { useCountUp } from './useCountUp'
import { focusIfKeyboard } from './brain-ui'
import { quickEyeSpeedLevel, tierLook, tierStanding } from './tier-ui'
import { TierMedal, TierMeter } from './TierBadge'
import { AchievementCards } from './AchievementsGrid'
import { sfx } from './sfx'

/**
 * The end of a free-practice round, on the game's canvas: stars for how the round went, the score
 * counting up and where it came from, the level it moved to, the game's tier, and the recent trend.
 * One celebration per round — a new tier first, then an achievement, then a personal best; the
 * others show as quiet lines. The level is this game's record only, never a measure of memory.
 *
 * Quick Eye's leg has no stars (its staircase holds every player near 80% right, so accuracy stars
 * would say nothing): «end of leg», the speed level from → to, a stage reached, and the next goal —
 * staying near the speed level that passes the stage.
 */
export function RoundSummary({ gameId, stats, onAgain }: { gameId: BrainGameId; stats: RoundStats; onAgain: () => void }) {
  const { t } = useTranslation('brain')
  const theme = GAME_THEMES[gameId]
  const history = useBrainStore((s) => s.history)
  const progress = useBrainStore((s) => s.progress)
  const meta = useBrainStore((s) => s.meta)
  const best = progress.bestRuns[gameId]
  const trend = gameHistory(history, gameId)
  const accuracy = stats.trials > 0 ? Math.round((stats.correct / stats.trials) * 100) : 0
  // Quick Eye's level is its speed level, a whole number: higher is better, like every other game.
  const qe = gameId === 'quickEye'
  const stars = qe ? 0 : roundStars(stats.trials, stats.correct)
  const score = useCountUp(stats.points)
  const title =
    stats.endedBy === 'void'
      ? t('summary.voided')
      : stats.endedBy === 'stop'
        ? t('summary.stopped')
        : qe
          ? t('quickEye.legEnd')
          : stats.cleared
            ? t('summary.cleared')
            : t('summary.livesOut')
  const from = qe ? quickEyeSpeedLevel(stats.levelStart) : displayLevel(stats.levelStart)
  const to = qe ? quickEyeSpeedLevel(stats.levelEnd) : displayLevel(stats.levelEnd)
  const seconds = Math.round(stats.activeMs / 1000)
  const standing = tierStanding(gameId, meta, progress)
  const hasRounds = gameProgress(progress, gameId).rounds > 0 || standing.tier > 0
  const hero: 'tier' | 'achievement' | 'best' | null = stats.tierUp ? 'tier' : stats.achievements.length > 0 ? 'achievement' : stats.isNewBest ? 'best' : null
  const confetti = stats.tierUp ? [tierLook(stats.tierUp).solid, '#FFFFFF', '#FDE68A', theme.accent] : ['#FDE68A', theme.accent, '#FFFFFF', '#FB7185', '#86EFAC']

  const again = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    focusIfKeyboard(again.current)
  }, [])
  // The stars land one after another, each with its own tick.
  useEffect(() => {
    const timers = Array.from({ length: stars }, (_, i) => setTimeout(() => sfx.play({ kind: 'hit', cell: 0, step: 3 + i * 2 }), 450 + i * 220))
    return () => timers.forEach(clearTimeout)
  }, [stars])
  // A new tier or an achievement gets the fanfare here (a personal best already had it as the round ended).
  useEffect(() => {
    if (hero !== 'tier' && hero !== 'achievement') return
    if (stats.isNewBest) return
    const tm = setTimeout(() => sfx.play({ kind: 'newBest' }), 300)
    return () => clearTimeout(tm)
  }, [hero, stats.isNewBest])

  return (
    <GameCanvas theme={theme} testId="brain-summary">
      {hero && <Confetti colors={confetti} />}
      <div className="max-w-md mx-auto px-4 py-8 min-h-dvh flex flex-col justify-center gap-5">
        <div className="text-center space-y-2">
          <p className="text-base font-semibold" style={{ color: theme.accent }}>{t(`games.${gameId}.name`)}</p>
          <h1 className="bfx-rise text-4xl font-extrabold">{title}</h1>
        </div>

        {stats.tierUp && <TierUp tier={stats.tierUp} game={t(`games.${gameId}.name`)} />}

        {stars > 0 && (
          <div className="flex items-end justify-center gap-3" role="img" aria-label={t('summary.stars', { value: stars })}>
            {[0, 1, 2].map((i) => (
              <Star
                key={i}
                className={`${i === 1 ? 'w-16 h-16 -translate-y-2' : 'w-12 h-12'} ${i < stars ? 'fill-[#FDE68A] text-[#FDE68A] drop-shadow-[0_0_18px_rgba(253,230,138,0.7)]' : 'text-white/20'}`}
                style={i < stars ? { animation: `bfx-pop 320ms cubic-bezier(.2,.9,.3,1.4) ${450 + i * 220}ms both` } : undefined}
                aria-hidden="true"
              />
            ))}
          </div>
        )}

        <div className="text-center">
          <p className="text-6xl font-black tabular-nums" style={{ textShadow: `0 0 40px ${theme.glow}` }} data-testid="brain-summary-score">
            {formatCount(score)}
          </p>
          <p className="text-sm font-semibold uppercase tracking-wider text-white/60 mt-1">{t('summary.points')}</p>
          {/* Compared only with the player's own past — and never in red. */}
          {!stats.isNewBest && best !== undefined && best > stats.points && (
            <p className="mt-2 text-base text-white/75" data-testid="brain-summary-best">{t('home.record', { value: formatCount(best) })}</p>
          )}
          {/* A personal best under a bigger moment is a line, not a second celebration. */}
          {stats.isNewBest && hero !== 'best' && (
            <p className="mt-2 flex items-center justify-center gap-1.5 text-base font-semibold text-[#FDE68A]" data-testid="brain-new-best">
              <Crown className="w-4 h-4" aria-hidden="true" />
              {t('summary.newBest')}
            </p>
          )}
        </div>

        {hero === 'best' && (
          <p className="bfx-pop flex items-center justify-center gap-2 mx-auto px-5 py-2.5 rounded-full text-lg font-extrabold text-slate-900" style={{ background: 'linear-gradient(90deg,#FDE68A,#FCD34D)' }} data-testid="brain-new-best">
            <Crown className="w-5 h-5" aria-hidden="true" />
            {t('summary.newBest')}
          </p>
        )}

        <AchievementCards ids={stats.achievements} delayMs={stats.tierUp ? 700 : 300} />

        {hasRounds && <TierMeter standing={standing} accent={theme.accent} testId="brain-summary-tier" />}

        {/* A placement stopped part-way has no level yet — its probe levels are not progress. */}
        {stats.trials > 0 && stats.placement !== 'partial' && <LevelCard from={from} to={to} qe={qe} span={brainGame(gameId).group === 'span'} theme={theme} stage={qe ? stats.stageReached : null} />}

        {qe && stats.trials > 0 && stats.placement !== 'partial' && (
          <p className="text-center text-base font-medium text-white/85" data-testid="brain-summary-next-goal">
            {t('quickEye.nextGoal', { level: quickEyeBarLevel(progress.quickEye.variant) })}
          </p>
        )}

        <ScoreBreakdown score={stats.score} total={stats.points} />

        <div className="grid grid-cols-2 gap-2">
          <Stat icon={<ListChecks className="w-5 h-5" aria-hidden="true" />} label={t('summary.trials')} value={formatCount(stats.trials)} />
          <Stat icon={<Target className="w-5 h-5" aria-hidden="true" />} label={t('summary.accuracy')} value={`${accuracy}%`} />
          <Stat icon={<Flame className="w-5 h-5" aria-hidden="true" />} label={t('summary.bestStreak')} value={formatCount(stats.bestStreak)} />
          <Stat icon={<Timer className="w-5 h-5" aria-hidden="true" />} label={t('summary.time')} value={`${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`} />
        </div>

        {trend.length >= 2 && (
          <div className="rounded-2xl bg-white/[0.07] border border-white/10 p-4">
            <p className="flex items-center gap-2 text-sm font-semibold text-white/80">
              <TrendingUp className="w-4 h-4" aria-hidden="true" />
              {t('summary.trend')}
            </p>
            <Sparkline values={trend.map((h) => h.level)} color={theme.accent} />
          </div>
        )}

        {stats.suggestRelax && <RelaxCard onDone={() => focusIfKeyboard(again.current)} />}

        <div className="flex flex-col gap-2 pt-2">
          <button
            ref={again}
            type="button"
            onClick={onAgain}
            className="w-full min-h-16 flex items-center justify-center gap-2 rounded-2xl bg-white text-xl font-extrabold border-none cursor-pointer shadow-[0_14px_40px_rgba(0,0,0,0.35)] hover:scale-[1.01] active:scale-[0.98] transition-transform"
            style={{ color: theme.cardTo }}
            data-testid="brain-again"
          >
            <RotateCcw className="w-6 h-6" aria-hidden="true" />
            {t('summary.again')}
          </button>
          <Link
            to="/brain"
            className="w-full min-h-14 flex items-center justify-center gap-2 rounded-2xl bg-white/10 hover:bg-white/20 text-lg font-semibold text-white no-underline"
            data-testid="brain-summary-home"
          >
            <LayoutGrid className="w-5 h-5" aria-hidden="true" />
            {t('summary.otherGames')}
          </Link>
        </div>
      </div>
    </GameCanvas>
  )
}

/** A tier reached this round: the medal, its name, and which game — said once, here. */
function TierUp({ tier, game }: { tier: number; game: string }) {
  const { t } = useTranslation('brain')
  const name = t(`tiers.t${tier}`)
  return (
    <div className="flex flex-col items-center text-center gap-3" role="status" data-testid="brain-tier-up">
      <TierMedal tier={tier} />
      <p className="bfx-rise text-3xl font-extrabold" style={{ color: tierLook(tier).solid }}>{t('tiers.up', { tier: name })}</p>
      <p className="text-base text-white/85 max-w-xs">{t('tiers.upBody', { game, tier: name })}</p>
    </div>
  )
}

const SCORE_ROWS: readonly (keyof ScoreParts)[] = ['base', 'speed', 'combo', 'clear', 'clean']

/** Where the round's points came from — only the parts that scored, then the total. */
function ScoreBreakdown({ score, total }: { score: ScoreParts; total: number }) {
  const { t } = useTranslation('brain')
  const rows = SCORE_ROWS.map((k) => [k, Math.round(score[k])] as const).filter(([, v]) => v > 0)
  if (rows.length === 0) return null
  return (
    <div className="rounded-2xl bg-white/[0.07] border border-white/10 px-4 py-3" data-testid="brain-score-breakdown">
      <table className="w-full text-base">
        <caption className="text-left text-sm font-semibold text-white/80 pb-1.5">{t('breakdown.title')}</caption>
        <tbody>
          {rows.map(([k, v]) => (
            <tr key={k}>
              <th scope="row" className="py-1 text-left font-normal text-white/80">{t(`breakdown.${k}`)}</th>
              <td className="py-1 text-right font-semibold tabular-nums">{k === 'base' ? '' : '+'}{formatCount(v)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t border-white/15">
            <th scope="row" className="pt-2 text-left font-bold">{t('breakdown.total')}</th>
            <td className="pt-2 text-right font-extrabold tabular-nums">{formatCount(total)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  )
}

/** Rounds in a row ended early on chances: relaxed timing is offered — a suggestion, never switched on for the player. */
function RelaxCard({ onDone }: { onDone: () => void }) {
  const { t } = useTranslation('brain')
  const setSettings = useBrainStore((s) => s.setSettings)
  const [on, setOn] = useState(false)
  return (
    <div className="rounded-2xl bg-white/[0.07] border border-white/10 p-4 space-y-3" data-testid="brain-relax">
      <p className="flex items-start gap-2 text-base text-white/90">
        <Hourglass className="w-5 h-5 mt-0.5 shrink-0" aria-hidden="true" />
        {t('relax.suggest')}
      </p>
      <div aria-live="polite">
        {on ? (
          <p className="flex items-center gap-2 min-h-12 text-base font-semibold text-[#86EFAC]" data-testid="brain-relax-on">
            <Check className="w-5 h-5" aria-hidden="true" />
            {t('relax.on')}
          </p>
        ) : (
          <button
            type="button"
            onClick={() => {
              setSettings({ timing: 1.5 })
              setOn(true)
              onDone()
            }}
            className="w-full min-h-12 rounded-xl bg-white/15 hover:bg-white/25 text-base font-bold text-white border-none cursor-pointer"
            data-testid="brain-relax-turn-on"
          >
            {t('relax.turnOn')}
          </button>
        )}
      </div>
    </div>
  )
}

function LevelCard({ from, to, qe, span, theme, stage = null }: { from: number; to: number; qe: boolean; span: boolean; theme: GameTheme; stage?: number | null }) {
  const { t } = useTranslation('brain')
  const up = to > from
  const fmt = (v: number) => (qe ? String(v) : v.toFixed(1))
  // The bar shows where in the current whole level the player now stands (Quick Eye: how far along
  // its speed levels).
  const frac = qe ? to / 11 : to - Math.floor(to)
  return (
    <div className="rounded-2xl bg-white/[0.07] border border-white/10 p-4" data-testid="brain-summary-level">
      <div className="flex items-baseline justify-between">
        <span className="text-sm font-semibold text-white/80">{qe ? t('intro.speed') : t('intro.level')}</span>
        <span className="text-lg font-bold tabular-nums">
          {fmt(from)} <span className="text-white/50">→</span> <span style={{ color: up ? '#86EFAC' : '#fff' }}>{fmt(to)}</span>
        </span>
      </div>
      {/* Span games move a whole length at a time: no "part-way" bar for them. */}
      {!span && (
        <div className="mt-3 h-2.5 rounded-full bg-white/10 overflow-hidden">
          <div className="h-full rounded-full" style={{ width: `${Math.max(4, frac * 100)}%`, background: theme.accent, transition: 'width 900ms cubic-bezier(.2,.8,.2,1)' }} />
        </div>
      )}
      {up && <p className="mt-2 text-sm font-medium text-[#86EFAC]">{t('summary.improved')}</p>}
      {/* Quick Eye: a stage reached this leg (the speed level eases back three steps with it, so say why). */}
      {stage !== null && (
        <p className="mt-2 text-sm font-medium text-[#86EFAC]" data-testid="brain-summary-stage">
          {t('quickEye.stageUp.title')} · {t('quickEye.stage', { stage })}
        </p>
      )}
    </div>
  )
}

function Stat({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-white/[0.07] border border-white/10 p-3">
      <p className="flex items-center gap-1.5 text-sm text-white/75">{icon}{label}</p>
      <p className="mt-1 text-2xl font-bold tabular-nums">{value}</p>
    </div>
  )
}

/** A small line of the recent rounds' levels; the last point is the round just played. */
export function Sparkline({ values, color, height = 56 }: { values: number[]; color: string; height?: number }) {
  const w = 300
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = max - min || 1
  // A flat run sits mid-height, not on the floor.
  const pts = values.map((v, i) => [(i / Math.max(1, values.length - 1)) * (w - 12) + 6, max === min ? height / 2 : height - 6 - ((v - min) / span) * (height - 12)])
  const d = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ')
  const last = pts[pts.length - 1]
  return (
    <svg viewBox={`0 0 ${w} ${height}`} className="w-full mt-2" style={{ height }} aria-hidden="true">
      <path d={`${d} L${last[0]},${height} L${pts[0][0]},${height} Z`} fill={color} opacity={0.15} />
      <path d={d} fill="none" stroke={color} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={last[0]} cy={last[1]} r={5} fill="#fff" stroke={color} strokeWidth={2.5} />
    </svg>
  )
}

export { Stat }
