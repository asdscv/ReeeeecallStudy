import { useEffect, useRef, useState, type ReactNode } from 'react'
import { View, Text, Pressable, StyleSheet, type View as RNView, type TextStyle } from 'react-native'
import Animated, { useReducedMotion } from 'react-native-reanimated'
import { Feather } from '@expo/vector-icons'
import { useTranslation } from 'react-i18next'
import i18next, { type TFunction } from 'i18next'
import {
  CANVAS_TONES,
  INK_COLORS,
  type CellTone,
  type CellView,
  type ChoiceView,
  type GameTheme,
  type GridView,
  type PromptView,
  type RoundView,
} from '@reeeeecall/shared/lib/brain-games'
import { formatCount, formatDecimal } from '@reeeeecall/shared/lib/format-number'
import { testProps } from '../../utils/testProps'
import { SetMatchBoard, CodeBreakBoard, MakeNumberBoard, MazeBoard } from './ThinkingBoards'
import { BOARD_STRIP_H, CANVAS_INK, CELL_INK, FX, type FeatherName } from './brain-ui'
import { GradientFill } from './GameCanvas'
import { BrainInstantMotion, useDrain, useMotion, type Motion } from './motion'

/**
 * Draws whatever trial the engine hands over — a grid or a pick-one choice — on the game's dark
 * canvas.
 *
 * Around a grid: a strip above it (header badge, chip, Flash Grid's waves, Match Pairs' miss
 * budget), a memorise bar under it, Odd One Out's «없음» button below and its miss chip / «없었어요»
 * stamp over it. Around a choice: Color Word's cue strip and frame ring, the expression as tokens or
 * Number Pattern's row as tiles, and what the engine reveals once the trial is over.
 *
 * `demo` draws the same board for the how-to-play player: smaller, hidden from screen readers,
 * taking no input, and reporting where each tap target is so the demo's finger can find it.
 */
export interface BoardProps {
  view: RoundView
  onTap: (index: number) => void
  /** The space the board may use, measured by its parent. */
  width: number
  height: number
  theme: GameTheme
  demo?: boolean
  /** The round is paused, or a card is over it: a memorise bar holds. */
  paused?: boolean
  /** A tap on the answer's reveal moves on: a choice's worked line (on with the next trial). */
  onSkipReveal?: () => void
  /** Demo only: each tap target's view, by the index a tap on it sends. */
  registerTarget?: (index: number, node: RNView | null) => void
}

export function BrainBoard(props: BoardProps) {
  return <BrainInstantMotion.Provider value={props.view.difficulty === 'extreme'}><BoardContent {...props} /></BrainInstantMotion.Provider>
}

function BoardContent(props: BoardProps) {
  const { view } = props
  if (view.kind === 'grid') return <GridBoard {...props} view={view} />
  if (view.kind === 'choice') return <ChoiceBoard {...props} view={view} />
  if (view.kind === 'setMatch') return <SetMatchBoard {...props} view={view} />
  if (view.kind === 'codeBreak') return <CodeBreakBoard {...props} view={view} />
  if (view.kind === 'makeNumber') return <MakeNumberBoard {...props} view={view} />
  return <MazeBoard {...props} view={view} />
}

/**
 * Touch answers on press-IN (a press waits for the finger to lift — a perceptible lag in a game
 * scored on speed). TalkBack, Switch Access and keyboards activate with a click, which reaches
 * only `onPress`, so that answers too — unless a touch already did, which would count twice (a
 * Sequence tap counted twice is a wrong one).
 */
function usePressAnswer(answer: () => void) {
  const touchedAt = useRef(0)
  return {
    onPressIn: () => {
      touchedAt.current = Date.now()
      answer()
    },
    onPress: () => {
      const touched = touchedAt.current !== 0 && Date.now() - touchedAt.current < 10_000
      touchedAt.current = 0
      if (!touched) answer()
    },
  }
}

/**
 * What the last board in play looked like, so the next one can show what changed: a board that grew
 * slides its new rows in, and Color Word's cue strip flips when the rule switched. Kept per game
 * (by its theme); demo boards never touch it.
 */
const memory: { theme: GameTheme | null; cols: number; rows: number; cue: 'ink' | 'word' | null } = { theme: null, cols: 0, rows: 0, cue: null }

/**
 * Languages whose decimal point is a comma: there «1,203» reads as one point two-zero-three, so a
 * game number is grouped with a dot (1.203) — Spanish only from five digits (1203, 12.030), as the
 * web's Intl.NumberFormat writes them.
 */
const DOT_GROUPING: Readonly<Record<string, number>> = { es: 10_000, id: 1_000, vi: 1_000 }

/**
 * A number as the player reads it, in the reader's grouping. Plain string work, not Intl: a Hermes
 * build without full ICU silently drops Intl's separators (see format-number.ts).
 */
function formatNumber(v: number): string {
  if (!Number.isInteger(v)) return formatDecimal(v, 2)
  const from = DOT_GROUPING[(i18next.resolvedLanguage ?? i18next.language ?? '').slice(0, 2)]
  if (from === undefined) return formatCount(v)
  return Math.abs(v) < from ? String(v).replace('-', '−') : formatCount(v).replace(/,/g, '.')
}

/** A `brain` prompt, with string params that are themselves `brain` keys translated (colour names). */
function usePromptText(): (p: PromptView) => string {
  const { t, i18n } = useTranslation('brain')
  return (p) => {
    const params: Record<string, string | number> = {}
    for (const [k, v] of Object.entries(p.params ?? {})) params[k] = typeof v === 'string' && v.includes('.') && i18n.exists(v, { ns: 'brain' }) ? t(v) : v
    return t(p.key, params)
  }
}

/** Plays a motion once, on mount: a board's new row, a word arriving after Color Word's cue lead. */
function Enter({ motion, children }: { motion: Motion; children: ReactNode }) {
  const style = useMotion(motion, 0)
  return <Animated.View style={style}>{children}</Animated.View>
}

// ── Grid ──────────────────────────────────────────────────────────────────────

const GAP = 8
const DEMO_GAP = 6
/**
 * The engine caps the columns and rows so cells are ≥ 56; a tall board (Match Pairs' 4×6) on a
 * short phone may still need them a little smaller to fit the height — never under 48, the touch
 * minimum.
 */
const MIN_CELL = 48
/** On a tablet a 3×3 grid would otherwise fill the screen with three giant cells. */
const MAX_CELL = 120
/** Under the grid: «없음» (16 above it, ≥ 56 tall). */
const EXTRA_H = 72
const DEMO_STRIP_H = 30
const DEMO_EXTRA_H = 44

