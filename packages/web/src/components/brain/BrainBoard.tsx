import { useEffect, type CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, X } from 'lucide-react'
import { CANVAS_TONES, type CellTone, type CellView, type ChoiceView, type GameTheme, type GridView, type RoundView } from '@reeeeecall/shared/lib/brain-games'
import { INK } from './brain-ui'
import { QuickEyeBoard } from './QuickEyeBoard'

/**
 * Draws whatever the engine hands over — a grid, a pick-one choice, or Quick Eye's field — on the
 * game's dark canvas. `demo` draws the same board for the how-to-play player: smaller, never
 * focusable, never taking input.
 */
export interface BoardProps {
  view: RoundView
  onTap: (index: number) => void
  onExposure: (actualMs: number, frameMs: number) => void
  width: number
  theme: GameTheme
  demo?: boolean
  /** The tallest the board may be (defaults to what is left of the window). */
  maxHeight?: number
}

export function BrainBoard(props: BoardProps) {
  const { view } = props
  if (view.kind === 'grid') return <Grid {...props} view={view} />
  if (view.kind === 'choice') return <Choice {...props} view={view} />
  return <QuickEyeBoard view={view} onTap={props.onTap} onExposure={props.onExposure} width={props.width} theme={props.theme} demo={props.demo} maxSize={props.maxHeight} />
}

// The same gap maxColsFor() assumes, or the widest grid would overflow its board.
const GAP = 8

/** Each tone as a face: what it looks like, and the motion it enters with. */
function face(tone: CellTone, theme: GameTheme): { style: CSSProperties; anim: string; icon?: 'check' | 'x' } {
  const glass: CSSProperties = { background: CANVAS_TONES.tile, border: `1.5px solid ${CANVAS_TONES.tileBorder}`, color: CANVAS_TONES.text }
  switch (tone) {
    case 'lit':
      return { style: { background: CANVAS_TONES.lit, color: '#0F172A', boxShadow: `0 0 0 3px ${theme.accent}, 0 0 32px ${theme.glow}` }, anim: 'bfx-lit' }
    case 'correct':
      return { style: { background: CANVAS_TONES.correct, color: '#fff', boxShadow: '0 0 24px rgba(34,197,94,0.55)' }, anim: 'bfx-pop', icon: 'check' }
    case 'wrong':
      return { style: { background: CANVAS_TONES.wrong, color: '#fff', boxShadow: '0 0 24px rgba(239,68,68,0.5)' }, anim: 'bfx-shake', icon: 'x' }
    case 'missed':
      return { style: { ...glass, outline: `3px dashed ${theme.accent}`, outlineOffset: -7 }, anim: 'bfx-pulse' }
    case 'faceDown':
      return {
        style: {
          background: `radial-gradient(circle at 30% 25%, rgba(255,255,255,0.28) 0, transparent 38%), linear-gradient(135deg, ${theme.cardFrom}, ${theme.cardTo})`,
          border: '1.5px solid rgba(255,255,255,0.28)',
          boxShadow: '0 6px 16px rgba(0,0,0,0.35)',
        },
        anim: '',
      }
    case 'faceUp':
      return { style: { background: '#FFFFFF', color: '#0F172A', boxShadow: '0 6px 18px rgba(0,0,0,0.3)' }, anim: 'bfx-flip' }
    case 'matched':
      return { style: { background: 'rgba(255,255,255,0.85)', color: '#0F172A', boxShadow: `0 0 0 3px ${CANVAS_TONES.correct}`, opacity: 0.6, transform: 'scale(0.92)' }, anim: 'bfx-pop', icon: 'check' }
    case 'done':
      return { style: { background: CANVAS_TONES.done, border: '1.5px solid rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.32)' }, anim: '' }
    default:
      return { style: glass, anim: '' }
  }
}

