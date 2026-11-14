import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { useReducedMotion } from 'motion/react'
import { BookOpen, Check, Copy, Droplet, Undo2, X, type LucideIcon } from 'lucide-react'
import { CANVAS_TONES, type CellTone, type CellView, type ChoiceView, type GameTheme, type GridView, type RoundView } from '@reeeeecall/shared/lib/brain-games'
import { SetMatchBoard, CodeBreakBoard, MakeNumberBoard, MazeBoard } from './ThinkingBoards'
import { BOARD_STRIP_H, CELL_INK, INK, boardHeight } from './brain-ui'

/**
 * Draws whatever the engine hands over — a grid or a pick-one choice — on the game's dark canvas. `demo` draws the same board for the how-to-play player: smaller, never
 * focusable, never taking input.
 *
 * Around a grid: a strip above it (header badge, chip, Flash Grid's waves, Match Pairs' miss
 * budget), a memorise bar under it, Odd One Out's «없음» button below and its miss chip / «없었어요»
 * stamp over it. Around a choice: Color Word's cue strip and frame ring, the expression as tokens or
 * Number Pattern's row as tiles, and what the engine reveals once the trial is over.
 */
export interface BoardProps {
  view: RoundView
  onTap: (index: number) => void
  width: number
  theme: GameTheme
  demo?: boolean
  /** The tallest the board may be (defaults to what is left of the window). */
  maxHeight?: number
  /** Move on from the answer's reveal (a tap on the board, Space / Enter): a choice's worked line. */
  onSkip?: () => void
  /** The round is paused, or a card is over it: a memorise bar holds where it is. */
  paused?: boolean
}

export function BrainBoard(props: BoardProps) {
  // Very short exposures must show the stimulus immediately, for its full allotted duration.
  return props.view.difficulty === 'extreme'
    ? <div className="contents" data-brain-extreme><BoardContent {...props} /></div>
    : <BoardContent {...props} />
}

function BoardContent(props: BoardProps) {
  const { view } = props
  if (view.kind === 'grid') return <Grid {...props} view={view} />
  if (view.kind === 'choice') return <Choice {...props} view={view} />
  if (view.kind === 'setMatch') return <SetMatchBoard {...props} view={view} />
  if (view.kind === 'codeBreak') return <CodeBreakBoard {...props} view={view} />
  if (view.kind === 'makeNumber') return <MakeNumberBoard {...props} view={view} />
  return <MazeBoard {...props} view={view} />
}

// The same gap maxColsFor() assumes, or the widest grid would overflow its board.
const GAP = 8

/**
 * What the last board in play looked like, so the next one can show what changed: a board that grew
 * slides its new rows in, and Color Word's cue strip flips when the rule switched. Kept per game
 * (by its theme); demo boards never touch it.
 */
const memory: { theme: GameTheme | null; cols: number; rows: number; cue: 'ink' | 'word' | null } = { theme: null, cols: 0, rows: 0, cue: null }

/** Numbers as the reader's locale writes them (1,203 · 1.203 · 1 203). */
function useNumberFormat(): (v: number) => string {
  const { i18n } = useTranslation('brain')
  const lang = i18n.resolvedLanguage ?? i18n.language
  return useMemo(() => {
    let nf: Intl.NumberFormat
    try {
      nf = new Intl.NumberFormat(lang || undefined)
    } catch {
      nf = new Intl.NumberFormat()
    }
    return (v: number) => nf.format(v)
  }, [lang])
}

/** A `brain` prompt, with string params that are themselves `brain` keys translated (colour names). */
function usePromptText(): (p: { key: string; params?: Record<string, string | number> }) => string {
  const { t, i18n } = useTranslation('brain')
  return (p) => {
    const params: Record<string, string | number> = {}
    for (const [k, v] of Object.entries(p.params ?? {})) params[k] = typeof v === 'string' && v.includes('.') && i18n.exists(v, { ns: 'brain' }) ? t(v) : v
    return t(p.key, params)
  }
}

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
      // Found numbers fade but stay readable (Number Hunt).
      return { style: { background: CANVAS_TONES.done, border: '1.5px solid rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.45)' }, anim: '' }
    default:
      return { style: glass, anim: '' }
  }
}

/** Tones drawn on the dark glass, where a label's own ink reads; the rest have their own fill. */
const INKABLE: readonly CellTone[] = ['idle', 'missed', 'done']

/**
 * A cell's label: mirrored first, then turned (`rotate(θ) scaleX(-1)` — CSS applies the list right
 * to left), in its ink, boxed when it is the second series.
 */
function Glyph({ cell, upright = false }: { cell: CellView; upright?: boolean }) {
  const turn = [!upright && cell.rotate ? `rotate(${cell.rotate}deg)` : '', cell.mirror ? 'scaleX(-1)' : ''].filter(Boolean).join(' ')
  const inked = cell.ink !== undefined && INKABLE.includes(cell.tone)
  const style: CSSProperties = {
    display: 'inline-block',
    ...(turn ? { transform: turn } : {}),
    ...(inked && cell.ink ? { color: CELL_INK[cell.ink], ...(cell.tone === 'done' ? { opacity: 0.6 } : {}) } : {}),
    ...(cell.boxed ? { border: '0.09em solid currentColor', borderRadius: '0.3em', padding: '0.02em 0.16em', lineHeight: 1.1 } : {}),
  }
  return (
    <span style={style} data-mirror={cell.mirror || undefined} data-boxed={cell.boxed || undefined}>
      {cell.label}
    </span>
  )
}

