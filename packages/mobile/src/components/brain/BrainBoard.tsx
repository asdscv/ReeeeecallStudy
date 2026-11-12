import { useRef } from 'react'
import { View, Text, Pressable, StyleSheet, type View as RNView } from 'react-native'
import Animated from 'react-native-reanimated'
import { Feather } from '@expo/vector-icons'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import {
  CANVAS_TONES,
  INK_COLORS,
  type CellTone,
  type CellView,
  type ChoiceView,
  type GameTheme,
  type GridView,
  type RoundView,
} from '@reeeeecall/shared/lib/brain-games'
import { testProps } from '../../utils/testProps'
import { CANVAS_INK } from './brain-ui'
import { GradientFill } from './GameCanvas'
import { useMotion, type Motion } from './motion'
import { QuickEyeBoard } from './QuickEyeBoard'

/**
 * Draws whatever trial the engine hands over — a grid, a pick-one choice, or Quick Eye's field —
 * on the game's dark canvas. Three shapes cover all nine games.
 *
 * `demo` draws the same board for the how-to-play player: smaller, hidden from screen readers,
 * taking no input, and reporting where each tap target is so the demo's finger can find it.
 */
export interface BoardProps {
  view: RoundView
  onTap: (index: number) => void
  onExposure: (actualMs: number, frameMs: number) => void
  /** The space the board may use, measured by its parent. */
  width: number
  height: number
  theme: GameTheme
  demo?: boolean
  /** The round is paused (Quick Eye stops counting frames). */
  paused?: boolean
  /** Demo only: each tap target's view, by the index a tap on it sends. */
  registerTarget?: (index: number, node: RNView | null) => void
}