interface Face {
  bg: string
  fg: string
  border?: string
  borderWidth?: number
  shadow?: string
  opacity?: number
  scale?: number
  motion: Motion
  icon?: 'check' | 'x'
  /** The card back of a face-down pairs card. */
  back?: boolean
  /** The dashed outline of a cell that should have been tapped. */
  dashed?: boolean
}

/** Each tone as a face — what it looks like and the motion it enters with (as on web). */
function faceOf(tone: CellTone, theme: GameTheme): Face {
  const glass: Face = { bg: CANVAS_TONES.tile, fg: CANVAS_TONES.text, border: CANVAS_TONES.tileBorder, borderWidth: 1.5, motion: null }
  switch (tone) {
    case 'lit':
      return { bg: CANVAS_TONES.lit, fg: CANVAS_INK, border: theme.accent, borderWidth: 3, shadow: `0 0 28px ${theme.glow}`, motion: 'lit' }
    case 'correct':
      return { bg: CANVAS_TONES.correct, fg: '#FFFFFF', shadow: '0 0 24px rgba(34,197,94,0.55)', motion: 'pop', icon: 'check' }
    case 'wrong':
      return { bg: CANVAS_TONES.wrong, fg: '#FFFFFF', shadow: '0 0 24px rgba(239,68,68,0.5)', motion: 'shake', icon: 'x' }
    case 'missed':
      return { ...glass, motion: 'pulse', dashed: true }
    case 'faceDown':
      return { bg: theme.cardFrom, fg: '#FFFFFF', border: 'rgba(255,255,255,0.28)', borderWidth: 1.5, shadow: '0 6px 16px rgba(0,0,0,0.35)', motion: null, back: true }
    case 'faceUp':
      return { bg: '#FFFFFF', fg: CANVAS_INK, shadow: '0 6px 18px rgba(0,0,0,0.3)', motion: 'flip' }
    case 'matched':
      return { bg: 'rgba(255,255,255,0.85)', fg: CANVAS_INK, border: CANVAS_TONES.correct, borderWidth: 3, opacity: 0.6, scale: 0.92, motion: 'pop', icon: 'check' }
    case 'done':
      // Found numbers fade but stay readable (Number Hunt).
      return { bg: CANVAS_TONES.done, fg: 'rgba(255,255,255,0.45)', border: 'rgba(255,255,255,0.06)', borderWidth: 1.5, motion: null }
    case 'idle':
    default:
      return glass
  }
}

/** A word for a cell's state, after its label — so a screen reader hears what the colour shows. */
function toneWord(tone: CellTone, t: TFunction): string | null {
  if (tone === 'correct' || tone === 'matched' || tone === 'done') return t('play.correct')
  if (tone === 'wrong') return t('play.wrong')
  return null
}

/** Tones drawn on the dark glass, where a label's own ink reads; the rest have their own fill. */
const INKABLE: readonly CellTone[] = ['idle', 'missed', 'done']

/**
 * A cell's label: mirrored first, then turned — `[{ rotate }, { scaleX: -1 }]` (the list applies
 * right to left, as in CSS) — in its ink, boxed when it is the second series. `upright` drops the
 * turn but keeps the mirror (Odd One Out's miss chip).
 */
function Glyph({ cell, font, color, upright = false }: { cell: CellView; font: number; color: string; upright?: boolean }) {
  const inked = cell.ink !== undefined && INKABLE.includes(cell.tone)
  const ink = inked && cell.ink ? CELL_INK[cell.ink] : color
  const turn: ({ rotate: string } | { scaleX: number })[] = []
  if (!upright && cell.rotate) turn.push({ rotate: `${cell.rotate}deg` })
  if (cell.mirror) turn.push({ scaleX: -1 })
  const dim = inked && cell.tone === 'done' ? 0.6 : 1
  const text = (
    <Text
      style={[
        styles.label,
        { fontSize: font, lineHeight: Math.round(font * (cell.boxed ? 1.1 : 1.2)), color: ink },
        !cell.boxed && turn.length > 0 ? { transform: turn } : null,
        !cell.boxed && dim < 1 ? { opacity: dim } : null,
      ]}
      // The cell is sized for the glyph; system text scaling would push it out.
      allowFontScaling={false}
    >
      {cell.label}
    </Text>
  )
  if (!cell.boxed) return text
  return (
    <View
      style={{
        borderWidth: Math.max(2, Math.round(font * 0.09)),
        borderColor: ink,
        borderRadius: Math.round(font * 0.3),
        paddingHorizontal: Math.round(font * 0.16),
        paddingVertical: Math.round(font * 0.02),
        opacity: dim,
        ...(turn.length > 0 ? { transform: turn } : null),
      }}
    >
      {text}
    </View>
  )
}

