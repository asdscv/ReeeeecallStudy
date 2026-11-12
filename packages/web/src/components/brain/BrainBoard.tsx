import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import type { ChoiceView, GridView, RoundView } from '@reeeeecall/shared/lib/brain-games'
import { INK, TONE_CLASS } from './brain-ui'

/** Draws whatever round the engine hands over. Two shapes cover all eight games. */
export function BrainBoard({ view, onTap }: { view: RoundView; onTap: (index: number) => void }) {
  return view.kind === 'grid' ? <Grid view={view} onTap={onTap} /> : <Choice view={view} onTap={onTap} />
}

function Grid({ view, onTap }: { view: GridView; onTap: (index: number) => void }) {
  const text = view.cols <= 3 ? 'text-5xl' : view.cols === 4 ? 'text-4xl' : view.cols === 5 ? 'text-3xl' : view.cols === 6 ? 'text-2xl' : 'text-xl'
  return (
    <div
      className="mx-auto grid gap-2 select-none"
      style={{
        gridTemplateColumns: `repeat(${view.cols}, minmax(0, 1fr))`,
        // Tall boards (the 4×6 matching game) must still fit above the fold.
        width: `min(100%, 30rem, calc((100dvh - 15rem) * ${view.cols} / ${view.rows}))`,
      }}
      data-testid="brain-grid"
    >
      {view.cells.map((cell, i) => (
        <button
          key={i}
          type="button"
          disabled={view.locked}
          onPointerDown={(e) => {
            // Pointer-down, not click: on touch screens a click waits for the finger to lift,
            // which is a perceptible lag in a game scored on speed.
            e.preventDefault()
            if (!view.locked) onTap(i)
          }}
          // Keyboard activation (Enter/Space) arrives as a click with detail 0.
          onClick={(e) => { if (e.detail === 0 && !view.locked) onTap(i) }}
          className={`aspect-square rounded-xl flex items-center justify-center font-semibold transition-all duration-150 border-none cursor-pointer disabled:cursor-default ${text} ${TONE_CLASS[cell.tone]}`}
          data-testid={`brain-cell-${i}`}
        >
          {cell.label && (
            <span style={cell.rotate ? { display: 'inline-block', transform: `rotate(${cell.rotate}deg)` } : undefined}>
              {cell.label}
            </span>
          )}
        </button>
      ))}
    </div>
  )
}

function Choice({ view, onTap }: { view: ChoiceView; onTap: (index: number) => void }) {
  const { t } = useTranslation('brain')
  const answered = view.correctIndex !== undefined

  // 1–6 on the keyboard pick an option — faster than the mouse on a desktop.
  useEffect(() => {
    if (answered) return
    const onKey = (e: KeyboardEvent) => {
      const n = Number(e.key)
      if (Number.isInteger(n) && n >= 1 && n <= view.options.length) onTap(n - 1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [answered, onTap, view.options.length])

  const stimulus = view.stimulus.textKey ? t(view.stimulus.textKey) : view.stimulus.text
  const long = (stimulus?.length ?? 0) > 14
  return (
    <div className="mx-auto w-full max-w-md space-y-6 select-none">
      <div
        className={`min-h-28 flex items-center justify-center rounded-2xl bg-card border border-border px-4 text-center font-bold tracking-wide ${long ? 'text-3xl' : 'text-5xl'}`}
        style={view.stimulus.color ? { color: INK[view.stimulus.color] } : undefined}
        data-testid="brain-stimulus"
      >
        {stimulus}
      </div>
      <div className={`grid gap-3 ${view.options.length > 4 ? 'grid-cols-3' : 'grid-cols-2'}`}>
        {view.options.map((o, i) => {
          let tone = 'bg-card border border-border hover:border-brand text-foreground'
          if (answered && i === view.correctIndex) tone = 'bg-success text-white border border-success'
          else if (answered && i === view.picked) tone = 'bg-destructive text-white border border-destructive'
          else if (answered) tone = 'bg-card border border-border text-content-tertiary'
          return (
            <button
              key={i}
              type="button"
              disabled={answered}
              onPointerDown={(e) => {
                e.preventDefault()
                if (!answered) onTap(i)
              }}
              onClick={(e) => { if (e.detail === 0 && !answered) onTap(i) }}
              className={`h-16 rounded-xl text-xl font-semibold transition-colors cursor-pointer disabled:cursor-default ${tone}`}
              data-testid={`brain-option-${i}`}
            >
              {o.textKey ? t(o.textKey) : o.text}
            </button>
          )
        })}
      </div>
    </div>
  )
}