export function BrainBoard(props: BoardProps) {
  const { view } = props
  if (view.kind === 'grid') return <GridBoard {...props} view={view} />
  if (view.kind === 'choice') return <ChoiceBoard {...props} view={view} />
  return (
    <QuickEyeBoard
      view={view}
      onTap={props.onTap}
      onExposure={props.onExposure}
      width={props.width}
      height={props.height}
      theme={props.theme}
      demo={props.demo}
      paused={props.paused}
      registerTarget={props.registerTarget}
    />
  )
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

// ── Grid ──────────────────────────────────────────────────────────────────────

const GAP = 8
const DEMO_GAP = 6
/**
 * The engine caps the columns so cells are ≥ 56 wide; a tall board (Match Pairs' 4×6) on a short
 * phone may still need them a little smaller to fit the height — never under 48, the touch minimum.
 */
const MIN_CELL = 48
/** On a tablet a 3×3 grid would otherwise fill the screen with three giant cells. */
const MAX_CELL = 120

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
      return { bg: CANVAS_TONES.done, fg: 'rgba(255,255,255,0.32)', border: 'rgba(255,255,255,0.06)', borderWidth: 1.5, motion: null }
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

export function GridBoard({ view, onTap, width, height, theme, demo, registerTarget }: BoardProps & { view: GridView }) {
  const { t } = useTranslation('brain')
  const gap = demo ? DEMO_GAP : GAP
  // Fit the width AND the measured height (a 4×6 Match Pairs board on a 360×640 phone).
  const byWidth = (width - gap * (view.cols - 1)) / view.cols
  const byHeight = (height - gap * (view.rows - 1)) / view.rows
  const cell = Math.max(demo ? 24 : MIN_CELL, Math.floor(Math.min(byWidth, byHeight, demo ? 64 : MAX_CELL)))
  // Older eyes first: never below 28pt in play, growing with the cell.
  const font = Math.max(demo ? 14 : 28, Math.round(cell * 0.44))
  const boardWidth = cell * view.cols + gap * (view.cols - 1)

  return (
    <View style={[styles.grid, { width: boardWidth, gap }]} {...(demo ? {} : testProps('brain-grid', true))}>
      {view.cells.map((c, i) => (
        <Cell key={i} cell={c} index={i} size={cell} font={font} locked={view.locked} demo={demo} theme={theme} onTap={onTap} t={t} registerTarget={registerTarget} />
      ))}
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
          {cell.label ? (
            <Text
              style={[
                { fontSize: font, lineHeight: Math.round(font * 1.2), color: f.fg },
                styles.label,
                cell.rotate ? { transform: [{ rotate: `${cell.rotate}deg` }] } : null,
              ]}
              // The cell is sized for the glyph; system text scaling would push it out.
              allowFontScaling={false}
            >
              {cell.label}
            </Text>
          ) : null}
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

// ── Choice ────────────────────────────────────────────────────────────────────

export function ChoiceBoard({ view, onTap, width, height, demo, registerTarget }: BoardProps & { view: ChoiceView }) {
  const { t } = useTranslation('brain')
  const answered = view.correctIndex !== undefined
  const stimulus = view.stimulus.textKey ? t(view.stimulus.textKey) : view.stimulus.text ?? ''
  const long = stimulus.length > 14
  const columns = view.options.length > 4 ? 3 : 2
  const rows = Math.ceil(view.options.length / columns)
  const boardWidth = Math.min(width, demo ? 300 : 480)
  const optionGap = demo ? 8 : 12
  const optionWidth = Math.floor((boardWidth - optionGap * (columns - 1)) / columns)
  // Fit the measured height: the options keep a comfortable 56-72, the stimulus card takes the rest.
  const mainGap = demo ? 12 : height < 300 ? 14 : 20
  const optionH = demo ? 44 : height < 320 ? 56 : 68
  const stimH = demo ? 72 : Math.max(84, Math.min(150, height - mainGap - rows * optionH - (rows - 1) * optionGap))
  const stimFont = demo ? (long ? 20 : 28) : long ? 32 : stimH >= 110 ? 52 : 42
  const enter = useMotion('rise', `${stimulus}-${view.stimulus.color ?? ''}`)

  return (
    <View style={[styles.choice, { width: boardWidth, gap: mainGap }]}>
      {/* The stimulus on a white card: ink colours keep their contrast whatever the game's canvas. */}
      <Animated.View style={[styles.stimulus, { minHeight: stimH }, enter]}>
        <Text
          style={{
            fontSize: stimFont,
            lineHeight: Math.round(stimFont * 1.2),
            fontWeight: '800',
            textAlign: 'center',
            letterSpacing: 0.5,
            color: view.stimulus.color ? INK_COLORS[view.stimulus.color] : CANVAS_INK,
          }}
          adjustsFontSizeToFit
          // A long series may shrink, but stays large.
          minimumFontScale={0.8}
          numberOfLines={2}
          allowFontScaling={false}
          testID={demo ? undefined : 'brain-stimulus'}
        >
          {stimulus}
        </Text>
      </Animated.View>
      <View style={[styles.options, { columnGap: optionGap, rowGap: optionGap }]}>
        {view.options.map((o, i) => (
          <ChoiceOption
            key={i}
            index={i}
            label={o.textKey ? t(o.textKey) : o.text ?? ''}
            width={optionWidth}
            height={optionH}
            right={answered && i === view.correctIndex}
            picked={answered && i === view.picked && i !== view.correctIndex}
            answered={answered}
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
  width,
  height,
  right,
  picked,
  answered,
  demo,
  onTap,
  t,
  registerTarget,
}: {
  index: number
  label: string
  width: number
  height: number
  right: boolean
  picked: boolean
  answered: boolean
  demo?: boolean
  onTap: (i: number) => void
  t: TFunction
  registerTarget?: (index: number, node: RNView | null) => void
}) {
  const motion = useMotion(right ? 'pop' : picked ? 'shake' : null, `${right}-${picked}`)
  const press = usePressAnswer(() => onTap(index))
  const bg = right ? CANVAS_TONES.correct : picked ? CANVAS_TONES.wrong : CANVAS_TONES.tile
  const border = right ? CANVAS_TONES.correct : picked ? CANVAS_TONES.wrong : CANVAS_TONES.tileBorder
  const dim = answered && !right && !picked
  return (
    <Pressable
      ref={registerTarget ? (node) => registerTarget(index, node) : undefined}
      disabled={answered || demo}
      {...press}
      style={({ pressed }) => [{ width }, pressed && !answered && !demo && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel={[label, right ? t('play.correct') : picked ? t('play.wrong') : null].filter(Boolean).join(', ')}
      accessibilityState={{ disabled: answered, checked: right ? true : undefined }}
      testID={demo ? undefined : `brain-option-${index}`}
    >
      <Animated.View
        style={[
          styles.option,
          { minHeight: height, backgroundColor: bg, borderColor: border, opacity: dim ? 0.4 : 1, boxShadow: right ? '0 0 24px rgba(34,197,94,0.5)' : undefined },
          motion,
        ]}
      >
        {right || picked ? <Feather name={right ? 'check' : 'x'} size={demo ? 16 : 22} color="#FFFFFF" /> : null}
        <Text style={[styles.optionText, { fontSize: demo ? 16 : 24 }]} numberOfLines={1} adjustsFontSizeToFit allowFontScaling={false}>
          {label}
        </Text>
      </Animated.View>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', alignSelf: 'center' },
  pressed: { transform: [{ scale: 0.93 }] },
  face: { alignItems: 'center', justifyContent: 'center' },
  label: { fontWeight: '700', textAlign: 'center' },
  dashed: { position: 'absolute', top: 5, left: 5, right: 5, bottom: 5, borderWidth: 3, borderStyle: 'dashed' },
  corner: { position: 'absolute', top: 4, right: 4, alignItems: 'center', justifyContent: 'center' },
  choice: { alignSelf: 'center' },
  stimulus: {
    borderRadius: 24,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    boxShadow: '0 18px 40px rgba(0,0,0,0.35)',
  },
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
