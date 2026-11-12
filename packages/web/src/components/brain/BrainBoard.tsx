import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import type { ChoiceView, GridView, RoundView } from '@reeeeecall/shared/lib/brain-games'
import { INK, TONE_CLASS } from './brain-ui'
import { QuickEyeBoard } from './QuickEyeBoard'

/** Draws whatever the engine hands over: a grid, a pick-one choice, or Quick Eye's field. */
export function BrainBoard({
  view,
  onTap,
  onExposure,
  width,
}: {
  view: RoundView
  onTap: (index: number) => void
  onExposure: (actualMs: number, frameMs: number) => void
  width: number
}) {
  if (view.kind === 'grid') return <Grid view={view} onTap={onTap} width={width} />
  if (view.kind === 'choice') return <Choice view={view} onTap={onTap} />
  return <QuickEyeBoard view={view} onTap={onTap} onExposure={onExposure} width={width} />
}

const GAP = 8

function Grid({ view, onTap, width }: { view: GridView; onTap: (index: number) => void; width: number }) {
  // Cells never shrink below 56px (the engine caps the column count to keep them there); tall
  // boards — the 4×6 matching game — still have to fit above the fold.
  const byWidth = (Math.min(width, 480) - GAP * (view.cols - 1)) / view.cols
  const byHeight = (Math.max(360, window.innerHeight - 300) - GAP * (view.rows - 1)) / view.rows
  const cell = Math.max(56, Math.floor(Math.min(byWidth, byHeight)))
  const font = Math.max(28, Math.round(cell * 0.42))
  return (
    <div
      className="mx-auto grid select-none"
      style={{ gridTemplateColumns: `repeat(${view.cols}, ${cell}px)`, gap: GAP, width: cell * view.cols + GAP * (view.cols - 1) }}
      data-testid="brain-grid"
    >
      {view.cells.map((c, i) => (
        <button
          key={i}
          type="button"
          disabled={view.locked}
          aria-label={c.label ?? String(i + 1)}
          onPointerDown={(e) => {
            // Pointer-down, not click: on touch screens a click waits for the finger to lift,
            // which is a perceptible lag in a game scored on speed.
            e.preventDefault()
            if (!view.locked) onTap(i)
          }}
          // Keyboard activation (Enter/Space) arrives as a click with detail 0.
          onClick={(e) => { if (e.detail === 0 && !view.locked) onTap(i) }}
          className={`rounded-xl flex items-center justify-center font-semibold transition-colors duration-150 border-none cursor-pointer disabled:cursor-default ${TONE_CLASS[c.tone]}`}
          style={{ width: cell, height: cell, fontSize: font }}
          data-testid={`brain-cell-${i}`}
        >
          {c.label && (
            <span style={c.rotate ? { display: 'inline-block', transform: `rotate(${c.rotate}deg)` } : undefined}>{c.label}</span>
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
        className={`min-h-32 flex items-center justify-center rounded-2xl bg-card border border-border px-4 text-center font-bold tracking-wide ${long ? 'text-4xl' : 'text-6xl'}`}
        style={view.stimulus.color ? { color: INK[view.stimulus.color] } : undefined}
        data-testid="brain-stimulus"
      >
        {stimulus}
      </div>
      <div className={`grid gap-3 ${view.options.length > 4 ? 'grid-cols-3' : 'grid-cols-2'}`}>
        {view.options.map((o, i) => {
          let tone = 'bg-card border-2 border-border hover:border-brand text-foreground'
          if (answered && i === view.correctIndex) tone = 'bg-success text-success-foreground border-2 border-success'
          else if (answered && i === view.picked) tone = 'bg-destructive text-destructive-foreground border-2 border-destructive'
          else if (answered) tone = 'bg-card border-2 border-border text-muted-foreground'
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
              className={`min-h-16 px-2 rounded-xl text-2xl font-semibold transition-colors cursor-pointer disabled:cursor-default ${tone}`}
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