function Cell({ cell, index, size, font, locked, demo, theme, onTap }: { cell: CellView; index: number; size: number; font: number; locked: boolean; demo?: boolean; theme: GameTheme; onTap: (i: number) => void }) {
  const f = face(cell.tone, theme)
  const iconSize = cell.label ? Math.max(14, size * 0.22) : Math.max(20, size * 0.42)
  const tappable = !locked && !demo && cell.tone !== 'done' && cell.tone !== 'matched'
  return (
    <button
      type="button"
      disabled={locked || demo}
      tabIndex={demo ? -1 : undefined}
      aria-hidden={demo || undefined}
      aria-label={demo ? undefined : cell.label ?? String(index + 1)}
      onPointerDown={(e) => {
        // Pointer-down, not click: on touch screens a click waits for the finger to lift, which is
        // a perceptible lag in a game scored on speed.
        e.preventDefault()
        if (!locked && !demo) onTap(index)
      }}
      // Keyboard activation (Enter/Space) arrives as a click with detail 0.
      onClick={(e) => { if (e.detail === 0 && !locked && !demo) onTap(index) }}
      className={`relative p-0 border-none bg-transparent rounded-2xl outline-offset-4 ${tappable ? 'cursor-pointer active:scale-[0.93] transition-transform duration-75' : 'cursor-default'}`}
      style={{ width: size, height: size }}
      data-testid={demo ? undefined : `brain-cell-${index}`}
      data-tap={index}
    >
      {/* Keyed by tone so each change replays its entrance (pop, shake, flip). */}
      <span
        key={cell.tone}
        className={`absolute inset-0 rounded-2xl flex items-center justify-center font-bold select-none transition-colors duration-150 ${f.anim} ${tappable ? 'hover:brightness-125' : ''}`}
        style={{ ...f.style, fontSize: font }}
      >
        {cell.label && (
          <span style={cell.rotate ? { display: 'inline-block', transform: `rotate(${cell.rotate}deg)` } : undefined}>{cell.label}</span>
        )}
        {f.icon && (
          <span
            className={cell.label ? 'absolute top-1 right-1 rounded-full flex items-center justify-center' : 'flex items-center justify-center'}
            style={cell.label ? { background: f.icon === 'check' ? CANVAS_TONES.correct : CANVAS_TONES.wrong, width: iconSize + 6, height: iconSize + 6, color: '#fff' } : undefined}
          >
            {f.icon === 'check' ? <Check style={{ width: iconSize, height: iconSize }} strokeWidth={3} aria-hidden="true" /> : <X style={{ width: iconSize, height: iconSize }} strokeWidth={3} aria-hidden="true" />}
          </span>
        )}
      </span>
    </button>
  )
}

function Grid({ view, onTap, width, theme, demo, maxHeight }: BoardProps & { view: GridView }) {
  // Cells never shrink below 56px in play (the engine caps the column count to keep them there);
  // tall boards — the 4×6 matching game — still have to fit above the fold. The demo board is small.
  const minCell = demo ? 28 : 56
  const maxW = demo ? width : Math.min(width, 500)
  const availH = maxHeight ?? Math.max(360, window.innerHeight - 330)
  const byWidth = (maxW - GAP * (view.cols - 1)) / view.cols
  const byHeight = (availH - GAP * (view.rows - 1)) / view.rows
  const cell = Math.max(minCell, Math.floor(Math.min(byWidth, byHeight, demo ? 72 : 120)))
  const font = Math.max(demo ? 14 : 28, Math.round(cell * 0.44))
  return (
    <div
      className="mx-auto grid select-none"
      style={{ gridTemplateColumns: `repeat(${view.cols}, ${cell}px)`, gap: GAP, width: cell * view.cols + GAP * (view.cols - 1) }}
      data-testid={demo ? undefined : 'brain-grid'}
    >
      {view.cells.map((c, i) => (
        <Cell key={i} cell={c} index={i} size={cell} font={font} locked={view.locked} demo={demo} theme={theme} onTap={onTap} />
      ))}
    </div>
  )
}