export function GridBoard({ view, onTap, width, height, theme, demo, paused, registerTarget }: BoardProps & { view: GridView }) {
  const { t } = useTranslation('brain')
  const gap = demo ? DEMO_GAP : GAP
  const strip = view.badge !== undefined || view.chip !== undefined || view.progress !== undefined || view.budget !== undefined
  // Fit the width AND the measured height (a 4×6 Match Pairs board on a 360×640 phone, a portrait
  // Flash Grid) — with the strip above and the «없음» button below.
  const stripH = strip ? (demo ? DEMO_STRIP_H : BOARD_STRIP_H) : 0
  const extraH = view.extra ? (demo ? DEMO_EXTRA_H : EXTRA_H) : 0
  const byWidth = (width - gap * (view.cols - 1)) / view.cols
  const byHeight = (height - stripH - extraH - gap * (view.rows - 1)) / view.rows
  const cell = Math.max(demo ? 24 : MIN_CELL, Math.floor(Math.min(byWidth, byHeight, demo ? 64 : MAX_CELL)))
  // Older eyes first: never below 28pt in play, growing with the cell.
  const font = Math.max(demo ? 14 : 28, Math.round(cell * 0.44))
  const boardWidth = cell * view.cols + gap * (view.cols - 1)

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
  const [fadeIn] = useState(() => !demo && !view.locked)
  const fade = useMotion(fadeIn ? 'fade' : null, 0)

  // Number Hunt's alternation: a two-series legend over the board for its first 600ms (counted from
  // when the board is in view, not under a rule card or a pause).
  const [legend, setLegend] = useState(() => !demo && !view.locked && view.cells.some((c) => c.boxed))
  useEffect(() => {
    if (!legend || paused) return
    const tm = setTimeout(() => setLegend(false), 600)
    return () => clearTimeout(tm)
  }, [legend, paused])

  // A wrong tap (or a chance spent on one) shakes the chip as well as the cell.
  const wrongs = view.cells.reduce((n, c) => n + (c.tone === 'wrong' ? 1 : 0), 0)
  const lives = typeof view.prompt.params?.lives === 'number' ? Number(view.prompt.params.lives) : null
  const [nudge, setNudge] = useState({ wrongs, lives, n: 0 })
  if (wrongs !== nudge.wrongs || lives !== nudge.lives) {
    const worse = wrongs > nudge.wrongs || (lives !== null && nudge.lives !== null && lives < nudge.lives)
    setNudge({ wrongs, lives, n: nudge.n + (worse ? 1 : 0) })
  }

  // The memorise bar restarts with each thing shown (a wave, the preview); a pause holds it.
  const showKey = view.showBar ? `${view.showBar.ms}:${view.progress?.kind === 'waves' ? view.progress.done : ''}:${view.cells.map((c) => c.tone).join(',')}` : ''
  // Odd One Out's miss chip sits in the half away from the odd cell, so its pulse stays in view.
  const oddAt = view.cells.findIndex((c) => c.tone === 'missed' || c.tone === 'correct')
  const chipAtTop = oddAt >= 0 && Math.floor(oddAt / view.cols) >= view.rows / 2
  const extra = view.extra

  return (
    <View style={[styles.gridColumn, { width: Math.max(boardWidth, Math.min(width, demo ? boardWidth : 320)) }]}>
      {strip ? <Strip view={view} theme={theme} demo={demo} nudge={nudge.n} t={t} /> : null}
      <View style={{ width: boardWidth }}>
        <Animated.View style={[styles.grid, { width: boardWidth, gap }, fade]} {...(demo ? {} : testProps('brain-grid', true))}>
          {view.cells.map((c, i) => {
            const node = (
              <Cell key={i} cell={c} index={i} size={cell} font={font} locked={view.locked} demo={demo} theme={theme} onTap={onTap} t={t} registerTarget={registerTarget} />
            )
            const enter = grewFrom !== null && (Math.floor(i / view.cols) >= grewFrom.rows || i % view.cols >= grewFrom.cols)
            return enter ? (
              <Enter key={i} motion="rise">
                {node}
              </Enter>
            ) : (
              node
            )
          })}
        </Animated.View>
        {view.showBar ? <ShowBar key={showKey} ms={view.showBar.ms} paused={paused === true} accent={theme.accent} demo={demo} /> : null}
        {legend ? <Legend starts={legendStarts(view)} /> : null}
        {view.missChip ? <MissChip chip={view.missChip} atTop={chipAtTop} theme={theme} demo={demo} /> : null}
        {extra?.tone === 'missed' ? <NoneStamp demo={demo} t={t} /> : null}
      </View>
      {extra ? <ExtraButton extra={extra} width={boardWidth} locked={view.locked} demo={demo} theme={theme} onTap={onTap} t={t} registerTarget={registerTarget} /> : null}
    </View>
  )
}

