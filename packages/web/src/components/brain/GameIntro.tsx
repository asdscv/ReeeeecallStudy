import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { X, Play, Trophy, Gauge, Sparkles } from 'lucide-react'
import { formatCount } from '@reeeeecall/shared/lib/format-number'
import { GAME_THEMES, brainGame, dayNumber, displayLevel, gameProgress, localDayKey, type BrainGameId } from '@reeeeecall/shared/lib/brain-games'
import { useBrainStore } from '@reeeeecall/shared/stores/brain-store'
import { BRAIN_ICONS, cardBackground, focusIfKeyboard } from './brain-ui'
import { DemoPlayer } from './DemoPlayer'
import { GameCanvas } from './GameCanvas'
import { TierMeter } from './TierBadge'
import { tierStanding } from './tier-ui'

/**
 * Before a game: what it is, a demo of how it plays, where the player stands, and one big start.
 * Free practice shows it every time a game is opened; Today's Training shows it as each game of the
 * session comes up, with the session's steps across the top.
 */
export function GameIntro({
  gameId,
  onStart,
  onClose,
  closeLabel,
  steps,
}: {
  gameId: BrainGameId
  onStart: () => void
  onClose: () => void
  closeLabel: string
  /** Today's Training: the session's games and which one is next. */
  steps?: { games: BrainGameId[]; index: number; label: string }
}) {
  const { t } = useTranslation('brain')
  const theme = GAME_THEMES[gameId]
  const entry = brainGame(gameId)
  const Icon = BRAIN_ICONS[entry.icon]
  const progress = useBrainStore((s) => s.progress)
  const meta = useBrainStore((s) => s.meta)
  const p = gameProgress(progress, gameId)
  const best = progress.bestRuns[gameId]
  const firstTime = !progress.practiced.includes(gameId)
  const standing = tierStanding(gameId, meta, progress)
  const played = p.rounds > 0 || standing.tier > 0
  const est = meta.sk[gameId]
  // The round's first trials find the start (the engine's own condition: never played, or a
  // placement left part-way). Match Pairs and the span games start from a guess instead.
  const placementNext = entry.group !== 'span' && gameId !== 'pairs' && ((p.rounds === 0 && !est) || (est !== undefined && est.n === 0))
  // Back after two weeks or more: the first trials re-find the level (bigger steps), never "your level dropped".
  const welcomeBack = !placementNext && est !== undefined && est.day > 0 && dayNumber(localDayKey()) - est.day >= 14

  const measure = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(360)
  // The content width: clientWidth counts the container's own 16px gutters.
  useLayoutEffect(() => {
    if (measure.current) setWidth(measure.current.clientWidth - 32)
  }, [])

  const start = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    focusIfKeyboard(start.current)
  }, [gameId])

  return (
    <GameCanvas theme={theme} testId="brain-intro">
      <div className="max-w-xl mx-auto px-4" ref={measure}>
        <header className="flex items-center gap-3 pt-4 min-h-16">
          <button
            type="button"
            onClick={onClose}
            className="flex items-center gap-1.5 min-h-11 px-3 rounded-xl bg-white/10 hover:bg-white/20 border-none text-white text-base cursor-pointer"
            data-testid="brain-intro-close"
          >
            <X className="w-5 h-5" aria-hidden="true" />
            {closeLabel}
          </button>
          {steps && (
            <ol className="flex-1 flex items-center justify-end gap-1.5" aria-label={steps.label}>
              {steps.games.map((g, i) => {
                const StepIcon = BRAIN_ICONS[brainGame(g).icon]
                const state = i < steps.index ? 'done' : i === steps.index ? 'now' : 'next'
                return (
                  <li
                    key={i}
                    className={`w-10 h-10 rounded-xl flex items-center justify-center ${state === 'now' ? 'ring-2 ring-white' : ''}`}
                    style={{ background: state === 'next' ? 'rgba(255,255,255,0.1)' : cardBackground(GAME_THEMES[g]), opacity: state === 'done' ? 0.55 : 1 }}
                    aria-current={state === 'now' ? 'step' : undefined}
                    aria-label={t(`games.${g}.name`)}
                  >
                    {StepIcon && <StepIcon className="w-5 h-5 text-white" aria-hidden="true" />}
                  </li>
                )
              })}
            </ol>
          )}
        </header>

        <section className="bfx-rise flex flex-col items-center text-center gap-2 pt-2">
          <div
            className="w-20 h-20 rounded-[24px] flex items-center justify-center shadow-[0_18px_50px_rgba(0,0,0,0.45)]"
            style={{ background: cardBackground(theme), boxShadow: `0 0 0 1px rgba(255,255,255,0.18) inset, 0 16px 48px ${theme.glow}` }}
          >
            {Icon && <Icon className="w-10 h-10 text-white" strokeWidth={1.75} aria-hidden="true" />}
          </div>
          {steps && <p className="text-base font-semibold" style={{ color: theme.accent }}>{t('training.slot', { index: steps.index + 1, total: steps.games.length })}</p>}
          <h1 className="text-4xl font-extrabold tracking-tight">{t(`games.${gameId}.name`)}</h1>
          <p className="text-lg text-white/80 max-w-md">{t(`games.${gameId}.desc`)}</p>
          {played && (
            <div className="w-full mt-2">
              <TierMeter standing={standing} accent={theme.accent} compact testId="brain-intro-tier" />
            </div>
          )}
        </section>

        <section className="mt-5 space-y-2" aria-labelledby="brain-howto">
          <h2 id="brain-howto" className="text-sm font-semibold uppercase tracking-wider text-white/70">{t('intro.howTo')}</h2>
          <DemoPlayer gameId={gameId} width={width} />
        </section>

        <div className="mt-4 grid grid-cols-3 gap-2">
          {/* No level yet for a game never played or a placement left part-way (n = 0) — not its interim probe level. */}
          <IntroStat
            icon={<Gauge className="w-5 h-5" aria-hidden="true" />}
            label={t('intro.level')}
            value={p.rounds === 0 || est?.n === 0 ? '—' : displayLevel(p.level).toFixed(1)}
            accent={theme.accent}
          />
          <IntroStat icon={<Sparkles className="w-5 h-5" aria-hidden="true" />} label={t('intro.rounds')} value={formatCount(p.rounds)} accent={theme.accent} />
          <IntroStat icon={<Trophy className="w-5 h-5" aria-hidden="true" />} label={t('intro.best')} value={best ? formatCount(best) : '—'} accent={theme.accent} />
        </div>

        {(firstTime || placementNext || welcomeBack) && (
          <div className="mt-4 space-y-1.5 text-center text-base text-white/80" data-testid="brain-intro-notes">
            {firstTime && <p>{t('intro.practiceNote')}</p>}
            {placementNext && <p>{t('intro.firstPlacement')}</p>}
            {welcomeBack && <p>{t('intro.welcomeBack')}</p>}
          </div>
        )}

        {/* Start stays in reach on short screens: it rides the bottom edge until the page ends. */}
        <div className="sticky bottom-0 -mx-4 px-4 pt-6 pb-4" style={{ background: `linear-gradient(to top, ${theme.canvasFrom} 55%, transparent)` }}>
          <button
            ref={start}
            type="button"
            onClick={onStart}
            className="w-full min-h-16 flex items-center justify-center gap-2 rounded-2xl bg-white text-xl font-extrabold border-none cursor-pointer shadow-[0_14px_40px_rgba(0,0,0,0.35)] hover:scale-[1.01] active:scale-[0.98] transition-transform"
            style={{ color: theme.cardTo }}
            data-testid="brain-intro-start"
          >
            <Play className="w-6 h-6 fill-current" aria-hidden="true" />
            {t('intro.start')}
          </button>
        </div>
      </div>
    </GameCanvas>
  )
}

function IntroStat({ icon, label, value, accent }: { icon: ReactNode; label: string; value: string; accent: string }) {
  return (
    <div className="rounded-2xl bg-white/[0.07] border border-white/10 px-3 py-3 text-center">
      <div className="flex items-center justify-center gap-1.5 text-sm text-white/75" style={{ color: accent }}>
        {icon}
        <span className="text-white/80">{label}</span>
      </div>
      <p className="mt-1 text-2xl font-bold tabular-nums">{value}</p>
    </div>
  )
}