function Cell({ cell, index, size, font, locked, demo, theme, enter, onTap }: { cell: CellView; index: number; size: number; font: number; locked: boolean; demo?: boolean; theme: GameTheme; enter?: boolean; onTap: (i: number) => void }) {
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
      // A new row slides in; filled backwards only, so the press scale still works once it is in.
      style={{ width: size, height: size, ...(enter ? { animation: 'bfx-rise 260ms ease-out backwards' } : {}) }}
      data-testid={demo ? undefined : `brain-cell-${index}`}
      data-tap={index}
    >
      {/* Keyed by tone so each change replays its entrance (pop, shake, flip). */}
      <span
        key={cell.tone}
        className={`absolute inset-0 rounded-2xl flex items-center justify-center font-bold select-none transition-colors duration-150 ${f.anim} ${tappable ? 'hover:brightness-125' : ''}`}
        style={{ ...f.style, fontSize: font }}
      >
        {cell.label && <Glyph cell={cell} />}
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

function Grid({ view, onTap, width, theme, demo, maxHeight, paused }: BoardProps & { view: GridView }) {
  const { t } = useTranslation('brain')
  const reduced = useReducedMotion()
  const strip = view.badge !== undefined || view.chip !== undefined || view.progress !== undefined || view.budget !== undefined
  // Cells never shrink below 56px in play (the engine caps the columns and rows to keep them there);
  // tall boards — the 4×6 matching game, a portrait Flash Grid — still have to fit above the fold,
  // with the strip above and the «없음» button below. The demo board is small.
  const minCell = demo ? 28 : 56
  const maxW = demo ? width : Math.min(width, 500)
  const stripH = strip ? (demo ? 30 : BOARD_STRIP_H) : 0
  const extraH = view.extra ? (demo ? 44 : 72) : 0
  const availH = (maxHeight ?? boardHeight()) - stripH - extraH
  const byWidth = (maxW - GAP * (view.cols - 1)) / view.cols
  const byHeight = (availH - GAP * (view.rows - 1)) / view.rows
  const cell = Math.max(minCell, Math.floor(Math.min(byWidth, byHeight, demo ? 72 : 120)))
  const font = Math.max(demo ? 14 : 28, Math.round(cell * 0.44))
  const gridW = cell * view.cols + GAP * (view.cols - 1)

  // A board bigger than the last one slides its new rows (and columns) in.
  const [grewFrom] = useState(() =>
    !demo && memory.theme === theme && memory.rows > 0 && (view.rows > memory.rows || view.cols > memory.cols) ? { rows: memory.rows, cols: memory.cols } : null,
  )
  useEffect(() => {
    if (demo) return
    memory.theme = theme
    memory.rows = view.rows
    memory.cols = view.cols
  }, [demo, theme, view.rows, view.cols])

  // A search board (not a memorise phase) comes up all at once with a 120ms fade; its clock already runs.
  const gridRef = useRef<HTMLDivElement>(null)
  const fadeIn = useRef(!demo && !view.locked)
  useLayoutEffect(() => {
    if (fadeIn.current) gridRef.current?.animate?.([{ opacity: 0 }, { opacity: 1 }], { duration: 120, easing: 'ease-out' })
  }, [])

  // Number Hunt's alternation: a two-series legend over the board for its first 600ms (counted from
  // when the board is in view, not under a rule card or a pause).
  const [legend, setLegend] = useState(() => !demo && !view.locked && view.cells.some((c) => c.boxed))
  useEffect(() => {
    if (!legend || paused) return
    const tm = setTimeout(() => setLegend(false), 600)
    return () => clearTimeout(tm)
  }, [legend, paused])

  // A wrong tap (or a chance spent on one) pulses the chip as well as shaking the cell.
  const wrongs = view.cells.reduce((n, c) => n + (c.tone === 'wrong' ? 1 : 0), 0)
  const lives = typeof view.prompt.params?.lives === 'number' ? Number(view.prompt.params.lives) : null
  const [nudge, setNudge] = useState({ wrongs, lives, n: 0 })
  if (wrongs !== nudge.wrongs || lives !== nudge.lives) {
    const worse = wrongs > nudge.wrongs || (lives !== null && nudge.lives !== null && lives < nudge.lives)
    setNudge({ wrongs, lives, n: nudge.n + (worse ? 1 : 0) })
  }

  // «없음» from the keyboard: N, or Space when no button has the focus (a focused cell's Space is its own).
  const extra = view.extra
  const extraLive = extra !== undefined && !view.locked && !demo
  useEffect(() => {
    if (!extraLive || !extra) return
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return
      const isN = e.code === 'KeyN' || e.key === 'n' || e.key === 'N'
      const isSpace = e.code === 'Space' || e.key === ' '
      if (!isN && !isSpace) return
      if (isSpace && e.target instanceof Element && e.target.closest('button, a, input, textarea, select, [role="button"]')) return
      e.preventDefault()
      onTap(extra.index)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [extraLive, extra, onTap])

  // The memorise bar restarts with each thing shown (a wave, the preview); a pause holds it.
  const showKey = view.showBar ? `${view.showBar.ms}:${view.progress?.kind === 'waves' ? view.progress.done : ''}:${view.cells.map((c) => c.tone).join(',')}` : ''
  // Odd One Out's miss chip sits in the half away from the odd cell, so its pulse stays in view.
  const oddAt = view.cells.findIndex((c) => c.tone === 'missed' || c.tone === 'correct')
  const chipAtTop = oddAt >= 0 && Math.floor(oddAt / view.cols) >= view.rows / 2

  return (
    <div className="mx-auto flex flex-col items-center select-none" style={{ width: Math.max(gridW, Math.min(maxW, demo ? gridW : 320)) }}>
      {strip && <Strip view={view} theme={theme} demo={demo} nudge={nudge.n} />}
      <div className="relative" style={{ width: gridW }}>
        <div
          ref={gridRef}
          className="grid"
          style={{ gridTemplateColumns: `repeat(${view.cols}, ${cell}px)`, gap: GAP, width: gridW }}
          data-testid={demo ? undefined : 'brain-grid'}
        >
          {view.cells.map((c, i) => (
            <Cell
              key={i}
              cell={c}
              index={i}
              size={cell}
              font={font}
              locked={view.locked}
              demo={demo}
              theme={theme}
              enter={grewFrom !== null && (Math.floor(i / view.cols) >= grewFrom.rows || i % view.cols >= grewFrom.cols)}
              onTap={onTap}
            />
          ))}
        </div>
        {view.showBar && <ShowBar key={showKey} ms={view.showBar.ms} paused={paused === true} accent={theme.accent} demo={demo} reduced={reduced === true} />}
        {legend && <Legend starts={legendStarts(view)} />}
        {view.missChip && <MissChip chip={view.missChip} atTop={chipAtTop} theme={theme} demo={demo} />}
        {extra?.tone === 'missed' && (
          <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
            {/* Tilted outside, popping inside: the pop's own transform would otherwise undo the tilt. */}
            <span className="inline-block" style={{ transform: 'rotate(-6deg)' }}>
              <span
                className="bfx-pop inline-block px-5 py-2 rounded-2xl border-4 font-black whitespace-nowrap"
                style={{ color: '#FDE68A', borderColor: '#FDE68A', background: 'rgba(15,23,42,0.78)', fontSize: demo ? 16 : 28 }}
                data-testid={demo ? undefined : 'brain-none-stamp'}
              >
                {t('play.noneWas')}
              </span>
            </span>
          </div>
        )}
      </div>
      {extra && <ExtraButton extra={extra} width={gridW} locked={view.locked} demo={demo} theme={theme} onTap={onTap} />}
    </div>
  )
}

const BADGE_ICONS: Record<string, LucideIcon> = { 'play.reverseBadge': Undo2, 'play.lookalikeBadge': Copy }

/** The row above a grid: header badge, chip, Flash Grid's waves (●○○) or a triples counter, Match Pairs' budget. */
function Strip({ view, theme, demo, nudge }: { view: GridView; theme: GameTheme; demo?: boolean; nudge: number }) {
  const { t } = useTranslation('brain')
  const promptText = usePromptText()
  const chipText = view.chip ? (view.chip.text ?? (view.chip.key ? promptText({ key: view.chip.key, params: view.chip.params }) : '')) : ''
  const amber = view.chip?.ink === 'amber'
  const pill = demo ? 'h-6 px-2 text-xs' : 'h-8 px-3 text-sm'
  const BadgeIcon = view.badge ? BADGE_ICONS[view.badge.key] : undefined
  const waves = view.progress?.kind === 'waves' ? view.progress : null
  const set = view.progress?.kind === 'set' ? view.progress : null
  return (
    <div
      className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 w-full"
      style={{ minHeight: demo ? 24 : BOARD_STRIP_H - 8, marginBottom: demo ? 6 : 8 }}
      data-testid={demo ? undefined : 'brain-strip'}
    >
      {view.badge && (
        <span
          className={`inline-flex items-center gap-1.5 rounded-full font-bold whitespace-nowrap ${pill}`}
          style={{ color: theme.accent, border: `1.5px solid ${theme.accent}`, background: 'rgba(255,255,255,0.08)' }}
          data-testid={demo ? undefined : 'brain-badge'}
        >
          {BadgeIcon && <BadgeIcon className={demo ? 'w-3 h-3' : 'w-4 h-4'} aria-hidden="true" />}
          {t(view.badge.key)}
        </span>
      )}
      {chipText && (
        // The outer span shakes when a wrong tap pulses the chip; the inner one pops when its words change.
        <span key={`nudge-${nudge}`} className={`inline-flex ${nudge > 0 ? 'bfx-shake' : ''}`}>
          <span
            key={chipText}
            className={`bfx-pop inline-flex items-center rounded-full font-bold tabular-nums whitespace-nowrap ${pill}`}
            // The second series' colour, and its box: colour is never the only cue.
            style={amber ? { color: CELL_INK.amber, border: `2px solid ${CELL_INK.amber}`, background: 'rgba(251,191,36,0.12)' } : { color: '#fff', background: 'rgba(255,255,255,0.14)' }}
            data-testid={demo ? undefined : 'brain-chip'}
            data-ink={view.chip?.ink}
          >
            {chipText}
          </span>
        </span>
      )}
      {waves && (
        <span className="inline-flex items-center gap-1.5" role="img" aria-label={t('play.trial', { done: waves.done, total: waves.total })} data-testid={demo ? undefined : 'brain-waves'}>
          {Array.from({ length: Math.max(0, waves.total) }, (_, i) => {
            const on = i < waves.done
            // Filled against hollow: shape, not only colour.
            return <span key={i} className={`${demo ? 'w-2 h-2' : 'w-3 h-3'} rounded-full`} style={{ background: on ? theme.accent : 'transparent', border: `2px solid ${on ? theme.accent : 'rgba(255,255,255,0.5)'}` }} data-on={on || undefined} />
          })}
        </span>
      )}
      {set && (
        <span className={`inline-flex items-center rounded-full font-bold tabular-nums ${pill}`} style={{ color: '#fff', background: 'rgba(255,255,255,0.14)' }} data-testid={demo ? undefined : 'brain-set'}>
          {set.open}/{set.size}
        </span>
      )}
      {view.budget && <Budget left={view.budget.left} total={view.budget.total} demo={demo} />}
    </div>
  )
}

/** Match Pairs' miss budget: dots and «실수 N번까지» — never hearts, it is not the round's chances. */
function Budget({ left, total, demo }: { left: number; total: number; demo?: boolean }) {
  const { t } = useTranslation('brain')
  const label = t('play.budget', { left })
  return (
    <span className={`inline-flex items-center gap-2 rounded-full font-semibold whitespace-nowrap ${demo ? 'h-6 px-2 text-xs' : 'h-8 px-3 text-sm'}`} style={{ background: 'rgba(255,255,255,0.1)' }} role="img" aria-label={label} data-testid={demo ? undefined : 'brain-budget'}>
      <span className="inline-flex items-center gap-1" aria-hidden="true">
        {Array.from({ length: Math.max(0, total) }, (_, i) => (
          <span key={i} className={`${demo ? 'w-1.5 h-1.5' : 'w-2.5 h-2.5'} rounded-full`} style={{ background: i < left ? '#FFFFFF' : 'transparent', border: '1.5px solid rgba(255,255,255,0.7)' }} />
        ))}
      </span>
      {!demo && <span aria-hidden="true">{label}</span>}
    </span>
  )
}

/** The memorise countdown under the grid — a Web Animation, held while paused, static under reduced motion. */
function ShowBar({ ms, paused, accent, demo, reduced }: { ms: number; paused: boolean; accent: string; demo?: boolean; reduced: boolean }) {
  const bar = useRef<HTMLDivElement>(null)
  const anim = useRef<Animation | null>(null)
  useLayoutEffect(() => {
    const el = bar.current
    if (!el || reduced || typeof el.animate !== 'function') return
    const a = el.animate([{ transform: 'scaleX(1)' }, { transform: 'scaleX(0)' }], { duration: Math.max(0, ms), easing: 'linear', fill: 'forwards' })
    anim.current = a
    return () => {
      a.cancel()
      anim.current = null
    }
  }, [ms, reduced])
  useEffect(() => {
    const a = anim.current
    if (!a) return
    if (paused) a.pause()
    else if (a.playState === 'paused') a.play()
  }, [paused])
  return (
    <div className="absolute inset-x-0 h-1.5 rounded-full bg-white/10 overflow-hidden" style={{ top: '100%', marginTop: demo ? 4 : 6 }} aria-hidden="true" data-testid={demo ? undefined : 'brain-show-bar'}>
      <div ref={bar} className="h-full w-full rounded-full origin-left" style={{ background: accent, opacity: reduced ? 0.6 : 1 }} />
    </div>
  )
}

/**
 * The first number of each alternation series, read off the board: white counts up from its
 * smallest; amber from its smallest too, or down from its largest on an opposite-directions board
 * (Number Hunt L12+: white 1 → amber 8 → white 2 …).
 */
function legendStarts(view: GridView): [string, string] {
  const nums = (boxed: boolean) => view.cells.filter((c) => (c.boxed === true) === boxed).map((c) => Number(c.label)).filter(Number.isFinite)
  const white = nums(false)
  const amber = nums(true)
  const down = view.prompt.key === 'play.tapAlternateOpposite'
  return [String(white.length ? Math.min(...white) : 1), String(amber.length ? (down ? Math.max(...amber) : Math.min(...amber)) : 1)]
}

/** Number Hunt's alternation: the two series side by side for a moment — white, then the boxed amber one. */
function Legend({ starts }: { starts: [string, string] }) {
  const tile = (cell: CellView) => (
    <span className="flex items-center justify-center w-14 h-14 rounded-2xl text-[26px] font-bold" style={{ background: 'rgba(15,23,42,0.85)', border: `1.5px solid ${CANVAS_TONES.tileBorder}`, color: '#fff' }}>
      <Glyph cell={cell} />
    </span>
  )
  return (
    <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center" aria-hidden="true" data-testid="brain-legend">
      <span className="bfx-pop flex items-center gap-3 rounded-3xl px-4 py-3" style={{ background: 'rgba(2,6,23,0.8)', boxShadow: '0 10px 30px rgba(0,0,0,0.4)' }}>
        {tile({ label: starts[0], tone: 'idle' })}
        <span className="text-2xl font-black text-white/80">⇄</span>
        {tile({ label: starts[1], tone: 'idle', ink: 'amber', boxed: true })}
      </span>
    </div>
  )
}

/** Odd One Out after a miss: the odd one beside a typical one, both upright (a mirror stays a mirror). */
function MissChip({ chip, atTop, theme, demo }: { chip: { odd: CellView; common: CellView }; atTop: boolean; theme: GameTheme; demo?: boolean }) {
  const size = demo ? 34 : 52
  const tile = (cell: CellView, odd: boolean) => (
    <span
      className="flex items-center justify-center rounded-xl font-bold"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.5), background: CANVAS_TONES.tile, border: `1.5px solid ${CANVAS_TONES.tileBorder}`, color: '#fff', ...(odd ? { outline: `3px dashed ${theme.accent}`, outlineOffset: -5 } : {}) }}
    >
      <Glyph cell={{ ...cell, tone: 'idle' }} upright />
    </span>
  )
  return (
    <div className="pointer-events-none absolute inset-x-0 z-10 flex justify-center" style={atTop ? { top: 6 } : { bottom: 6 }} data-testid={demo ? undefined : 'brain-miss-chip'}>
      <span className="bfx-pop flex items-center gap-2 rounded-2xl px-3 py-2 border border-white/20" style={{ background: 'rgba(2,6,23,0.88)', boxShadow: '0 10px 30px rgba(0,0,0,0.4)' }}>
        {tile(chip.odd, true)}
        <span className="text-xl font-black text-white/70" aria-hidden="true">≠</span>
        {tile(chip.common, false)}
      </span>
    </div>
  )
}