function Cell({
  cell,
  index,
  size,
  font,
  locked,
  demo,
  theme,
  onTap,
  t,
  registerTarget,
}: {
  cell: CellView
  index: number
  size: number
  font: number
  locked: boolean
  demo?: boolean
  theme: GameTheme
  onTap: (i: number) => void
  t: TFunction
  registerTarget?: (index: number, node: RNView | null) => void
}) {
  const f = faceOf(cell.tone, theme)
  // Keyed by tone, so each change replays its entrance (pop, shake, flip).
  const motion = useMotion(f.motion, cell.tone)
  const press = usePressAnswer(() => onTap(index))
  const tappable = !locked && !demo && cell.tone !== 'done' && cell.tone !== 'matched'
  const iconSize = cell.label ? Math.max(12, Math.round(size * 0.2)) : Math.max(18, Math.round(size * 0.42))
  const radius = Math.round(size * 0.22)
  const word = toneWord(cell.tone, t)

  return (
    <Pressable
      ref={registerTarget ? (node) => registerTarget(index, node) : undefined}
      disabled={locked || demo}
      {...press}
      style={({ pressed }) => [{ width: size, height: size }, pressed && tappable && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel={[cell.label ?? String(index + 1), word].filter(Boolean).join(', ')}
      accessibilityState={{
        disabled: locked || !tappable,
        selected: cell.tone === 'lit' || cell.tone === 'faceUp',
        checked: cell.tone === 'correct' || cell.tone === 'matched' || cell.tone === 'done' ? true : undefined,
      }}
      testID={demo ? undefined : `brain-cell-${index}`}
    >
      <View style={[StyleSheet.absoluteFill, f.scale ? { transform: [{ scale: f.scale }] } : null]}>
        <Animated.View
          style={[
            StyleSheet.absoluteFill,
            styles.face,
            {
              borderRadius: radius,
              backgroundColor: f.bg,
              borderColor: f.border,
              borderWidth: f.border ? (f.borderWidth ?? 1.5) : 0,
              opacity: f.opacity ?? 1,
              boxShadow: f.shadow,
            },
            motion,
          ]}
        >
          {f.back ? (
            <View style={[StyleSheet.absoluteFill, { borderRadius: radius, overflow: 'hidden' }]}>
              <GradientFill from={theme.cardFrom} to={theme.cardTo} width={size} height={size} light={0.12} />
            </View>
          ) : null}
          {f.dashed ? <View style={[styles.dashed, { borderRadius: Math.max(4, radius - 5), borderColor: theme.accent }]} /> : null}
          {cell.label ? <Glyph cell={cell} font={font} color={f.fg} /> : null}
          {f.icon ? (
            cell.label ? (
              <View
                style={[
                  styles.corner,
                  { width: iconSize + 6, height: iconSize + 6, borderRadius: (iconSize + 6) / 2, backgroundColor: f.icon === 'check' ? CANVAS_TONES.correct : CANVAS_TONES.wrong },
                ]}
              >
                <Feather name={f.icon} size={iconSize} color="#FFFFFF" />
              </View>
            ) : (
              <Feather name={f.icon} size={iconSize} color="#FFFFFF" />
            )
          ) : null}
        </Animated.View>
      </View>
    </Pressable>
  )
}

const BADGE_ICONS: Record<string, FeatherName> = { 'play.reverseBadge': 'rotate-ccw', 'play.lookalikeBadge': 'copy' }

/** The row above a grid: header badge, chip, Flash Grid's waves (●○○) or a triples counter, Match Pairs' budget. */
function Strip({ view, theme, demo, nudge, t }: { view: GridView; theme: GameTheme; demo?: boolean; nudge: number; t: TFunction }) {
  const promptText = usePromptText()
  const chipText = view.chip ? (view.chip.text ?? (view.chip.key ? promptText({ key: view.chip.key, params: view.chip.params }) : '')) : ''
  const waves = view.progress?.kind === 'waves' ? view.progress : null
  const set = view.progress?.kind === 'set' ? view.progress : null
  const pill = demo ? styles.pillDemo : styles.pill
  const pillText = { fontSize: demo ? 12 : 14 }
  const badgeIcon = view.badge ? BADGE_ICONS[view.badge.key] : undefined
  return (
    <View style={[styles.strip, { minHeight: demo ? DEMO_STRIP_H - 6 : BOARD_STRIP_H - 8, marginBottom: demo ? 6 : 8 }]} testID={demo ? undefined : 'brain-strip'}>
      {view.badge ? (
        <View style={[styles.pillRow, pill, { borderWidth: 1.5, borderColor: theme.accent, backgroundColor: 'rgba(255,255,255,0.08)' }]} testID={demo ? undefined : 'brain-badge'}>
          {badgeIcon ? <Feather name={badgeIcon} size={demo ? 12 : 16} color={theme.accent} /> : null}
          <Text style={[styles.pillText, pillText, { color: theme.accent }]} numberOfLines={1} maxFontSizeMultiplier={1.2}>
            {t(view.badge.key)}
          </Text>
        </View>
      ) : null}
      {chipText ? <Chip text={chipText} amber={view.chip?.ink === 'amber'} nudge={nudge} demo={demo} /> : null}
      {waves ? (
        <View
          style={styles.dots}
          accessible
          accessibilityRole="image"
          accessibilityLabel={t('play.trial', { done: waves.done, total: waves.total })}
          testID={demo ? undefined : 'brain-waves'}
        >
          {Array.from({ length: Math.max(0, waves.total) }, (_, i) => {
            const on = i < waves.done
            const d = demo ? 8 : 12
            // Filled against hollow: shape, not only colour.
            return <View key={i} style={{ width: d, height: d, borderRadius: d / 2, borderWidth: 2, borderColor: on ? theme.accent : 'rgba(255,255,255,0.5)', backgroundColor: on ? theme.accent : 'transparent' }} />
          })}
        </View>
      ) : null}
      {set ? (
        <View style={[styles.pillRow, pill, { backgroundColor: 'rgba(255,255,255,0.14)' }]} testID={demo ? undefined : 'brain-set'}>
          <Text style={[styles.pillText, pillText, styles.tabular]} maxFontSizeMultiplier={1.2}>
            {set.open}/{set.size}
          </Text>
        </View>
      ) : null}
      {view.budget ? <Budget left={view.budget.left} total={view.budget.total} demo={demo} t={t} /> : null}
    </View>
  )
}

/** The strip's chip: it pops when its words change, and shakes when a wrong tap pulses it. Amber (and boxed) for the second series. */
function Chip({ text, amber, nudge, demo }: { text: string; amber: boolean; nudge: number; demo?: boolean }) {
  const shake = useMotion(nudge > 0 ? 'shake' : null, nudge)
  const pop = useMotion('pop', text)
  return (
    <Animated.View style={shake}>
      <Animated.View
        style={[
          styles.pillRow,
          demo ? styles.pillDemo : styles.pill,
          // The second series' colour, and its box: colour is never the only cue.
          amber ? { borderWidth: 2, borderColor: CELL_INK.amber, backgroundColor: 'rgba(251,191,36,0.12)' } : { backgroundColor: 'rgba(255,255,255,0.14)' },
          pop,
        ]}
        testID={demo ? undefined : 'brain-chip'}
      >
        <Text style={[styles.pillText, styles.tabular, { fontSize: demo ? 12 : 14, color: amber ? CELL_INK.amber : '#FFFFFF' }]} numberOfLines={1} maxFontSizeMultiplier={1.2}>
          {text}
        </Text>
      </Animated.View>
    </Animated.View>
  )
}

/** Match Pairs' miss budget: dots and «실수 N번까지» — never hearts, it is not the round's chances. */
function Budget({ left, total, demo, t }: { left: number; total: number; demo?: boolean; t: TFunction }) {
  const label = t('play.budget', { left })
  const d = demo ? 6 : 10
  return (
    <View
      style={[styles.pillRow, demo ? styles.pillDemo : styles.pill, { backgroundColor: 'rgba(255,255,255,0.1)', gap: 8 }]}
      accessible
      accessibilityRole="image"
      accessibilityLabel={label}
      testID={demo ? undefined : 'brain-budget'}
    >
      <View style={styles.budgetDots}>
        {Array.from({ length: Math.max(0, total) }, (_, i) => (
          <View key={i} style={{ width: d, height: d, borderRadius: d / 2, borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.7)', backgroundColor: i < left ? '#FFFFFF' : 'transparent' }} />
        ))}
      </View>
      {demo ? null : (
        <Text style={[styles.pillText, { fontSize: 14, fontWeight: '600' }]} numberOfLines={1} maxFontSizeMultiplier={1.2}>
          {label}
        </Text>
      )}
    </View>
  )
}

/** The memorise countdown under the grid — held while paused, static under reduce motion. */
function ShowBar({ ms, paused, accent, demo }: { ms: number; paused: boolean; accent: string; demo?: boolean }) {
  const drain = useDrain(ms, paused)
  const reduced = useReducedMotion()
  return (
    <View style={[styles.showTrack, { marginTop: demo ? 4 : 6 }]} pointerEvents="none" testID={demo ? undefined : 'brain-show-bar'}>
      <Animated.View style={[styles.showFill, { backgroundColor: accent, opacity: reduced ? 0.6 : 1 }, drain]} />
    </View>
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
  const pop = useMotion('pop', 0)
  const tile = (cell: CellView) => (
    <View style={styles.legendTile}>
      <Glyph cell={cell} font={26} color="#FFFFFF" />
    </View>
  )
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.overlay]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" testID="brain-legend">
      <Animated.View style={[styles.legend, pop]}>
        {tile({ label: starts[0], tone: 'idle' })}
        <Text style={styles.legendArrow} allowFontScaling={false}>
          ⇄
        </Text>
        {tile({ label: starts[1], tone: 'idle', ink: 'amber', boxed: true })}
      </Animated.View>
    </View>
  )
}

/** Odd One Out after a miss: the odd one beside a typical one, both upright (a mirror stays a mirror). */
function MissChip({ chip, atTop, theme, demo }: { chip: { odd: CellView; common: CellView }; atTop: boolean; theme: GameTheme; demo?: boolean }) {
  const pop = useMotion('pop', 0)
  const size = demo ? 34 : 52
  const tile = (cell: CellView, odd: boolean) => (
    <View style={[styles.missTile, { width: size, height: size }]}>
      {odd ? <View style={[styles.dashed, { top: 3, left: 3, right: 3, bottom: 3, borderRadius: 8, borderColor: theme.accent }]} /> : null}
      <Glyph cell={{ ...cell, tone: 'idle' }} font={Math.round(size * 0.5)} color="#FFFFFF" upright />
    </View>
  )
  return (
    <View
      pointerEvents="none"
      style={[styles.missWrap, atTop ? { top: 6 } : { bottom: 6 }]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      testID={demo ? undefined : 'brain-miss-chip'}
    >
      <Animated.View style={[styles.missChip, pop]}>
        {tile(chip.odd, true)}
        <Text style={styles.missNe} allowFontScaling={false}>
          ≠
        </Text>
        {tile(chip.common, false)}
      </Animated.View>
    </View>
  )
}

/** «없었어요» over the board when «없음» was right and not picked. */
function NoneStamp({ demo, t }: { demo?: boolean; t: TFunction }) {
  const pop = useMotion('pop', 0)
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.overlay]}>
      {/* Tilted outside, popping inside: the pop's own transform would otherwise undo the tilt. */}
      <View style={styles.stampTilt}>
        <Animated.View style={[styles.stamp, pop]} testID={demo ? undefined : 'brain-none-stamp'}>
          <Text style={[styles.stampText, { fontSize: demo ? 16 : 28 }]} numberOfLines={1} allowFontScaling={false}>
            {t('play.noneWas')}
          </Text>
        </Animated.View>
      </View>
    </View>
  )
}

