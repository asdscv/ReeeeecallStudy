import { View, Text, Pressable, StyleSheet } from 'react-native'
import { Feather } from '@expo/vector-icons'
import { useTranslation } from 'react-i18next'
import type { ChoiceView, GridView, RoundView } from '@reeeeecall/shared/lib/brain-games'
import { useTheme } from '../../theme'
import { haptics } from '../../utils/haptics'
import { testProps } from '../../utils/testProps'
import { INK, toneStyle, type ToneMark } from './brain-ui'
import { QuickEyeBoard } from './QuickEyeBoard'

export interface BoardProps {
  view: RoundView
  onTap: (index: number) => void
  onExposure: (actualMs: number, frameMs: number) => void
  /** The space the board may use, measured by RoundView. */
  width: number
  height: number
}

/** Draws whatever trial the engine hands over. Three shapes cover all nine games. */
export function BrainBoard({ view, onTap, onExposure, width, height }: BoardProps) {
  if (view.kind === 'grid') return <GridBoard view={view} onTap={onTap} width={width} height={height} />
  if (view.kind === 'choice') return <ChoiceBoard view={view} onTap={onTap} width={width} />
  return <QuickEyeBoard view={view} onTap={onTap} onExposure={onExposure} width={width} height={height} />
}

const GAP = 8
/** The engine sized the grid (maxColsFor) so this always fits the width. */
const MIN_CELL = 56
/** On a tablet a 3×3 grid would otherwise fill the screen with three giant cells. */
const MAX_CELL = 120

export function GridBoard({ view, onTap, width, height }: { view: GridView; onTap: (index: number) => void; width: number; height: number }) {
  const theme = useTheme()
  // Fit the width, and keep tall boards (Match Pairs' 4×6) inside the measured height.
  const byWidth = (width - GAP * (view.cols - 1)) / view.cols
  const byHeight = (height - GAP * (view.rows - 1)) / view.rows
  const cell = Math.max(MIN_CELL, Math.floor(Math.min(byWidth, byHeight, MAX_CELL)))
  // Older eyes first: never below 28pt, and growing with the cell.
  const fontSize = Math.max(28, Math.round(cell * 0.5))
  const boardWidth = cell * view.cols + GAP * (view.cols - 1)

  return (
    <View style={[styles.grid, { width: boardWidth, gap: GAP }]} {...testProps('brain-grid', true)}>
      {view.cells.map((c, i) => {
        const tone = toneStyle(c.tone, theme)
        return (
          <Pressable
            key={i}
            disabled={view.locked}
            // Press-in, not press: a press waits for the finger to lift, which is a perceptible
            // lag in a game scored on speed.
            onPressIn={() => {
              haptics.selection()
              onTap(i)
            }}
            accessibilityRole="button"
            accessibilityState={{ disabled: view.locked }}
            style={{
              width: cell,
              height: cell,
              borderRadius: 12,
              backgroundColor: tone.bg,
              opacity: tone.opacity ?? 1,
              borderWidth: tone.border ? (tone.borderWidth ?? 2) : 0,
              borderColor: tone.border,
              borderStyle: tone.borderStyle ?? 'solid',
              alignItems: 'center',
              justifyContent: 'center',
            }}
            {...testProps(`brain-cell-${i}`)}
          >
            {c.label ? (
              <Text
                style={{
                  fontSize,
                  lineHeight: Math.round(fontSize * 1.2),
                  fontWeight: '700',
                  color: tone.fg,
                  ...(c.rotate ? { transform: [{ rotate: `${c.rotate}deg` }] } : {}),
                }}
                // The cell is sized for the glyph; system text scaling would push it out.
                allowFontScaling={false}
              >
                {c.label}
              </Text>
            ) : tone.mark ? (
              <Mark mark={tone.mark} color={tone.fg} size={cell} />
            ) : null}
            {c.label && (tone.mark === 'check' || tone.mark === 'cross') ? (
              <View style={[styles.corner, { backgroundColor: tone.fg }]}>
                <Feather name={tone.mark === 'check' ? 'check' : 'x'} size={Math.max(12, Math.round(cell * 0.18))} color={tone.bg} />
              </View>
            ) : null}
          </Pressable>
        )
      })}
    </View>
  )
}