function Choice({ view, onTap, demo }: BoardProps & { view: ChoiceView }) {
  const { t } = useTranslation('brain')
  const answered = view.correctIndex !== undefined

  // 1–6 on the keyboard pick an option — faster than the mouse on a desktop.
  useEffect(() => {
    if (answered || demo) return
    const onKey = (e: KeyboardEvent) => {
      const n = Number(e.key)
      if (Number.isInteger(n) && n >= 1 && n <= view.options.length) onTap(n - 1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [answered, onTap, view.options.length, demo])

  const stimulus = view.stimulus.textKey ? t(view.stimulus.textKey) : view.stimulus.text
  const long = (stimulus?.length ?? 0) > 14
  const size = demo ? (long ? 'text-xl' : 'text-3xl') : long ? 'text-4xl sm:text-5xl' : 'text-6xl sm:text-7xl'
  return (
    <div className={`mx-auto w-full select-none ${demo ? 'max-w-[300px] space-y-3' : 'max-w-md space-y-6'}`}>
      {/* The stimulus on a white card: ink colours keep their contrast whatever the game's canvas. */}
      <div
        key={`${stimulus}-${view.stimulus.color ?? ''}`}
        className={`bfx-rise flex items-center justify-center rounded-3xl bg-white px-4 text-center font-extrabold tracking-wide shadow-[0_18px_40px_rgba(0,0,0,0.35)] ${demo ? 'min-h-20' : 'min-h-36'} ${size}`}
        style={{ color: view.stimulus.color ? INK[view.stimulus.color] : '#0F172A' }}
        data-testid={demo ? undefined : 'brain-stimulus'}
      >
        {stimulus}
      </div>
      <div className={`grid ${demo ? 'gap-2' : 'gap-3'} ${view.options.length > 4 ? 'grid-cols-3' : 'grid-cols-2'}`}>
        {view.options.map((o, i) => {
          const isRight = answered && i === view.correctIndex
          const isPicked = answered && i === view.picked
          let style: CSSProperties = { background: CANVAS_TONES.tile, border: `1.5px solid ${CANVAS_TONES.tileBorder}`, color: '#fff' }
          let anim = ''
          if (isRight) {
            style = { background: CANVAS_TONES.correct, border: `1.5px solid ${CANVAS_TONES.correct}`, color: '#fff', boxShadow: '0 0 24px rgba(34,197,94,0.5)' }
            anim = 'bfx-pop'
          } else if (isPicked) {
            style = { background: CANVAS_TONES.wrong, border: `1.5px solid ${CANVAS_TONES.wrong}`, color: '#fff' }
            anim = 'bfx-shake'
          } else if (answered) style = { ...style, opacity: 0.4 }
          return (
            <button
              key={i}
              type="button"
              disabled={answered || demo}
              tabIndex={demo ? -1 : undefined}
              aria-hidden={demo || undefined}
              onPointerDown={(e) => {
                e.preventDefault()
                if (!answered && !demo) onTap(i)
              }}
              onClick={(e) => { if (e.detail === 0 && !answered && !demo) onTap(i) }}
              className={`relative rounded-2xl font-bold transition-[transform,background-color] duration-100 ${demo ? 'min-h-11 text-base' : 'min-h-[72px] text-2xl'} ${!answered && !demo ? 'cursor-pointer hover:bg-white/20 active:scale-[0.96]' : 'cursor-default'} ${anim}`}
              style={style}
              data-testid={demo ? undefined : `brain-option-${i}`}
              data-tap={i}
            >
              {!demo && !answered && (
                <span className="hidden md:flex absolute top-2 left-2.5 text-xs font-semibold text-white/60" aria-hidden="true">{i + 1}</span>
              )}
              <span className="inline-flex items-center gap-2">
                {isRight && <Check className="w-6 h-6" strokeWidth={3} aria-hidden="true" />}
                {isPicked && !isRight && <X className="w-6 h-6" strokeWidth={3} aria-hidden="true" />}
                {o.textKey ? t(o.textKey) : o.text}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