/** Odd One Out's «없음»: full width under the grid, ≥ 56 tall and 16 below it. */
function ExtraButton({
  extra,
  width,
  locked,
  demo,
  theme,
  onTap,
  t,
  registerTarget,
}: {
  extra: NonNullable<GridView['extra']>
  width: number
  locked: boolean
  demo?: boolean
  theme: GameTheme
  onTap: (i: number) => void
  t: TFunction
  registerTarget?: (index: number, node: RNView | null) => void
}) {
  const tone = extra.tone ?? 'idle'
  const motion = useMotion(tone === 'correct' ? 'pop' : tone === 'wrong' ? 'shake' : tone === 'missed' ? 'pulse' : null, tone)
  const press = usePressAnswer(() => onTap(extra.index))
  const live = !locked && !demo
  const bg = tone === 'correct' ? CANVAS_TONES.correct : tone === 'wrong' ? CANVAS_TONES.wrong : CANVAS_TONES.tile
  const border = tone === 'correct' ? CANVAS_TONES.correct : tone === 'wrong' ? CANVAS_TONES.wrong : CANVAS_TONES.tileBorder
  const label = t(extra.key)
  const word = tone === 'correct' ? t('play.correct') : tone === 'wrong' ? t('play.wrong') : null
  return (
    <Pressable
      ref={registerTarget ? (node) => registerTarget(extra.index, node) : undefined}
      disabled={!live}
      {...press}
      style={({ pressed }) => [{ width, marginTop: demo ? 8 : 16 }, pressed && live && styles.pressedSoft]}
      accessibilityRole="button"
      accessibilityLabel={[label, word].filter(Boolean).join(', ')}
      accessibilityState={{ disabled: !live, checked: tone === 'correct' ? true : undefined }}
      testID={demo ? undefined : 'brain-extra'}
    >
      <Animated.View
        style={[
          styles.extra,
          {
            minHeight: demo ? 36 : 56,
            backgroundColor: bg,
            borderColor: border,
            opacity: tone === 'idle' && locked ? 0.55 : 1,
            boxShadow: tone === 'correct' ? '0 0 24px rgba(34,197,94,0.5)' : undefined,
          },
          motion,
        ]}
      >
        {tone === 'missed' ? <View style={[styles.dashed, { borderRadius: 12, borderColor: theme.accent }]} /> : null}
        {tone === 'correct' || tone === 'wrong' ? <Feather name={tone === 'correct' ? 'check' : 'x'} size={demo ? 16 : 22} color="#FFFFFF" /> : null}
        <Text style={[styles.extraText, { fontSize: demo ? 14 : 20 }]} numberOfLines={1} adjustsFontSizeToFit maxFontSizeMultiplier={1.3}>
          {label}
        </Text>
      </Animated.View>
    </Pressable>
  )
}

// ── Choice ────────────────────────────────────────────────────────────────────

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

/** The engine's worked line, space-separated with plain digits, as tokens. */
function lineTokens(line: string): (number | string)[] {
  return line
    .split(' ')
    .filter((tok) => tok !== '')
    .map((tok) => (/^\d+$/.test(tok) ? Number(tok) : tok))
}

function tokenText(tokens: readonly (number | string)[]): string {
  return tokens.map((tok) => (typeof tok === 'number' ? formatNumber(tok) : tok)).join(' ')
}

const HIGHLIGHT: TextStyle = { backgroundColor: '#FDE68A' }

/**
 * A line of tokens — the stimulus expression, or a worked line. Inside a unit the tokens are joined
 * by no-break spaces and units by plain ones, so the text only wraps before an operator.
 * `highlight` is a [start, end) range of the tokens (the part done first); `fill` takes the place of
 * the '?' once the answer is right.
 */
function TokenLine({
  tokens,
  fill = null,
  highlight,
  fontSize,
  style,
  testID,
}: {
  tokens: readonly (number | string)[]
  fill?: string | null
  highlight?: [number, number]
  fontSize: number
  style: TextStyle
  testID?: string
}) {
  const lit = (i: number) => highlight !== undefined && i >= highlight[0] && i < highlight[1]
  const tight = (a: number | string | undefined, b: number | string) => a === '(' || b === ')'
  const parts: ReactNode[] = []
  expressionUnits(tokens).forEach((unit, u) => {
    if (u > 0) parts.push(<Text key={`u${u}`} style={lit(unit[0] - 1) && lit(unit[0]) ? HIGHLIGHT : undefined}>{' '}</Text>)
    unit.forEach((i, k) => {
      if (k > 0 && !tight(tokens[unit[k - 1]], tokens[i])) {
        parts.push(
          <Text key={`s${i}`} style={lit(i - 1) && lit(i) ? HIGHLIGHT : undefined}>
            {' '}
          </Text>,
        )
      }
      const tok = tokens[i]
      const filled = tok === '?' && fill !== null
      parts.push(
        <Text key={i} style={[lit(i) ? HIGHLIGHT : null, filled ? styles.filled : null]}>
          {typeof tok === 'number' ? formatNumber(tok) : filled ? fill : tok}
        </Text>,
      )
    })
  })
  return (
    <Text style={[styles.tokens, style, { fontSize, lineHeight: Math.round(fontSize * 1.25) }]} allowFontScaling={false} testID={testID}>
      {parts}
    </Text>
  )
}

/**
 * The expression's size: large when short, never below 28pt (EVIDENCE: game numbers ≥ 28pt), and
 * small enough that a long one wraps onto at most three lines inside the card.
 */
