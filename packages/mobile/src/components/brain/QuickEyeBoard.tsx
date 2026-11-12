import { useCallback, useEffect, useMemo, useRef } from 'react'
import { View, Text, Pressable, StyleSheet } from 'react-native'
import Animated, { runOnJS, useAnimatedStyle, useFrameCallback, useSharedValue, type FrameInfo } from 'react-native-reanimated'
import { Feather } from '@expo/vector-icons'
import { useTranslation } from 'react-i18next'
import { FIELD_RINGS, QUICK_EYE_BOX_RADIUS, quickEyeBox, quickEyeGeometry, type QuickEyeView } from '@reeeeecall/shared/lib/brain-games'
import { useTheme } from '../../theme'
import { haptics } from '../../utils/haptics'
import { testProps } from '../../utils/testProps'

/**
 * Quick Eye on the phone.
 *
 * The exposure is counted in display frames on the UI thread (a Reanimated frame callback) and
 * applied by flipping a pre-drawn layer's opacity — never by a React render, whose timing is the
 * JS thread's, and never with setTimeout, which on React Native drifts by tens of milliseconds.
 * Everything that appears at stimulus onset is laid out during fixation, so nothing is measured
 * or decoded at that moment. What was really on screen (from the frame timestamps) goes back to
 * the engine, which voids the trial if a frame was dropped.
 *
 * RoundView remounts this board for every trial, so each trial starts with fresh shared values,
 * a fresh mask and a fresh frame window.
 */
const DIR_ARROWS = ['↑', '↗', '→', '↘', '↓', '↙', '←', '↖']
const DIR_BUTTON = 56
/** Frames kept for the refresh-rate estimate (≈ a quarter second at 60Hz). */
const FRAME_WINDOW = 15
const MASK_CELLS = 18

export function Shape({ id, size, color }: { id: string; size: number; color: string }) {
  // 'circle', or 'square:<corner radius %>' — the closer the radius is to 50%, the closer to a circle.
  const radius = id === 'circle' ? size / 2 : (Number(id.split(':')[1] ?? 0) / 100) * size
  return <View style={{ width: size, height: size, borderRadius: radius, backgroundColor: color }} />
}

function median(xs: number[], fallback: number): number {
  'worklet'
  if (xs.length === 0) return fallback
  const sorted = xs.slice().sort((a, b) => a - b)
  return sorted[sorted.length >> 1]
}