/** Odd One Out's «없음»: full width under the grid, ≥ 56px tall and 16px below it; N or Space on a keyboard. */
function ExtraButton({ extra, width, locked, demo, theme, onTap }: { extra: NonNullable<GridView['extra']>; width: number; locked: boolean; demo?: boolean; theme: GameTheme; onTap: (i: number) => void }) {
  const { t } = useTranslation('brain')
  const tone = extra.tone ?? 'idle'
  let style: CSSProperties = { background: CANVAS_TONES.tile, border: `1.5px solid ${CANVAS_TONES.tileBorder}`, color: '#fff' }
  let anim = ''
  if (tone === 'correct') {
    style = { background: CANVAS_TONES.correct, border: `1.5px solid ${CANVAS_TONES.correct}`, color: '#fff', boxShadow: '0 0 24px rgba(34,197,94,0.5)' }
    anim = 'bfx-pop'
  } else if (tone === 'wrong') {
    style = { background: CANVAS_TONES.wrong, border: `1.5px solid ${CANVAS_TONES.wrong}`, color: '#fff' }
    anim = 'bfx-shake'
  } else if (tone === 'missed') {
    style = { ...style, outline: `3px dashed ${theme.accent}`, outlineOffset: -7 }
    anim = 'bfx-pulse'
  } else if (locked) style = { ...style, opacity: 0.55 }
  const live = !locked && !demo
  return (
    <button
      type="button"
      disabled={!live}
      tabIndex={demo ? -1 : undefined}
      aria-hidden={demo || undefined}
      onPointerDown={(e) => {
        e.preventDefault()
        if (live) onTap(extra.index)
      }}
      onClick={(e) => { if (e.detail === 0 && live) onTap(extra.index) }}
      className={`relative rounded-2xl font-bold transition-[transform,background-color] duration-100 ${demo ? 'text-sm' : 'text-xl'} ${live ? 'cursor-pointer hover:bg-white/20 active:scale-[0.97]' : 'cursor-default'} ${anim}`}
      style={{ ...style, width, minHeight: demo ? 36 : 56, marginTop: demo ? 8 : 16 }}
      data-testid={demo ? undefined : 'brain-extra'}
      data-tap={extra.index}
      data-tone={tone}
    >
      {live && (
        <span className="hidden md:flex absolute top-1/2 -translate-y-1/2 left-3 text-xs font-semibold text-white/60" aria-hidden="true">N</span>
      )}
      <span className="inline-flex items-center gap-2">
        {tone === 'correct' && <Check className="w-6 h-6" strokeWidth={3} aria-hidden="true" />}
        {tone === 'wrong' && <X className="w-6 h-6" strokeWidth={3} aria-hidden="true" />}
        {t(extra.key)}
      </span>
    </button>
  )
}