function expressionFont(len: number, lineWidth: number, maxHeight: number, demo?: boolean): number {
  if (demo) return len > 12 ? 20 : 28
  let f = len <= 9 ? 52 : len <= 16 ? 42 : 34
  const lines = (size: number) => Math.max(1, Math.ceil((len * 0.6 * size) / Math.max(1, lineWidth)))
  while (f > 28 && (lines(f) > 3 || lines(f) * f * 1.25 > maxHeight)) f -= 2
  return f
}

/** Number Pattern's lines (reveal `groups`): each its own colour AND border, so colour is never the only cue. */
const LINE_STYLES: readonly { bg: string; border: string; borderStyle: 'solid' | 'dashed' | 'dotted'; fg: string }[] = [
  { bg: '#F1F5F9', border: '#94A3B8', borderStyle: 'solid', fg: '#0F172A' },
  { bg: '#FEF3C7', border: '#B45309', borderStyle: 'dashed', fg: '#78350F' },
  { bg: '#CFFAFE', border: '#0E7490', borderStyle: 'dotted', fg: '#164E63' },
]
const LINE_INK = ['#334155', '#92400E', '#155E75']
/** A gap label's box, centred on the space between two tiles. */
const GAP_LABEL_W = 72

function Terms({ terms, fill, gaps, groups, demo, pulse }: { terms: readonly (number | null)[]; fill: string | null; gaps?: string[]; groups?: number[]; demo?: boolean; pulse: boolean }) {
  const n = terms.length
  const font = demo ? 18 : n <= 5 ? 40 : n <= 7 ? 34 : 30
  const colGap = demo ? 8 : 14
  const labelled = gaps !== undefined && gaps.some((g) => g)
  const labelFont = demo ? 11 : Math.max(15, Math.round(font * 0.42))
  return (
    <View
      style={[styles.terms, { columnGap: colGap, rowGap: labelled ? (demo ? 18 : 30) : demo ? 6 : 10, paddingBottom: labelled ? labelFont + 6 : 0 }]}
      testID={demo ? undefined : 'brain-terms'}
    >
      {terms.map((v, i) => (
        <Term
          key={i}
          value={v}
          fill={fill}
          line={Math.max(0, Math.min(LINE_STYLES.length - 1, groups?.[i] ?? 0))}
          label={i < n - 1 ? gaps?.[i] : undefined}
          font={font}
          colGap={colGap}
          labelFont={labelFont}
          pulse={pulse && !demo}
        />
      ))}
    </View>
  )
}

function Term({ value, fill, line, label, font, colGap, labelFont, pulse }: { value: number | null; fill: string | null; line: number; label?: string; font: number; colGap: number; labelFont: number; pulse: boolean }) {
  const gap = value === null
  // The gap breathes at under 1Hz (not at all under reduce motion); filled, it pops.
  const motion = useMotion(gap ? (fill !== null ? 'pop' : pulse ? 'breathe' : null) : null, `${fill}-${pulse}`)
  const base = LINE_STYLES[line]
  const look = gap
    ? fill !== null
      ? { bg: '#DCFCE7', border: '#15803D', borderStyle: 'solid' as const, fg: '#15803D' }
      : { bg: '#FFFFFF', border: '#64748B', borderStyle: 'dashed' as const, fg: '#64748B' }
    : base
  return (
    <Animated.View
      style={[
        styles.term,
        {
          minWidth: Math.round(font * 1.6),
          paddingHorizontal: Math.round(font * 0.3),
          paddingVertical: Math.round(font * 0.14),
          backgroundColor: look.bg,
          borderColor: look.border,
          borderStyle: look.borderStyle,
        },
        motion,
      ]}
    >
      <Text style={[styles.termText, { fontSize: font, lineHeight: Math.round(font * 1.15), color: look.fg }]} allowFontScaling={false}>
        {value === null ? (fill ?? '?') : formatNumber(value)}
      </Text>
      {label ? <GapLabel text={label} color={LINE_INK[line]} font={labelFont} colGap={colGap} /> : null}
    </Animated.View>
  )
}

function GapLabel({ text, color, font, colGap }: { text: string; color: string; font: number; colGap: number }) {
  const rise = useMotion('rise', text)
  return (
    <Animated.Text
      style={[styles.gapLabel, { width: GAP_LABEL_W, marginLeft: colGap / 2 - GAP_LABEL_W / 2, fontSize: font, lineHeight: Math.round(font * 1.2), color }, rise]}
      numberOfLines={1}
      allowFontScaling={false}
    >
      {text}
    </Animated.Text>
  )
}

/** Color Word's cue: the app's icon and a word, always in the same place; it flips when the rule switched. */
function CueStrip({ cue, demo, theme, t }: { cue: 'ink' | 'word'; demo?: boolean; theme: GameTheme; t: TFunction }) {
  const [flip] = useState(() => !demo && memory.theme === theme && memory.cue !== null && memory.cue !== cue)
  const turn = useMotion(flip ? 'turnX' : null, 0)
  useEffect(() => {
    if (demo) return
    memory.theme = theme
    memory.cue = cue
  }, [cue, demo, theme])
  const ink = cue === 'ink'
  const label = t(ink ? 'play.cueInk' : 'play.cueWord')
  return (
    <Animated.View
      style={[styles.cue, { height: demo ? 32 : 44 }, ink ? styles.cueInk : styles.cueWord, turn]}
      accessible
      accessibilityLabel={label}
      testID={demo ? undefined : 'brain-cue'}
    >
      <Feather name={ink ? 'droplet' : 'book-open'} size={demo ? 16 : 20} color={ink ? CANVAS_INK : '#FFFFFF'} />
      <Text style={[styles.cueText, { fontSize: demo ? 14 : 18, color: ink ? CANVAS_INK : '#FFFFFF' }]} numberOfLines={1} maxFontSizeMultiplier={1.3}>
        {label}
      </Text>
    </Animated.View>
  )
}

function optionText(o: ChoiceView['options'][number], t: TFunction): string {
  if (o.value !== undefined) return formatNumber(o.value)
  if (o.textKey) return t(o.textKey)
  return o.text ?? ''
}