/** The shape cue drawn in an empty cell: a dot for "remember this one", ✓ and ✕ for the answer. */
function Mark({ mark, color, size }: { mark: ToneMark; color: string; size: number }) {
  if (mark === 'dot') {
    const d = Math.round(size * 0.3)
    return <View style={{ width: d, height: d, borderRadius: d / 2, backgroundColor: color }} />
  }
  return <Feather name={mark === 'check' ? 'check' : 'x'} size={Math.round(size * 0.46)} color={color} />
}

export function ChoiceBoard({ view, onTap, width }: { view: ChoiceView; onTap: (index: number) => void; width: number }) {
  const theme = useTheme()
  const { t } = useTranslation('brain')
  const answered = view.correctIndex !== undefined
  const stimulus = view.stimulus.textKey ? t(view.stimulus.textKey) : view.stimulus.text ?? ''
  const columns = view.options.length > 4 ? 3 : 2
  const boardWidth = Math.min(width, 480)
  const optionWidth = Math.floor((boardWidth - 12 * (columns - 1)) / columns)

  return (
    <View style={[styles.choice, { width: boardWidth }]}>
      <View style={[styles.stimulus, { backgroundColor: theme.colors.surfaceElevated, borderColor: theme.colors.border }]}>
        <Text
          style={{
            fontSize: 48,
            lineHeight: 58,
            fontWeight: '800',
            textAlign: 'center',
            color: view.stimulus.color ? INK[view.stimulus.color] : theme.colors.text,
          }}
          adjustsFontSizeToFit
          // A long series may shrink, but not below 40pt.
          minimumFontScale={0.84}
          numberOfLines={2}
          allowFontScaling={false}
          {...testProps('brain-stimulus')}
        >
          {stimulus}
        </Text>
      </View>
      <View style={styles.options}>
        {view.options.map((o, i) => {
          const isRight = answered && i === view.correctIndex
          const isPicked = answered && i === view.picked && !isRight
          let bg = theme.colors.surfaceElevated
          let fg = theme.colors.text
          let border = theme.colors.border
          if (isRight) [bg, fg, border] = [theme.colors.success, theme.colors.textInverse, theme.colors.success]
          else if (isPicked) [bg, fg, border] = [theme.colors.error, theme.colors.textInverse, theme.colors.error]
          else if (answered) fg = theme.colors.textSecondary
          return (
            <Pressable
              key={i}
              disabled={answered}
              onPressIn={() => {
                haptics.selection()
                onTap(i)
              }}
              accessibilityRole="button"
              style={({ pressed }) => [
                styles.option,
                { width: optionWidth, backgroundColor: bg, borderColor: pressed && !answered ? theme.colors.primary : border },
              ]}
              {...testProps(`brain-option-${i}`)}
            >
              {isRight || isPicked ? <Feather name={isRight ? 'check' : 'x'} size={20} color={fg} /> : null}
              <Text style={{ fontSize: 22, fontWeight: '700', color: fg, flexShrink: 1 }} numberOfLines={1} adjustsFontSizeToFit>
                {o.textKey ? t(o.textKey) : o.text}
              </Text>
            </Pressable>
          )
        })}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', alignSelf: 'center' },
  corner: {
    position: 'absolute',
    top: 4,
    right: 4,
    borderRadius: 999,
    padding: 2,
  },
  choice: { alignSelf: 'center', gap: 20 },
  stimulus: {
    minHeight: 128,
    borderRadius: 16,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  // A short last row (five colours in three columns) sits centred rather than spread apart.
  options: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', columnGap: 12, rowGap: 12 },
  option: {
    minHeight: 64,
    borderRadius: 14,
    borderWidth: 2,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: 8,
  },
})