// ——— Choice ————————————————————————————————————————————————————————————————

const OPERATORS = new Set(['+', '−', '-', '×', '*', '÷', '/', '=', '→'])

/**
 * An expression's tokens in units that never break inside: an operator holds on to the number after
 * it, '(' to what follows, ')' to what it closes — so a line only ever wraps before an operator.
 */
function expressionUnits(tokens: readonly (number | string)[]): number[][] {
  const units: number[][] = []
  let cur: number[] = []
  tokens.forEach((tok, i) => {
    const prev = cur.length > 0 ? tokens[cur[cur.length - 1]] : undefined
    const startsUnit = typeof tok === 'string' && OPERATORS.has(tok) && cur.length > 0 && !(typeof prev === 'string' && prev === '(')
    if (startsUnit) {
      units.push(cur)
      cur = []
    }
    cur.push(i)
  })
  if (cur.length > 0) units.push(cur)
  return units
}

/**
 * A line of tokens — the stimulus expression, or a worked line — numbers in the reader's grouping,
 * wrapping only before an operator. `highlight` is a [start, end) range of the tokens (the part done
 * first); `fill` takes the place of the '?' once the answer is right.
 */
function TokenLine({ tokens, fmt, fill = null, highlight, fontSize, className, testId }: { tokens: readonly (number | string)[]; fmt: (v: number) => string; fill?: string | null; highlight?: [number, number]; fontSize: string | number; className: string; testId?: string }) {
  const text = tokens.map((tok) => (typeof tok === 'number' ? fmt(tok) : tok === '?' && fill !== null ? fill : tok))
  const lit = (i: number) => highlight !== undefined && i >= highlight[0] && i < highlight[1]
  const hl: CSSProperties = { background: '#FDE68A', borderRadius: '0.15em', boxShadow: '0 0 0 0.08em #FDE68A' }
  const tight = (a: number | string | undefined, b: number | string) => a === '(' || b === ')'
  return (
    <p className={className} style={{ fontSize }} data-testid={testId}>
      {expressionUnits(tokens).map((unit, u) => (
        <Fragment key={u}>
          {u > 0 && <span style={lit(unit[0] - 1) && lit(unit[0]) ? hl : undefined}> </span>}
          <span className="whitespace-nowrap">
            {unit.map((i, k) => {
              const filled = tokens[i] === '?' && fill !== null
              return (
                <Fragment key={i}>
                  {k > 0 && !tight(tokens[unit[k - 1]], tokens[i]) && <span style={lit(i - 1) && lit(i) ? hl : undefined}>{'\u00A0'}</span>}
                  <span className={filled ? 'bfx-pop inline-block' : undefined} style={{ ...(lit(i) ? hl : {}), ...(filled ? { color: '#15803D' } : {}) }} data-token={i}>
                    {text[i]}
                  </span>
                </Fragment>
              )
            })}
          </span>
        </Fragment>
      ))}
    </p>
  )
}