export function ChoiceBoard({ view, onTap, width, height, theme, demo, onSkipReveal, registerTarget }: BoardProps & { view: ChoiceView }) {
  const { t } = useTranslation('brain')
  const promptText = usePromptText()
  const st = view.stimulus
  const answered = view.correctIndex !== undefined
  // Color Word's cue lead: the cue is up, the word not yet — and nothing can be picked.
  const leading = st.hidden === true && !answered
  const right = answered && view.picked === view.correctIndex
  const reveal = answered ? st.reveal : undefined
  // A miss shows the working (the worked lines, what was done first, «글자 색: …»); a right answer
  // only fills the gap — with the rule's gaps and lines coloured, when there are any.
  const working = answered && !right ? reveal : undefined
  const answerText = answered && view.correctIndex !== undefined && view.options[view.correctIndex] ? optionText(view.options[view.correctIndex], t) : null
  const canSkip = reveal !== undefined && onSkipReveal !== undefined && !demo
  // Mounted during the cue lead: the word rises in when it comes.
  const [hadLead] = useState(leading)

  const columns = view.options.length > 4 ? 3 : 2
  const rows = Math.ceil(view.options.length / columns)
  const boardWidth = Math.min(width, demo ? 300 : 480)
  const optionGap = demo ? 8 : 12
  const optionWidth = Math.floor((boardWidth - optionGap * (columns - 1)) / columns)
  // Fit the measured height: the options keep a comfortable 56-72, the cue strip its 44, the
  // stimulus card takes the rest.
  const mainGap = demo ? 12 : height < 300 ? 14 : 20
  const optionH = demo ? 44 : height < 320 ? 56 : 68
  const cueH = st.cue ? (demo ? 32 : 44) + (demo ? 8 : 10) : 0
  const room = height - mainGap - rows * optionH - (rows - 1) * optionGap - cueH
  const stimH = demo ? 72 : Math.max(84, Math.min(150, room))
  const frame = st.frame ? (demo ? 6 : 12) : 0
  const padX = frame ? (demo ? 8 : 14) : 16
  const padY = frame ? (demo ? 6 : 10) : 10
  const lineWidth = boardWidth - 2 * (frame + padX)

  const stimulus = st.textKey ? t(st.textKey) : (st.text ?? '')
  const sig = st.tokens ? st.tokens.join(' ') : st.terms ? st.terms.join(',') : stimulus
  const enter = useMotion('rise', `${sig}-${st.color ?? ''}`)
  const ink = st.color ? INK_COLORS[st.color] : CANVAS_INK

  let body: ReactNode
  if (st.terms) {
    body = <Terms terms={st.terms} fill={right || reveal ? answerText : null} gaps={reveal?.gaps} groups={reveal?.groups} demo={demo} pulse={!answered} />
  } else if (st.tokens) {
    const font = expressionFont(tokenText(st.tokens).length, lineWidth, Math.max(60, stimH - 2 * (frame + padY)), demo)
    body = <TokenLine tokens={st.tokens} fill={right ? answerText : null} fontSize={font} style={{ color: ink, fontWeight: '800' }} testID={demo ? undefined : 'brain-expression'} />
  } else {
    const long = stimulus.length > 14
    const stimFont = demo ? (long ? 20 : 28) : long ? 32 : stimH >= 110 ? 52 : 42
    body = (
      <Text
        style={{ fontSize: stimFont, lineHeight: Math.round(stimFont * 1.2), fontWeight: '800', textAlign: 'center', letterSpacing: 0.5, color: ink }}
        adjustsFontSizeToFit
        // A long series may shrink, but stays large.
        minimumFontScale={0.8}
        numberOfLines={2}
        allowFontScaling={false}
        testID={demo ? undefined : 'brain-stimulus'}
      >
        {stimulus}
      </Text>
    )
  }

  const roomy = room >= 200
  const revealSpoken = [working?.lines?.join('. '), working?.prompt ? promptText(working.prompt) : null].filter(Boolean).join('. ')

  return (
    <View style={[styles.choice, { width: boardWidth, gap: mainGap }]}>
      <View style={{ gap: demo ? 8 : 10 }}>
        {st.cue ? <CueStrip cue={st.cue} demo={demo} theme={theme} t={t} /> : null}
        {/* The stimulus on a white card: ink colours keep their contrast whatever the game's canvas. */}
        <Pressable
          disabled={!canSkip}
          onPress={canSkip ? onSkipReveal : undefined}
          // Only once a reveal is up is the card one button ("move on"); before that its text stays
          // its own element for screen readers.
          accessible={canSkip}
          accessibilityRole={canSkip ? 'button' : undefined}
          accessibilityLabel={canSkip ? [st.tokens ? tokenText(st.tokens) : st.terms ? st.terms.map((v) => (v === null ? '?' : formatNumber(v))).join(', ') : stimulus, revealSpoken].filter(Boolean).join('. ') : undefined}
        >
          <Animated.View
            style={[
              styles.stimulus,
              { minHeight: stimH, paddingHorizontal: padX, paddingVertical: padY },
              // Color Word's frame lure: a ring in a third colour, inside the card's edge.
              frame ? { borderWidth: frame, borderColor: INK_COLORS[st.frame ?? 'black'] } : null,
              enter,
            ]}
            testID={demo || (!st.tokens && !st.terms) ? undefined : 'brain-stimulus'}
          >
            {leading ? (
              // The cue is up, the word is not yet: hold the card's size so nothing moves when it comes.
              <Text style={[styles.leadDots, { fontSize: demo ? 28 : 52, lineHeight: Math.round((demo ? 28 : 52) * 1.2) }]} allowFontScaling={false} accessibilityElementsHidden importantForAccessibility="no">
                ···
              </Text>
            ) : hadLead ? (
              <Enter motion="rise">{body}</Enter>
            ) : (
              body
            )}
            {working?.lines && working.lines.length > 0 ? (
              <Enter motion="rise">
                <View style={styles.revealLines} testID={demo ? undefined : 'brain-reveal-lines'}>
                  {working.lines.map((line, i) => (
                    <TokenLine key={i} tokens={lineTokens(line)} highlight={i === 0 ? working.highlight : undefined} fontSize={demo ? 14 : roomy ? 26 : 20} style={styles.revealLine} />
                  ))}
                </View>
              </Enter>
            ) : null}
            {working?.prompt ? (
              <Enter motion="rise">
                <Text style={[styles.revealPrompt, { fontSize: demo ? 14 : 20 }]} maxFontSizeMultiplier={1.3} testID={demo ? undefined : 'brain-reveal-prompt'}>
                  {promptText(working.prompt)}
                </Text>
              </Enter>
            ) : null}
          </Animated.View>
        </Pressable>
      </View>
      <View style={[styles.options, { columnGap: optionGap, rowGap: optionGap }]}>
        {view.options.map((o, i) => (
          <ChoiceOption
            key={i}
            index={i}
            label={optionText(o, t)}
            ink={o.color ? INK_COLORS[o.color] : undefined}
            numeric={o.value !== undefined}
            width={optionWidth}
            height={optionH}
            right={answered && i === view.correctIndex}
            picked={answered && i === view.picked && i !== view.correctIndex}
            answered={answered}
            leading={leading}
            demo={demo}
            onTap={onTap}
            t={t}
            registerTarget={registerTarget}
          />
        ))}
      </View>
    </View>
  )
}