export function QuickEyeBoard({
  view,
  onTap,
  onExposure,
  width,
  height,
}: {
  view: QuickEyeView
  onTap: (index: number) => void
  onExposure: (actualMs: number, frameMs: number) => void
  width: number
  height: number
}) {
  const theme = useTheme()
  const { t } = useTranslation('brain')
  const field = Math.floor(Math.min(width, 520, Math.max(280, height)))
  const half = field / 2
  // 112pt square; 160pt wide for the two side-by-side shapes of same/different, but no taller —
  // a 160pt square's corners would push the inner ring out until a phone's stars shrank to ~13pt.
  // Only a field narrower than a phone shrinks the box.
  const { boxW, boxH, shape } = quickEyeBox(field, view.center.length === 2)
  const geo = useMemo(() => quickEyeGeometry(field, boxW, boxH, view.ringSlots), [field, boxW, boxH, view.ringSlots])
  const ink = theme.colors.text
  // Mid grey with the shapes in the theme's text colour: ≥4.5:1 in both themes.
  const boxBg = theme.isDark ? '#6B7280' : '#9CA3AF'

  // ── The exposure ────────────────────────────────────────────────────────────
  const stimOpacity = useSharedValue(0)
  const maskOpacity = useSharedValue(0)
  const armed = useSharedValue(false)
  const shownAt = useSharedValue(-1)
  const deltas = useSharedValue<number[]>([])
  const targetMs = useSharedValue(view.exposureMs)
  const report = useRef(onExposure)
  report.current = onExposure
  const frameRef = useRef<{ setActive: (on: boolean) => void } | null>(null)

  // Back on the JS thread once the stimulus is gone: stop counting frames, tell the engine.
  const finish = useCallback((actualMs: number, frameMs: number) => {
    frameRef.current?.setActive(false)
    report.current(actualMs, frameMs)
  }, [])

  // Memoised so the frame callback is registered once — a re-registration mid-exposure restarts
  // Reanimated's frame loop.
  const onFrame = useCallback(
    (info: FrameInfo) => {
      'worklet'
      const dt = info.timeSincePreviousFrame
      // The refresh interval, from recent frames. Only plausible intervals count: a stall is not
      // the display's rate, and the median ignores the odd dropped frame.
      if (dt !== null && dt > 2 && dt < 50) {
        const w = deltas.value.length >= FRAME_WINDOW ? deltas.value.slice(1) : deltas.value.slice()
        w.push(dt)
        deltas.value = w
      }
      if (!armed.value) return
      const frameMs = median(deltas.value, 1000 / 60)
      if (shownAt.value < 0) {
        // Onset: the stimulus is committed with this frame.
        stimOpacity.value = 1
        shownAt.value = info.timestamp
        return
      }
      const elapsed = info.timestamp - shownAt.value
      // Count frames exactly as the engine will when it checks the report (round(ms / frame)):
      // a "half a frame early" threshold disagreed with that rounding at 90Hz, where 50ms is 4.5
      // frames, and voided about half of those trials.
      const wantFrames = Math.max(1, Math.round(targetMs.value / frameMs))
      if (Math.round(elapsed / frameMs) >= wantFrames) {
        stimOpacity.value = 0
        maskOpacity.value = 1
        armed.value = false
        runOnJS(finish)(elapsed, frameMs)
      }
    },
    // Shared values are stable references; `finish` is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )
  // Running from mount: the 500ms fixation fills the frame window before onset.
  const frame = useFrameCallback(onFrame, true)
  frameRef.current = frame

  useEffect(() => {
    switch (view.phase) {
      case 'stimulus':
        shownAt.value = -1
        armed.value = true
        break
      case 'fixation':
        break
      case 'mask':
        // Already set on the frame the stimulus went off; this only restates it.
        stimOpacity.value = 0
        maskOpacity.value = 1
        break
      default:
        armed.value = false
        stimOpacity.value = 0
        maskOpacity.value = 0
        frame.setActive(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view.phase])

  const stimStyle = useAnimatedStyle(() => ({ opacity: stimOpacity.value }))
  const maskStyle = useAnimatedStyle(() => ({ opacity: maskOpacity.value }))

  // The mask: random grey squares between ~40% and ~60% grey — low contrast, and no regular
  // pattern (striped or checked masks can trigger pattern sensitivity even at matched luminance).
  const mask = useMemo(() => {
    const cell = field / MASK_CELLS
    return Array.from({ length: MASK_CELLS * MASK_CELLS }, (_, i) => {
      const g = Math.round(102 + Math.random() * 51)
      return { left: (i % MASK_CELLS) * cell, top: Math.floor(i / MASK_CELLS) * cell, size: cell + 0.5, color: `rgb(${g},${g},${g})` }
    })
  }, [field])

  const place = (ring: number, slot: number) => {
    const angle = (slot / view.ringSlots[ring]) * 2 * Math.PI
    const r = geo.radii[Math.min(ring, FIELD_RINGS - 1)]
    return { x: half + r * Math.sin(angle), y: half - r * Math.cos(angle) }
  }

  const done = view.phase === 'done'
  // A voided trial reaches 'done' without an answer; there is nothing to mark.
  const answered = done && view.pickedCenter !== undefined
  const showCenterOptions = view.phase === 'answerCenter' || answered
  const showDirections = view.asksLocation && (view.phase === 'answerLocation' || answered)
  // Big enough to hit (≥72pt), small enough to sit inside the ring of direction buttons.
  const option = Math.round(Math.min(Math.max(72, field * 0.27), 112, geo.R - 42))

  return (
    <View style={[styles.field, { width: field, height: field }]} {...testProps('brain-qe-field', true)}>
      {/* The centre box, there whenever the answers are not: it is where the eyes rest. */}
      {!showCenterOptions ? (
        <View
          style={[
            styles.box,
            { width: boxW, height: boxH, left: half - boxW / 2, top: half - boxH / 2, backgroundColor: boxBg, borderColor: ink },
          ]}
        />
      ) : null}

      {/* Stimulus layer — drawn during fixation, shown only by the frame callback. */}
      <Animated.View style={[StyleSheet.absoluteFill, stimStyle]} pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <View style={[styles.center, { width: boxW, height: boxH, left: half - boxW / 2, top: half - boxH / 2 }]}>
          {view.center.map((id, i) => (
            <Shape key={i} id={id} size={shape} color={ink} />
          ))}
        </View>
        {view.distractors.map((d, i) => {
          const p = place(d.ring, d.slot)
          return <Glyph key={i} glyph="▲" x={p.x} y={p.y} size={geo.stim} color={ink} />
        })}
        {view.target ? (() => {
          const p = place(view.target.ring, view.target.slot)
          return <Glyph glyph="★" x={p.x} y={p.y} size={geo.stim} color={ink} />
        })() : null}
      </Animated.View>

      {/* Mask layer — also pre-drawn; the frame that hides the stimulus shows it. */}
      <Animated.View style={[StyleSheet.absoluteFill, styles.mask, maskStyle]} pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        {mask.map((m, i) => (
          <View key={i} style={{ position: 'absolute', left: m.left, top: m.top, width: m.size, height: m.size, backgroundColor: m.color }} />
        ))}
      </Animated.View>

      {/* What was in the centre: two large answers, drawn as the shapes themselves. */}
      {showCenterOptions ? (
        <View style={[styles.centerOptions, { top: half - option / 2, width: field }]}>
          {view.centerOptions.map((opt, i) => {
            const isShape = opt !== 'same' && opt !== 'different'
            const label = isShape ? t(opt === 'circle' ? 'quickEye.circle' : 'quickEye.square') : t(`quickEye.${opt}`)
            const right = answered && i === view.correctCenter
            const wrong = answered && i === view.pickedCenter && !right
            return (
              <Pressable
                key={i}
                disabled={view.phase !== 'answerCenter'}
                onPress={() => {
                  haptics.selection()
                  onTap(i)
                }}
                accessibilityRole="button"
                accessibilityLabel={label}
                style={({ pressed }) => [
                  styles.option,
                  {
                    width: option,
                    height: option,
                    backgroundColor: right ? theme.colors.successLight : wrong ? theme.colors.errorLight : theme.colors.surfaceElevated,
                    borderColor: right ? theme.colors.success : wrong ? theme.colors.error : pressed ? theme.colors.primary : theme.colors.border,
                    borderWidth: right || wrong ? 3 : 2,
                  },
                ]}
                // A plain testID: on Android `testProps` would replace the spoken label with the id.
                testID={`brain-qe-center-${i}`}
              >
                {isShape ? (
                  <Shape id={opt} size={Math.round(option * 0.55)} color={ink} />
                ) : (
                  <Text style={[styles.optionText, { color: ink }]} numberOfLines={1} adjustsFontSizeToFit>
                    {label}
                  </Text>
                )}
                {right || wrong ? <Badge right={right} theme={theme} /> : null}
              </Pressable>
            )
          })}
        </View>
      ) : null}

      {/* Where was the star: eight big targets around the field, at the outer ring. */}
      {showDirections
        ? DIR_ARROWS.map((arrow, d) => {
            const angle = (d / 8) * 2 * Math.PI
            const r = geo.R - 4
            const x = half + r * Math.sin(angle)
            const y = half - r * Math.cos(angle)
            const right = answered && d === view.correctDirection
            const wrong = answered && d === view.pickedDirection && !right
            const bg = right ? theme.colors.success : wrong ? theme.colors.error : theme.colors.surfaceElevated
            const fg = right || wrong ? theme.colors.textInverse : answered ? theme.colors.textSecondary : theme.colors.primary
            return (
              <Pressable
                key={d}
                disabled={view.phase !== 'answerLocation'}
                onPress={() => {
                  haptics.selection()
                  onTap(d)
                }}
                accessibilityRole="button"
                accessibilityLabel={t(`quickEye.dir.${d}`)}
                style={({ pressed }) => [
                  styles.dir,
                  {
                    left: x - DIR_BUTTON / 2,
                    top: y - DIR_BUTTON / 2,
                    backgroundColor: pressed && !answered ? theme.colors.primaryLight : bg,
                    borderColor: right ? theme.colors.success : wrong ? theme.colors.error : answered ? theme.colors.border : theme.colors.primary,
                  },
                ]}
                testID={`brain-qe-dir-${d}`}
              >
                <Text style={[styles.arrow, { color: fg }]} allowFontScaling={false}>
                  {arrow}
                </Text>
                {right || wrong ? <Badge right={right} theme={theme} /> : null}
              </Pressable>
            )
          })
        : null}
    </View>
  )
}

function Glyph({ glyph, x, y, size, color }: { glyph: string; x: number; y: number; size: number; color: string }) {
  return (
    <Text
      style={{
        position: 'absolute',
        left: x - size / 2,
        top: y - size / 2,
        width: size,
        height: size,
        fontSize: size,
        lineHeight: size,
        textAlign: 'center',
        color,
        includeFontPadding: false,
      }}
      // Geometry is fixed by the layout above; system text scaling must not move it.
      allowFontScaling={false}
    >
      {glyph}
    </Text>
  )
}

/** ✓ on the right answer, ✕ on a wrong pick — the mark does not depend on seeing green and red. */
function Badge({ right, theme }: { right: boolean; theme: ReturnType<typeof useTheme> }) {
  return (
    <View style={[styles.badge, { backgroundColor: right ? theme.colors.success : theme.colors.error, borderColor: theme.colors.surfaceElevated }]}>
      <Feather name={right ? 'check' : 'x'} size={14} color={theme.colors.textInverse} />
    </View>
  )
}

const styles = StyleSheet.create({
  field: { alignSelf: 'center' },
  box: { position: 'absolute', borderRadius: QUICK_EYE_BOX_RADIUS, borderWidth: 2 },
  center: { position: 'absolute', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12 },
  mask: { borderRadius: 16, overflow: 'hidden' },
  centerOptions: { position: 'absolute', left: 0, flexDirection: 'row', justifyContent: 'center', gap: 12 },
  option: { borderRadius: 18, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  optionText: { fontSize: 20, fontWeight: '700' },
  dir: {
    position: 'absolute',
    width: DIR_BUTTON,
    height: DIR_BUTTON,
    borderRadius: DIR_BUTTON / 2,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  arrow: { fontSize: 26, fontWeight: '700', lineHeight: 30 },
  badge: {
    position: 'absolute',
    top: -6,
    right: -6,
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
})