/** The engine's worked line, space-separated with plain digits, as tokens. */
function lineTokens(line: string): (number | string)[] {
  return line.split(' ').filter((tok) => tok !== '').map((tok) => (/^\d+$/.test(tok) ? Number(tok) : tok))
}

function Expression({ tokens, fmt, fill, demo }: { tokens: readonly (number | string)[]; fmt: (v: number) => string; fill: string | null; demo?: boolean }) {
  const len = tokens.map((tok) => (typeof tok === 'number' ? fmt(tok) : tok)).join(' ').length
  // Never below 28px (EVIDENCE: game numbers ≥ 28pt); vw keeps a long sum on three lines at 200% zoom.
  const fontSize = demo ? (len > 12 ? 20 : 28) : len <= 9 ? 'clamp(36px, 15vw, 72px)' : len <= 16 ? 'clamp(30px, 10vw, 56px)' : 'clamp(28px, 8vw, 44px)'
  return <TokenLine tokens={tokens} fmt={fmt} fill={fill} fontSize={fontSize} className="font-extrabold tabular-nums leading-tight tracking-wide" testId={demo ? undefined : 'brain-expression'} />
}

/** Number Pattern's lines (reveal `groups`): each its own colour AND border, so colour is never the only cue. */
const LINE_STYLES: readonly CSSProperties[] = [
  { background: '#F1F5F9', border: '2px solid #94A3B8', color: '#0F172A' },
  { background: '#FEF3C7', border: '2px dashed #B45309', color: '#78350F' },
  { background: '#CFFAFE', border: '2px dotted #0E7490', color: '#164E63' },
]
const LINE_INK = ['#334155', '#92400E', '#155E75']

