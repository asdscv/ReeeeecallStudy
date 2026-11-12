import { useEffect, useRef, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { Star, Crown, RotateCcw, LayoutGrid, Target, Flame, ListChecks, TrendingUp, Timer } from 'lucide-react'
import { formatCount } from '@reeeeecall/shared/lib/format-number'
import { GAME_THEMES, brainGame, displayLevel, gameHistory, quickEyeMaxLevel, quickEyeMsAt, roundStars, type BrainGameId, type GameTheme } from '@reeeeecall/shared/lib/brain-games'
import type { RoundStats } from '@reeeeecall/shared/hooks/useBrainRound'
import { useBrainStore } from '@reeeeecall/shared/stores/brain-store'
import { Confetti, GameCanvas } from './GameCanvas'
import { useCountUp } from './useCountUp'
import { focusIfKeyboard } from './brain-ui'
import { sfx } from './sfx'

/**
 * The end of a free-practice round, on the game's canvas: stars for how the round went, the score
 * counting up, the level it moved to, a personal best when there is one, and the recent trend.
 * The level is this game's record only, never a measure of memory (the copy says so).
 */
export function RoundSummary({ gameId, stats, onAgain }: { gameId: BrainGameId; stats: RoundStats; onAgain: () => void }) {
  const { t } = useTranslation('brain')
  const theme = GAME_THEMES[gameId]
  const history = useBrainStore((s) => s.history)
  const best = useBrainStore((s) => s.progress.bestRuns[gameId])
  const trend = gameHistory(history, gameId)
  const accuracy = stats.trials > 0 ? Math.round((stats.correct / stats.trials) * 100) : 0
  const stars = roundStars(stats.trials, stats.correct)
  const score = useCountUp(stats.points)
  const title = stats.endedBy === 'cap' ? t('summary.cleared') : stats.endedBy === 'stop' ? t('summary.stopped') : t('summary.livesOut')
  // Quick Eye's level is its flash time: shorter is better.
  const qe = gameId === 'quickEye'
  const from = qe ? quickEyeMsAt(stats.levelStart) : displayLevel(stats.levelStart)
  const to = qe ? quickEyeMsAt(stats.levelEnd) : displayLevel(stats.levelEnd)
  const seconds = Math.round(stats.activeMs / 1000)

  const again = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    focusIfKeyboard(again.current)
  }, [])
  // The stars land one after another, each with its own tick.
  useEffect(() => {
    const timers = Array.from({ length: stars }, (_, i) => setTimeout(() => sfx.play({ kind: 'hit', cell: 0, step: 3 + i * 2 }), 450 + i * 220))
    return () => timers.forEach(clearTimeout)
  }, [stars])

  return (
    <GameCanvas theme={theme} testId="brain-summary">
      {stats.isNewBest && <Confetti colors={['#FDE68A', theme.accent, '#FFFFFF', '#FB7185', '#86EFAC']} />}
      <div className="max-w-md mx-auto px-4 py-8 min-h-dvh flex flex-col justify-center gap-5">
        <div className="text-center space-y-2">
          <p className="text-base font-semibold" style={{ color: theme.accent }}>{t(`games.${gameId}.name`)}</p>
          <h1 className="bfx-rise text-4xl font-extrabold">{title}</h1>
        </div>

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
        </div>

        {stats.isNewBest && (
          <p className="bfx-pop flex items-center justify-center gap-2 mx-auto px-5 py-2.5 rounded-full text-lg font-extrabold text-slate-900" style={{ background: 'linear-gradient(90deg,#FDE68A,#FCD34D)' }} data-testid="brain-new-best">
            <Crown className="w-5 h-5" aria-hidden="true" />
            {t('summary.newBest')}
          </p>
        )}

        {stats.trials > 0 && <LevelCard from={from} to={to} qe={qe} qeLevel={stats.levelEnd} span={brainGame(gameId).group === 'span'} theme={theme} />}

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

function LevelCard({ from, to, qe, qeLevel, span, theme }: { from: number; to: number; qe: boolean; qeLevel: number; span: boolean; theme: GameTheme }) {
  const { t } = useTranslation('brain')
  const up = qe ? to < from : to > from
  const fmt = (v: number) => (qe ? `${v}ms` : v.toFixed(1))
  // The bar shows where in the current whole level the player now stands (Quick Eye: how far down
  // its ladder of flash times).
  const frac = qe ? qeLevel / quickEyeMaxLevel(33) : to - Math.floor(to)
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
