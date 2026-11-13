import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Lightbulb, Info } from 'lucide-react'
import type { GameTheme } from '@reeeeecall/shared/lib/brain-games'

/**
 * A rule the player has not met yet, told before the trial that uses it. The trial is held with
 * its clock stopped until "got it", and is played unscored — so nobody meets a new rule cold
 * inside a timed trial. White card on the game's dark canvas; the board stays faintly visible.
 */
export function RuleCard({ copy, theme, onAck, noLives = false }: { copy: string; theme: GameTheme; onAck: () => void; noLives?: boolean }) {
  const { t } = useTranslation('brain')
  const button = useRef<HTMLButtonElement>(null)
  const ack = useRef(onAck)
  useEffect(() => {
    ack.current = onAck
  })
  // Enter takes it from anywhere on the page (the button has focus already, and handles its own).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Enter' || e.target === button.current) return
      e.preventDefault()
      ack.current()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/55 backdrop-blur-[2px] px-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="brain-rule-title"
      aria-describedby="brain-rule-body"
      data-testid="brain-rule-card"
    >
      <div className="bfx-pop w-full max-w-sm rounded-3xl bg-white text-slate-900 p-6 shadow-[0_24px_70px_rgba(0,0,0,0.5)]">
        {/* The theme's accent is a canvas colour (too light for ink on white): it fills the label, the deep card colour writes it. */}
        <p className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-bold" style={{ background: theme.accent, color: theme.cardTo }}>
          <Lightbulb className="w-4 h-4" aria-hidden="true" />
          {t('rule.label')}
        </p>
        <h2 id="brain-rule-title" className="mt-2 text-2xl font-extrabold leading-snug">{t(`mechanics.${copy}.title`)}</h2>
        <p id="brain-rule-body" className="mt-2 text-lg leading-relaxed text-slate-700">{t(`mechanics.${copy}.body`)}</p>
        <p className="mt-4 flex items-start gap-1.5 text-sm text-slate-500">
          <Info className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />
          {/* A game without chances (Quick Eye) must not say the trial spares one. */}
          {t(noLives ? 'rule.unscoredNoLives' : 'rule.unscored')}
        </p>
        <button
          ref={button}
          type="button"
          onClick={onAck}
          autoFocus
          className="mt-5 w-full min-h-14 rounded-2xl text-lg font-extrabold text-white border-none cursor-pointer shadow-[0_10px_28px_rgba(0,0,0,0.25)] hover:scale-[1.01] active:scale-[0.98] transition-transform"
          style={{ background: `linear-gradient(135deg, ${theme.cardFrom} 0%, ${theme.cardTo} 100%)` }}
          data-testid="brain-rule-ok"
        >
          {t('rule.gotIt')}
        </button>
      </div>
    </div>
  )
}