function Terms({ terms, fmt, fill, gaps, groups, demo, pulse }: { terms: readonly (number | null)[]; fmt: (v: number) => string; fill: string | null; gaps?: string[]; groups?: number[]; demo?: boolean; pulse: boolean }) {
  const n = terms.length
  const fontSize = demo ? 18 : n <= 5 ? 'clamp(30px, 9vw, 44px)' : n <= 7 ? 'clamp(28px, 7.5vw, 38px)' : 'clamp(28px, 6.5vw, 34px)'
  const colGap = demo ? 8 : 14
  const labelled = gaps !== undefined && gaps.some((g) => g)
  return (
    <div className="flex flex-wrap items-center justify-center" style={{ columnGap: colGap, rowGap: labelled ? (demo ? 18 : 30) : demo ? 6 : 10, fontSize }} data-testid={demo ? undefined : 'brain-terms'}>
      {terms.map((v, i) => {
        const gap = v === null
        const line = groups?.[i] ?? 0
        const base = LINE_STYLES[Math.max(0, Math.min(LINE_STYLES.length - 1, line))]
        const style: CSSProperties = gap
          ? fill !== null
            ? { background: '#DCFCE7', border: '2px solid #15803D', color: '#15803D' }
            : { background: '#FFFFFF', border: '2px dashed #64748B', color: '#64748B' }
          : base
        const label = gaps?.[i]
        return (
          <span
            key={i}
            className={`relative inline-flex items-center justify-center rounded-xl font-extrabold tabular-nums leading-none ${gap && fill !== null ? 'bfx-pop' : ''}`}
            style={{
              ...style,
              minWidth: '1.6em',
              padding: '0.14em 0.3em',
              // The gap pulses at under 1Hz, and not at all under reduced motion.
              ...(gap && fill === null && pulse && !demo ? { animation: 'bfx-pulse 1400ms ease-in-out infinite' } : {}),
            }}
            data-term={i}
          >
            {gap ? (fill ?? '?') : fmt(v)}
            {label && i < n - 1 && (
              <span
                className="bfx-rise absolute whitespace-nowrap font-bold"
                style={{ left: `calc(100% + ${colGap / 2}px)`, top: 'calc(100% + 3px)', transform: 'translateX(-50%)', fontSize: demo ? 11 : 'max(15px, 0.42em)', color: LINE_INK[Math.max(0, Math.min(LINE_INK.length - 1, line))] }}
                data-gap={i}
              >
                {label}
              </span>
            )}
          </span>
        )
      })}
    </div>
  )
}

