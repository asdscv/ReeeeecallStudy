import { View, Text, Pressable, StyleSheet, useWindowDimensions } from 'react-native'
import { useTranslation } from 'react-i18next'
import type { ChoiceView, GridView, RoundView } from '@reeeeecall/shared/lib/brain-games'
import { useTheme } from '../../theme'
import { haptics } from '../../utils/haptics'
import { testProps } from '../../utils/testProps'
import { INK, toneStyle } from './brain-ui'

/** Draws whatever round the engine hands over. Two shapes cover all eight games. */
export function BrainBoard({ view, onTap }: { view: RoundView; onTap: (index: number) => void }) {
  return view.kind === 'grid' ? <Grid view={view} onTap={onTap} /> : <Choice view={view} onTap={onTap} />
}

const GAP = 8

function Grid({ view, onTap }: { view: GridView; onTap: (index: number) => void }) {
  const theme = useTheme()
  const { width, height } = useWindowDimensions()
  // Fit the width, and keep tall boards (the 4×6 matching game) above the fold.
  const maxW = Math.min(width - 32, 480)
  const maxH = height - 300
  const byWidth = (maxW - GAP * (view.cols - 1)) / view.cols
  const byHeight = (maxH - GAP * (view.rows - 1)) / view.rows
  const cell = Math.max(36, Math.floor(Math.min(byWidth, byHeight)))
  const fontSize = Math.round(cell * (view.cols <= 4 ? 0.42 : 0.38))
  const boardWidth = cell * view.cols + GAP * (view.cols - 1)

  return (
    <View style={[styles.grid, { width: boardWidth, gap: GAP }]}>
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
            style={{
              width: cell,
              height: cell,
              borderRadius: 12,
              backgroundColor: tone.bg,
              opacity: tone.opacity ?? 1,
              borderWidth: tone.border ? 2 : 0,
              borderColor: tone.border,
              alignItems: 'center',
              justifyContent: 'center',
            }}
            {...testProps(`brain-cell-${i}`)}
          >
            {c.label ? (
              <Text
                style={{
                  fontSize,
                  fontWeight: '700',
                  color: tone.fg,
                  ...(c.rotate ? { transform: [{ rotate: `${c.rotate}deg` }] } : {}),
                }}
                allowFontScaling={false}
              >
                {c.label}
              </Text>
            ) : null}
          </Pressable>
        )
      })}
    </View>
  )
}

function Choice({ view, onTap }: { view: ChoiceView; onTap: (index: number) => void }) {
  const theme = useTheme()
  const { t } = useTranslation('brain')
  const answered = view.correctIndex !== undefined
  const stimulus = view.stimulus.textKey ? t(view.stimulus.textKey) : view.stimulus.text ?? ''
  const columns = view.options.length > 4 ? 3 : 2

  return (
    <View style={styles.choice}>
      <View style={[styles.stimulus, { backgroundColor: theme.colors.surfaceElevated, borderColor: theme.colors.border }]}>
        <Text
          style={{
            fontSize: stimulus.length > 14 ? 28 : 44,
            fontWeight: '800',
            textAlign: 'center',
            color: view.stimulus.color ? INK[view.stimulus.color] : theme.colors.text,
          }}
          adjustsFontSizeToFit
          numberOfLines={2}
          {...testProps('brain-stimulus')}
        >
          {stimulus}
        </Text>
      </View>
      <View style={styles.options}>
        {view.options.map((o, i) => {
          let bg = theme.colors.surfaceElevated
          let fg = theme.colors.text
          let border = theme.colors.border
          if (answered && i === view.correctIndex) [bg, fg, border] = [theme.colors.success, '#fff', theme.colors.success]
          else if (answered && i === view.picked) [bg, fg, border] = [theme.colors.error, '#fff', theme.colors.error]
          else if (answered) fg = theme.colors.textTertiary
          return (
            <Pressable
              key={i}
              disabled={answered}
              onPressIn={() => {
                haptics.selection()
                onTap(i)
              }}
              style={[styles.option, { width: `${100 / columns - 3}%`, backgroundColor: bg, borderColor: border }]}
              {...testProps(`brain-option-${i}`)}
            >
              <Text style={{ fontSize: 20, fontWeight: '700', color: fg }} numberOfLines={1} adjustsFontSizeToFit>
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
  choice: { width: '100%', maxWidth: 440, alignSelf: 'center', gap: 20 },
  stimulus: {
    minHeight: 112,
    borderRadius: 16,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  options: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 12 },
  option: {
    height: 60,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
})