function ChoiceOption({
  index,
  label,
  ink,
  numeric,
  width,
  height,
  right,
  picked,
  answered,
  leading,
  demo,
  onTap,
  t,
  registerTarget,
}: {
  index: number
  label: string
  /** A coloured label (Color Word): ink on a white tile. */
  ink?: string
  numeric: boolean
  width: number
  height: number
  right: boolean
  picked: boolean
  answered: boolean
  leading: boolean
  demo?: boolean
  onTap: (i: number) => void
  t: TFunction
  registerTarget?: (index: number, node: RNView | null) => void
}) {
  const motion = useMotion(right ? 'pop' : picked ? 'shake' : null, `${right}-${picked}`)
  const press = usePressAnswer(() => onTap(index))
  const live = !answered && !leading && !demo
  // A coloured label is ink on a white tile (orange is 3.6:1, so ≥ 24pt bold).
  const bg = right ? CANVAS_TONES.correct : picked ? CANVAS_TONES.wrong : ink ? '#FFFFFF' : CANVAS_TONES.tile
  const border = right ? CANVAS_TONES.correct : picked ? CANVAS_TONES.wrong : ink ? 'rgba(255,255,255,0.9)' : CANVAS_TONES.tileBorder
  const fg = right || picked || !ink ? '#FFFFFF' : ink
  const opacity = leading ? 0.55 : answered && !right && !picked ? 0.4 : 1
  return (
    <Pressable
      ref={registerTarget ? (node) => registerTarget(index, node) : undefined}
      disabled={!live}
      {...press}
      style={({ pressed }) => [{ width }, pressed && live && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel={[label, right ? t('play.correct') : picked ? t('play.wrong') : null].filter(Boolean).join(', ')}
      accessibilityState={{ disabled: !live, checked: right ? true : undefined }}
      testID={demo ? undefined : `brain-option-${index}`}
    >
      <Animated.View
        style={[styles.option, { minHeight: height, backgroundColor: bg, borderColor: border, opacity, boxShadow: right ? '0 0 24px rgba(34,197,94,0.5)' : undefined }, motion]}
      >
        {right || picked ? <Feather name={right ? 'check' : 'x'} size={demo ? 16 : 22} color="#FFFFFF" /> : null}
        <Text style={[styles.optionText, numeric && styles.tabular, { fontSize: demo ? 16 : 24, color: fg }]} numberOfLines={1} adjustsFontSizeToFit allowFontScaling={false}>
          {label}
        </Text>
      </Animated.View>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  gridColumn: { alignSelf: 'center', alignItems: 'center' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', alignSelf: 'center' },
  pressed: { transform: [{ scale: 0.93 }] },
  pressedSoft: { transform: [{ scale: 0.97 }] },
  face: { alignItems: 'center', justifyContent: 'center' },
  label: { fontWeight: '700', textAlign: 'center' },
  dashed: { position: 'absolute', top: 5, left: 5, right: 5, bottom: 5, borderWidth: 3, borderStyle: 'dashed' },
  corner: { position: 'absolute', top: 4, right: 4, alignItems: 'center', justifyContent: 'center' },
  tabular: { fontVariant: ['tabular-nums'] },
  overlay: { alignItems: 'center', justifyContent: 'center', zIndex: 10, elevation: 10 },
  strip: { alignSelf: 'stretch', flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center', columnGap: 12, rowGap: 4 },
  pill: { height: 32, paddingHorizontal: 12, borderRadius: 16 },
  pillDemo: { height: 24, paddingHorizontal: 8, borderRadius: 12 },
  pillRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  pillText: { color: '#FFFFFF', fontWeight: '700' },
  dots: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  budgetDots: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  showTrack: { position: 'absolute', top: '100%', left: 0, right: 0, height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.10)', overflow: 'hidden' },
  showFill: { height: 6, width: '100%', borderRadius: 3, transformOrigin: 'left' },
  legend: { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 24, paddingHorizontal: 16, paddingVertical: 12, backgroundColor: 'rgba(2,6,23,0.8)', boxShadow: '0 10px 30px rgba(0,0,0,0.4)' },
  legendTile: { width: 56, height: 56, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(15,23,42,0.85)', borderWidth: 1.5, borderColor: CANVAS_TONES.tileBorder },
  legendArrow: { color: 'rgba(255,255,255,0.8)', fontSize: 24, fontWeight: '900' },
  missWrap: { position: 'absolute', left: 0, right: 0, alignItems: 'center', zIndex: 10, elevation: 10 },
  missChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
    backgroundColor: 'rgba(2,6,23,0.88)',
    boxShadow: '0 10px 30px rgba(0,0,0,0.4)',
  },
  missTile: { borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: CANVAS_TONES.tile, borderWidth: 1.5, borderColor: CANVAS_TONES.tileBorder },
  missNe: { color: 'rgba(255,255,255,0.7)', fontSize: 20, fontWeight: '900' },
  stampTilt: { transform: [{ rotate: '-6deg' }] },
  stamp: { paddingHorizontal: 20, paddingVertical: 8, borderRadius: 16, borderWidth: 4, borderColor: FX.gold, backgroundColor: 'rgba(15,23,42,0.78)' },
  stampText: { color: FX.gold, fontWeight: '900' },
  extra: { borderRadius: 18, borderWidth: 1.5, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 12 },
  extraText: { color: '#FFFFFF', fontWeight: '700', flexShrink: 1 },
  choice: { alignSelf: 'center' },
  stimulus: {
    borderRadius: 24,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    boxShadow: '0 18px 40px rgba(0,0,0,0.35)',
  },
  tokens: { textAlign: 'center', fontVariant: ['tabular-nums'], letterSpacing: 0.5 },
  filled: { color: '#15803D' },
  revealLines: { alignItems: 'center' },
  revealLine: { color: '#334155', fontWeight: '700' },
  revealPrompt: { color: '#334155', fontWeight: '600', textAlign: 'center' },
  leadDots: { color: '#CBD5E1', fontWeight: '800', textAlign: 'center' },
  terms: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center' },
  term: { borderRadius: 12, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  termText: { fontWeight: '800', fontVariant: ['tabular-nums'], textAlign: 'center' },
  gapLabel: { position: 'absolute', top: '100%', left: '100%', marginTop: 3, fontWeight: '700', textAlign: 'center' },
  cue: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 16 },
  cueInk: { backgroundColor: '#FFFFFF' },
  cueWord: { backgroundColor: CANVAS_INK, borderWidth: 2, borderColor: 'rgba(255,255,255,0.7)' },
  cueText: { fontWeight: '700' },
  // A short last row (five colours in three columns) sits centred rather than spread apart.
  options: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center' },
  option: {
    borderRadius: 18,
    borderWidth: 1.5,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: 8,
  },
  optionText: { color: '#FFFFFF', fontWeight: '700', flexShrink: 1 },
})