/** Color Word's cue: the app's icon and a word, always in the same place; it flips when the rule switched. */
function CueStrip({ cue, demo, theme }: { cue: 'ink' | 'word'; demo?: boolean; theme: GameTheme }) {
  const { t } = useTranslation('brain')
  const reduced = useReducedMotion()
  const ref = useRef<HTMLDivElement>(null)
  const [flip] = useState(() => !demo && memory.theme === theme && memory.cue !== null && memory.cue !== cue)
  useLayoutEffect(() => {
    if (flip && !reduced) ref.current?.animate?.([{ transform: 'perspective(400px) rotateX(90deg)' }, { transform: 'perspective(400px) rotateX(0deg)' }], { duration: 250, easing: 'ease-out' })
  }, [flip, reduced])
  useEffect(() => {
    if (demo) return
    memory.theme = theme
    memory.cue = cue
  }, [cue, demo, theme])
  const Icon = cue === 'ink' ? Droplet : BookOpen
  return (
    <div
      ref={ref}
      className={`flex items-center justify-center gap-2 rounded-2xl font-bold ${demo ? 'h-8 text-sm' : 'h-12 text-lg'}`}
      style={cue === 'ink' ? { background: '#FFFFFF', color: '#0F172A' } : { background: '#0F172A', color: '#FFFFFF', border: '2px solid rgba(255,255,255,0.7)' }}
      data-testid={demo ? undefined : 'brain-cue'}
      data-cue={cue}
    >
      <Icon className={demo ? 'w-4 h-4' : 'w-5 h-5'} aria-hidden="true" />
      {t(cue === 'ink' ? 'play.cueInk' : 'play.cueWord')}
    </div>
  )
}

function optionText(o: ChoiceView['options'][number], fmt: (v: number) => string, t: (k: string) => string): string {
  if (o.value !== undefined) return fmt(o.value)
  if (o.textKey) return t(o.textKey)
  return o.text ?? ''
}

