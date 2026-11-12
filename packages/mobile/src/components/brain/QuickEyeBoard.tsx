import { useCallback, useEffect, useMemo, useRef } from 'react'
import { View, Text, Pressable, StyleSheet, type View as RNView } from 'react-native'
import Animated, { runOnJS, useAnimatedStyle, useFrameCallback, useSharedValue, type FrameInfo } from 'react-native-reanimated'
import { Feather } from '@expo/vector-icons'
import { useTranslation } from 'react-i18next'
import {
  CANVAS_TONES,
  FIELD_RINGS,
  QUICK_EYE_BOX_RADIUS,
  quickEyeBox,
  quickEyeGeometry,
  type GameTheme,
  type QuickEyeView,
} from '@reeeeecall/shared/lib/brain-games'
import { testProps } from '../../utils/testProps'
import { useMotion, type Motion } from './motion'

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
 *
 * Drawn on the game's dark canvas: white shapes, faint ring guides, glass answer buttons. In `demo`
 * mode (the how-to-play player) the flash is drawn still for the frame that holds it, no frame is
 * counted and no exposure is ever reported.
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
  theme,
  demo,
  paused,
  registerTarget,
}: {
  view: QuickEyeView
  onTap: (index: number) => void
  onExposure: (actualMs: number, frameMs: number) => void
  width: number
  height: number
  theme: GameTheme
  /** The how-to-play board: the flash is drawn still, nothing is timed, nothing takes input. */
  demo?: boolean
  /** The round is paused: the frame callback stops until play resumes. */
  paused?: boolean
  /** Demo only: each answer button's view, by the index a tap on it sends. */
  registerTarget?: (index: number, node: RNView | null) => void
}) {
  const { t } = useTranslation('brain')
  const field = demo ? Math.floor(Math.min(width, height)) : Math.floor(Math.min(width, 520, Math.max(280, height)))
  const half = field / 2
  // 112pt square; 160pt wide for the two side-by-side shapes of same/different, but no taller —
  // a 160pt square's corners would push the inner ring out until a phone's stars shrank to ~13pt.
  // Only a field narrower than a phone shrinks the box.
  const { boxW, boxH, shape } = quickEyeBox(field, view.center.length === 2)
  const geo = useMemo(() => quickEyeGeometry(field, boxW, boxH, view.ringSlots), [field, boxW, boxH, view.ringSlots])
  // White shapes on the dark canvas, in a faintly lit box: far above 4.5:1 on every game's canvas.
  const ink = '#FFFFFF'
  const boxBg = 'rgba(255,255,255,0.08)'

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
  // Running from mount: the 500ms fixation fills the frame window before onset. (Never in a demo.)
  const frame = useFrameCallback(onFrame, !demo)
  frameRef.current = frame

  useEffect(() => {
    if (demo) {
      // The demo shows each phase as a still: the flash on its frame, then the mask.
      stimOpacity.value = view.phase === 'stimulus' ? 1 : 0
      maskOpacity.value = view.phase === 'mask' ? 1 : 0
      return
    }
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

  // While paused nothing is timed, so no frame needs counting. The engine never pauses mid-flash;
  // a pause in fixation resumes into fixation, whose frames refill the window before onset.
  const wasPaused = useRef(false)
  useEffect(() => {
    if (demo) return
    if (paused) frame.setActive(false)
    else if (wasPaused.current && (view.phase === 'fixation' || view.phase === 'stimulus')) frame.setActive(true)
    wasPaused.current = !!paused
    // Only a change of `paused` toggles it; phase changes are the effect above's.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paused])

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
  const option = Math.round(Math.min(Math.max(demo ? 44 : 72, field * 0.27), 112, geo.R - (demo ? 26 : 42)))
  const dirSize = demo ? 34 : DIR_BUTTON

  return (
    <View style={[styles.field, { width: field, height: field }]} {...(demo ? {} : testProps('brain-qe-field', true))}>
      {/* Faint ring guides: where things can appear, without hinting where they will. */}
      {geo.radii.map((r, i) => (
        <View key={`ring${i}`} pointerEvents="none" style={[styles.ring, { width: r * 2, height: r * 2, borderRadius: r, left: half - r, top: half - r }]} />
      ))}

      {/* The centre box, there whenever the answers are not: it is where the eyes rest. */}
      {!showCenterOptions ? (
        <View
          style={[
            styles.box,
            { width: boxW, height: boxH, left: half - boxW / 2, top: half - boxH / 2, backgroundColor: boxBg },
            view.phase === 'fixation' && !demo ? { boxShadow: `0 0 22px ${theme.glow}` } : null,
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
        <View style={[styles.centerOptions, { top: half - option / 2, width: field, gap: demo ? 8 : 12 }]}>
          {view.centerOptions.map((opt, i) => {
            const isShape = opt !== 'same' && opt !== 'different'
            const label = isShape ? t(opt === 'circle' ? 'quickEye.circle' : 'quickEye.square') : t(`quickEye.${opt}`)
            const right = answered && i === view.correctCenter
            const wrong = answered && i === view.pickedCenter && !right
            return (
              <AnswerButton
                key={i}
                index={i}
                size={option}
                round={false}
                state={right ? 'right' : wrong ? 'wrong' : answered ? 'dim' : 'open'}
                accent={theme.accent}
                disabled={view.phase !== 'answerCenter' || !!demo}
                demo={demo}
                label={label}
                onTap={onTap}
                registerTarget={registerTarget}
                // A plain testID: on Android `testProps` would replace the spoken label with the id.
                testID={demo ? undefined : `brain-qe-center-${i}`}
              >
                {isShape ? (
                  <Shape id={opt} size={Math.round(option * 0.55)} color={ink} />
                ) : (
                  <Text style={[styles.optionText, demo && { fontSize: 13 }]} numberOfLines={1} adjustsFontSizeToFit maxFontSizeMultiplier={1.3}>
                    {label}
                  </Text>
                )}
              </AnswerButton>
            )
          })}
        </View>
      ) : null}

      {/* Where was the star: eight big targets around the field, at the outer ring. */}
      {showDirections
        ? DIR_ARROWS.map((arrow, d) => {
            const angle = (d / 8) * 2 * Math.PI
            const r = geo.R - (demo ? 2 : 4)
            const x = half + r * Math.sin(angle)
            const y = half - r * Math.cos(angle)
            const right = answered && d === view.correctDirection
            const wrong = answered && d === view.pickedDirection && !right
            return (
              <AnswerButton
                key={d}
                index={d}
                size={dirSize}
                round
                position={{ left: x - dirSize / 2, top: y - dirSize / 2 }}
                state={right ? 'right' : wrong ? 'wrong' : answered ? 'dim' : 'open'}
                accent={theme.accent}
                disabled={view.phase !== 'answerLocation' || !!demo}
                demo={demo}
                label={t(`quickEye.dir.${d}`)}
                onTap={onTap}
                registerTarget={registerTarget}
                testID={demo ? undefined : `brain-qe-dir-${d}`}
              >
                <Text style={[styles.arrow, demo && styles.arrowDemo]} allowFontScaling={false}>
                  {arrow}
                </Text>
              </AnswerButton>
            )
          })
        : null}
    </View>
  )
}

/**
 * One answer on the field — a centre answer (rounded square) or a direction (circle). Glass while
 * open; afterwards the right one turns green with a tick and pops, a wrong pick red with a cross
 * and shakes, the rest dim — the marks, not only the colours, tell them apart.
 */
function AnswerButton({
  index,
  size,
  round,
  position,
  state,
  accent,
  disabled,
  demo,
  label,
  onTap,
  registerTarget,
  testID,
  children,
}: {
  index: number
  size: number
  round: boolean
  position?: { left: number; top: number }
  state: 'open' | 'right' | 'wrong' | 'dim'
  accent: string
  disabled: boolean
  demo?: boolean
  label: string
  onTap: (index: number) => void
  registerTarget?: (index: number, node: RNView | null) => void
  testID?: string
  children: React.ReactNode
}) {
  const motion: Motion = state === 'right' ? 'pop' : state === 'wrong' ? 'shake' : state === 'open' ? 'rise' : null
  const anim = useMotion(motion, state)
  const right = state === 'right'
  const wrong = state === 'wrong'
  const look = round
    ? right
      ? { backgroundColor: CANVAS_TONES.correct, borderColor: CANVAS_TONES.correct }
      : wrong
        ? { backgroundColor: CANVAS_TONES.wrong, borderColor: CANVAS_TONES.wrong }
        : state === 'dim'
          ? { backgroundColor: CANVAS_TONES.tile, borderColor: CANVAS_TONES.tileBorder, opacity: 0.45 }
          : { backgroundColor: CANVAS_TONES.tile, borderColor: accent }
    : right
      ? { backgroundColor: 'rgba(34,197,94,0.25)', borderColor: CANVAS_TONES.correct, boxShadow: '0 0 24px rgba(34,197,94,0.45)' }
      : wrong
        ? { backgroundColor: 'rgba(239,68,68,0.25)', borderColor: CANVAS_TONES.wrong }
        : { backgroundColor: CANVAS_TONES.tile, borderColor: CANVAS_TONES.tileBorder }
  return (
    <Pressable
      ref={registerTarget ? (node) => registerTarget(index, node) : undefined}
      disabled={disabled}
      onPress={() => onTap(index)}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled, checked: right ? true : undefined }}
      style={({ pressed }) => [
        round ? { position: 'absolute', width: size, height: size, ...position } : { width: size, height: size },
        pressed && !disabled && { transform: [{ scale: 0.92 }] },
      ]}
      testID={testID}
    >
      <Animated.View
        style={[
          round ? styles.dir : styles.option,
          { width: size, height: size, borderRadius: round ? size / 2 : demo ? 12 : 18, borderWidth: right || wrong ? (round ? 2 : 3) : 2 },
          look,
          anim,
        ]}
      >
        {children}
        {right || wrong ? <Badge right={right} small={demo} /> : null}
      </Animated.View>
    </Pressable>
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
function Badge({ right, small }: { right: boolean; small?: boolean }) {
  const s = small ? 16 : 24
  return (
    <View style={[styles.badge, { width: s, height: s, borderRadius: s / 2, top: -s / 4, right: -s / 4, backgroundColor: right ? CANVAS_TONES.correct : CANVAS_TONES.wrong }]}>
      <Feather name={right ? 'check' : 'x'} size={small ? 10 : 14} color="#FFFFFF" />
    </View>
  )
}

const styles = StyleSheet.create({
  field: { alignSelf: 'center', borderRadius: 24, backgroundColor: 'rgba(255,255,255,0.04)' },
  ring: { position: 'absolute', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' },
  box: { position: 'absolute', borderRadius: QUICK_EYE_BOX_RADIUS, borderWidth: 2, borderColor: 'rgba(255,255,255,0.75)' },
  center: { position: 'absolute', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12 },
  mask: { borderRadius: 16, overflow: 'hidden' },
  centerOptions: { position: 'absolute', left: 0, flexDirection: 'row', justifyContent: 'center' },
  option: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  optionText: { color: '#FFFFFF', fontSize: 20, fontWeight: '700' },
  dir: { alignItems: 'center', justifyContent: 'center' },
  arrow: { color: '#FFFFFF', fontSize: 26, fontWeight: '700', lineHeight: 30 },
  arrowDemo: { fontSize: 16, lineHeight: 19 },
  badge: { position: 'absolute', borderWidth: 2, borderColor: 'rgba(15,23,42,0.9)', alignItems: 'center', justifyContent: 'center' },
})