function Choice({ view, onTap, demo, onSkip, theme }: BoardProps & { view: ChoiceView }) {
  const { t } = useTranslation('brain')
  const fmt = useNumberFormat()
  const promptText = usePromptText()
  const reduced = useReducedMotion() === true
  const st = view.stimulus
  const answered = view.correctIndex !== undefined
  const leading = st.hidden === true && !answered
  const right = answered && view.picked === view.correctIndex
  const reveal = answered ? st.reveal : undefined
  // A miss shows the working (the worked lines, what was done first, «글자 색: …»); a right answer
  // only fills the gap — with the rule's gaps and lines coloured, when there are any.
  const working = answered && !right ? reveal : undefined
  const answerText = answered && view.correctIndex !== undefined && view.options[view.correctIndex] ? optionText(view.options[view.correctIndex], fmt, t) : null
  const canSkip = reveal !== undefined && onSkip !== undefined && !demo
  // Mounted during Color Word's cue lead: the word rises in when it comes.
  const [hadLead] = useState(leading)

  // 1–6 on the keyboard pick an option — faster than the mouse on a desktop. Once a worked line is
  // up, Enter or Space moves on.
  useEffect(() => {
    if (demo) return
    const onKey = (e: KeyboardEvent) => {
      if (answered) {
        if (canSkip && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault()
          onSkip?.()
        }
        return
      }
      if (leading) return
      const n = Number(e.key)
      if (Number.isInteger(n) && n >= 1 && n <= view.options.length) onTap(n - 1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [answered, leading, canSkip, onSkip, onTap, view.options.length, demo])

  let body: ReactNode
  if (st.terms) {
    body = <Terms terms={st.terms} fmt={fmt} fill={right || reveal ? answerText : null} gaps={reveal?.gaps} groups={reveal?.groups} demo={demo} pulse={!answered && !reduced} />
  } else if (st.tokens) {
    body = <Expression tokens={st.tokens} fmt={fmt} fill={right ? answerText : null} demo={demo} />
  } else {
    const stimulus = st.textKey ? t(st.textKey) : st.text
    const long = (stimulus?.length ?? 0) > 14
    const size = demo ? (long ? 'text-xl' : 'text-3xl') : long ? 'text-4xl sm:text-5xl' : 'text-6xl sm:text-7xl'
    body = <span className={`font-extrabold tracking-wide ${size}`}>{stimulus}</span>
  }

  const shadow = '0 18px 40px rgba(0,0,0,0.35)'
  return (
    <div className={`mx-auto w-full select-none ${demo ? 'max-w-[300px] space-y-3' : 'max-w-md space-y-6'}`}>
      <div className={demo ? 'space-y-2' : 'space-y-3'}>
        {st.cue && <CueStrip cue={st.cue} demo={demo} theme={theme} />}
        {/* The stimulus on a white card: ink colours keep their contrast whatever the game's canvas. */}
        <div
          className={`bfx-rise flex flex-col items-center justify-center gap-2 rounded-3xl bg-white px-4 py-3 text-center ${demo ? 'min-h-20' : 'min-h-36'} ${canSkip ? 'cursor-pointer' : ''}`}
          style={{
            color: st.color ? INK[st.color] : '#0F172A',
            // Color Word's frame lure: a 12px ring in a third colour, inside the card's edge.
            boxShadow: st.frame ? `inset 0 0 0 ${demo ? 6 : 12}px ${INK[st.frame]}, ${shadow}` : shadow,
            ...(st.frame ? { padding: demo ? '12px 14px' : '22px 26px' } : {}),
          }}
          onPointerDown={canSkip ? () => onSkip?.() : undefined}
          data-testid={demo ? undefined : 'brain-stimulus'}
          data-frame={st.frame}
        >
          {leading ? (
            // The cue is up, the word is not yet: hold the card's size so nothing moves when it comes.
            <span className={`font-extrabold text-slate-300 ${demo ? 'text-3xl' : 'text-6xl'}`} aria-hidden="true">···</span>
          ) : (
            <div className={hadLead ? 'bfx-rise' : undefined}>{body}</div>
          )}
          {working?.lines && working.lines.length > 0 && (
            <div className="bfx-rise flex flex-col items-center" data-testid={demo ? undefined : 'brain-reveal-lines'}>
              {working.lines.map((line, i) => (
                <TokenLine key={i} tokens={lineTokens(line)} fmt={fmt} highlight={i === 0 ? working.highlight : undefined} fontSize={demo ? 14 : 'clamp(20px, 6vw, 28px)'} className="font-bold tabular-nums text-slate-700 leading-snug" />
              ))}
            </div>
          )}
          {working?.prompt && (
            <p className="bfx-rise font-semibold text-slate-700" style={{ fontSize: demo ? 14 : 20 }} data-testid={demo ? undefined : 'brain-reveal-prompt'}>
              {promptText(working.prompt)}
            </p>
          )}
        </div>
      </div>
      <div className={`grid ${demo ? 'gap-2' : 'gap-3'} ${view.options.length > 4 ? 'grid-cols-3' : 'grid-cols-2'}`}>
        {view.options.map((o, i) => {
          const isRight = answered && i === view.correctIndex
          const isPicked = answered && i === view.picked
          // A coloured label is ink on a white tile (orange is 3.6:1, so ≥ 24px bold).
          let style: CSSProperties = o.color
            ? { background: '#FFFFFF', border: '1.5px solid rgba(255,255,255,0.9)', color: INK[o.color] }
            : { background: CANVAS_TONES.tile, border: `1.5px solid ${CANVAS_TONES.tileBorder}`, color: '#fff' }
          let anim = ''
          if (isRight) {
            style = { background: CANVAS_TONES.correct, border: `1.5px solid ${CANVAS_TONES.correct}`, color: '#fff', boxShadow: '0 0 24px rgba(34,197,94,0.5)' }
            anim = 'bfx-pop'
          } else if (isPicked) {
            style = { background: CANVAS_TONES.wrong, border: `1.5px solid ${CANVAS_TONES.wrong}`, color: '#fff' }
            anim = 'bfx-shake'
          } else if (answered || leading) style = { ...style, opacity: leading ? 0.55 : 0.4 }
          const live = !answered && !leading && !demo
          return (
            <button
              key={i}
              type="button"
              disabled={!live}
              tabIndex={demo ? -1 : undefined}
              aria-hidden={demo || undefined}
              onPointerDown={(e) => {
                e.preventDefault()
                if (live) onTap(i)
              }}
              onClick={(e) => { if (e.detail === 0 && live) onTap(i) }}
              className={`relative rounded-2xl font-bold tabular-nums transition-[transform,background-color] duration-100 ${demo ? 'min-h-11 text-base' : 'min-h-[72px] text-2xl'} ${live ? `cursor-pointer active:scale-[0.96] ${o.color ? 'hover:brightness-95' : 'hover:bg-white/20'}` : 'cursor-default'} ${anim}`}
              style={style}
              data-testid={demo ? undefined : `brain-option-${i}`}
              data-tap={i}
              data-color={o.color}
            >
              {live && (
                <span className={`hidden md:flex absolute top-2 left-2.5 text-xs font-semibold ${o.color ? 'text-slate-500' : 'text-white/60'}`} aria-hidden="true">{i + 1}</span>
              )}
              <span className="inline-flex items-center gap-2">
                {isRight && <Check className="w-6 h-6" strokeWidth={3} aria-hidden="true" />}
                {isPicked && !isRight && <X className="w-6 h-6" strokeWidth={3} aria-hidden="true" />}
                {optionText(o, fmt, t)}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
