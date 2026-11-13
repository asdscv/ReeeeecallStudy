import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { View, Text, Pressable, StyleSheet, type GestureResponderEvent, type View as RNView, type ViewStyle } from 'react-native'
import Animated, {
  Easing,
  ReduceMotion,
  runOnJS,
  useAnimatedStyle,
  useFrameCallback,
  useSharedValue,
  withTiming,
  type FrameInfo,
} from 'react-native-reanimated'
import { Feather } from '@expo/vector-icons'
import { useTranslation } from 'react-i18next'
import {
  FIELD_RINGS,
  QE_FIELD_TINT,
  QE_INK,
  QE_REVEAL_ART,
  QE_WARM,
  QUICK_EYE_BOX_RADIUS,
  quickEyeBox,
  quickEyeGeometry,
  quickEyeInkFraction,
  quickEyeMaskCells,
  quickEyeMaskMean,
  quickEyeMaskTones,
  randomSeed,
  type GameTheme,
  type QuickEyeView,
} from '@reeeeecall/shared/lib/brain-games'
import { testProps } from '../../utils/testProps'
import { useMotion, type Motion } from './motion'
import { FX } from './brain-ui'
import { CenterShape, Star, Triangle } from './QeShapes'

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
 * The measuring frame follows the protocol (quick-eye-art.ts): a mid-grey field in the stage
 * group's tint, one light ink for every shape, a centre box of the field's tone with a 2dp ink
 * border, and a backward mask on the field only whose mean luminance matches the stimulus frame it
 * covers — so the flash cannot survive as an afterimage of a brightness jump. A ready ring closes
 * onto the box during the first 350ms of the fixation and holds; it is still 150ms before onset.
 *
 * After the answer a separate reveal layer fades in (the stimulus layer is never animated): the
 * star in the group's colour, circled, the triangles where they were, the right answers warm. A
 * tap anywhere on the field then goes on (`onSkipReveal` — the engine takes it from 500ms).
 * The star's direction can be answered with the arrows or by tapping its side of the field.
 *
 * In `demo` mode (the how-to-play player) the flash is drawn still for the frame that holds it, no
 * frame is counted and no exposure is ever reported.
 */
const DIR_ARROWS = ['↑', '↗', '→', '↘', '↓', '↙', '←', '↖']
const DIR_BUTTON = 56
/** Frames kept for the refresh-rate estimate (≈ a quarter second at 60Hz). */
const FRAME_WINDOW = 15
const MASK_CELLS = 18
const FIELD_RADIUS = 24
/** The ready ring closes onto the box over this, at the fixation's start; the flash comes 150ms after. */
const READY_MS = 350
const REVEAL_FADE_MS = 250
/** Taps within this of the box's edge, or this far past the outer ring, choose no direction. */
const BOX_MARGIN = 8
const OUTER_MARGIN = 28
const LABEL_W = 136
const LABEL_H = 24

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
  onSkipReveal,
  width,
  height,
  demo,
  paused,
  registerTarget,
}: {
  view: QuickEyeView
  onTap: (index: number) => void
  onExposure: (actualMs: number, frameMs: number) => void
  /** A tap on the field during the reveal: on with the next trial (the engine ignores it for 500ms). */
  onSkipReveal?: () => void
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
  const tint = QE_FIELD_TINT[view.place]

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

  // ── The ready ring ──────────────────────────────────────────────────────────
  // From the fixation's start as it runs (a new trial, or again after a pause or a card — the engine
  // restarts the fixation in full): 1.4× to the box's size, fading in to 0.6, then still. Under
  // reduce motion it is simply there. It ends 150ms before onset: nothing animates at the flash.
  const ready = useSharedValue(demo ? 1 : 0)
  useEffect(() => {
    if (demo || paused || view.phase !== 'fixation') return
    ready.value = 0
    ready.value = withTiming(1, { duration: READY_MS, easing: Easing.out(Easing.cubic), reduceMotion: ReduceMotion.System })
    // `ready` is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view.phase, paused])
  const readyStyle = useAnimatedStyle(() => ({ opacity: 0.6 * ready.value, transform: [{ scale: 1.4 - 0.4 * ready.value }] }))

  // ── What is drawn before onset ──────────────────────────────────────────────
  // Both layers are built once per trial (the view's stimulus does not change within one), so a
  // render at onset re-creates none of their views. The mask's pattern is this trial's own.
  const [seed] = useState(randomSeed)
  const placeOf = useCallback(
    (ring: number, slot: number) => {
      const angle = (slot / view.ringSlots[ring]) * 2 * Math.PI
      const r = geo.radii[Math.min(ring, FIELD_RINGS - 1)]
      return { x: half + r * Math.sin(angle), y: half - r * Math.cos(angle) }
    },
    [geo, half, view.ringSlots],
  )

  const stimulus = useMemo(
    () => (
      <>
        <View style={[styles.center, { width: boxW, height: boxH, left: half - boxW / 2, top: half - boxH / 2 }]}>
          {view.center.map((id, i) => (
            <CenterShape key={i} id={id} size={shape} color={QE_INK} />
          ))}
        </View>
        {view.distractors.map((d, i) => {
          const p = placeOf(d.ring, d.slot)
          return <Triangle key={i} x={p.x} y={p.y} size={geo.stim} color={QE_INK} />
        })}
        {view.target ? <Star {...placeOf(view.target.ring, view.target.slot)} size={geo.stim} color={QE_INK} /> : null}
      </>
    ),
    [view.center, view.distractors, view.target, placeOf, geo.stim, boxW, boxH, shape, half],
  )

  // The mask: the stimulus frame's mean tone under 18×18 rounded cells of six tones around it
  // (Michelson 0.40, in equal shares, shuffled) — random, no stripes or checks.
  const mask = useMemo(() => {
    const fieldArea = field * field - (4 - Math.PI) * FIELD_RADIUS * FIELD_RADIUS
    const ink = quickEyeInkFraction(view, { stim: geo.stim, boxW, boxH, shape }, fieldArea)
    const cell = field / MASK_CELLS
    return {
      mean: quickEyeMaskMean(ink, tint),
      cells: quickEyeMaskCells(seed, MASK_CELLS, quickEyeMaskTones(ink, tint)).map((c, i) => (
        <View key={i} style={{ position: 'absolute', left: c.x * cell, top: c.y * cell, width: cell, height: cell, borderRadius: cell * 0.3, backgroundColor: c.tone }} />
      )),
    }
    // `view` is read only for its stimulus, which these references pin.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view.center, view.distractors, view.target, field, geo.stim, boxW, boxH, shape, tint, seed])

  const rings = useMemo(
    () =>
      geo.radii.map((r, i) => <View key={`ring${i}`} pointerEvents="none" style={[styles.ring, { width: r * 2, height: r * 2, borderRadius: r, left: half - r, top: half - r }]} />),
    [geo.radii, half],
  )

  // ── Answers ─────────────────────────────────────────────────────────────────
  const done = view.phase === 'done'
  const measuring = view.phase === 'fixation' || view.phase === 'stimulus' || view.phase === 'mask'
  // A voided trial reaches 'done' without an answer; there is nothing to mark or reveal.
  const answered = done && view.pickedCenter !== undefined && !view.void
  const showCenterOptions = view.phase === 'answerCenter' || answered
  // From the centre question on, the arrows are there — dim and off until it is their turn.
  const showDirections = view.asksLocation && (view.phase === 'answerCenter' || view.phase === 'answerLocation' || answered)
  // Big enough to hit (≥72pt), small enough to sit inside the ring of direction buttons.
  const option = Math.round(Math.min(Math.max(demo ? 44 : 72, field * 0.27), 112, geo.R - (demo ? 26 : 42)))
  const dirSize = demo ? 34 : DIR_BUTTON
  const missedPlace = answered && view.correctDirection !== undefined && view.pickedDirection !== view.correctDirection

  // The whole field answers "which way" (the side tapped, the box and the corners excepted), and
  // during the reveal a tap anywhere on it goes on.
  const fieldTaps = !demo && (view.phase === 'answerLocation' || done)
  const onFieldPress = (e: GestureResponderEvent) => {
    if (done) {
      onSkipReveal?.()
      return
    }
    const dx = e.nativeEvent.locationX - half
    const dy = e.nativeEvent.locationY - half
    const dist = Math.hypot(dx, dy)
    if (dist < Math.max(boxW, boxH) / 2 + BOX_MARGIN || dist > geo.R + OUTER_MARGIN) return
    onTap(((Math.round(Math.atan2(dx, -dy) / (Math.PI / 4)) % 8) + 8) % 8)
  }

  const art = QE_REVEAL_ART[view.place]
  const target = view.target ? placeOf(view.target.ring, view.target.slot) : null

  return (
    <View style={[styles.field, { width: field, height: field, backgroundColor: tint }]} {...(demo ? {} : testProps('brain-qe-field', true))}>
      {/* Faint ring guides: where things can appear, without hinting where they will. */}
      {rings}

      {/* The centre box, there whenever the answers are not: it is where the eyes rest. */}
      {!showCenterOptions ? <View style={[styles.box, { width: boxW, height: boxH, left: half - boxW / 2, top: half - boxH / 2 }]} /> : null}
      {measuring ? (
        <Animated.View
          pointerEvents="none"
          style={[styles.box, { width: boxW, height: boxH, left: half - boxW / 2, top: half - boxH / 2 }, readyStyle]}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        />
      ) : null}

      {/* Stimulus layer — drawn during fixation, shown only by the frame callback. */}
      <Animated.View style={[StyleSheet.absoluteFill, stimStyle]} pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        {stimulus}
      </Animated.View>

      {/* Mask layer — also pre-drawn; the frame that hides the stimulus shows it. */}
      <Animated.View
        style={[StyleSheet.absoluteFill, styles.mask, { backgroundColor: mask.mean }, maskStyle]}
        pointerEvents="none"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        {mask.cells}
      </Animated.View>

      {/* The reveal, under the answers: the triangles where they flashed. */}
      {answered && view.distractors.length > 0 ? (
        <Reveal>
          {view.distractors.map((d, i) => {
            const p = placeOf(d.ring, d.slot)
            return <Triangle key={i} x={p.x} y={p.y} size={geo.stim} color={art.triangle ?? QE_INK} />
          })}
        </Reveal>
      ) : null}

      {fieldTaps ? (
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={onFieldPress}
          // The arrows carry the answer for screen readers; this is the finger's shortcut.
          accessible={false}
          importantForAccessibility="no"
          testID="brain-qe-sector"
        />
      ) : null}

      {/* What was in the centre: two large answers, drawn as the shapes themselves. */}
      {showCenterOptions ? (
        <View style={[styles.centerOptions, { top: half - option / 2, width: field, gap: demo ? 8 : 12 }]} pointerEvents="box-none">
          {view.centerOptions.map((opt, i) => {
            const isShape = opt !== 'same' && opt !== 'different'
            const label = isShape ? t(opt === 'circle' ? 'quickEye.circle' : 'quickEye.square') : t(`quickEye.${opt}`)
            const right = answered && i === view.correctCenter
            const picked = answered && i === view.pickedCenter && !right
            return (
              <AnswerButton
                key={i}
                index={i}
                size={option}
                round={false}
                state={right ? 'right' : picked ? 'picked' : answered ? 'dim' : 'open'}
                disabled={view.phase !== 'answerCenter' || !!demo}
                demo={demo}
                label={label}
                onTap={onTap}
                registerTarget={registerTarget}
                // A plain testID: on Android `testProps` would replace the spoken label with the id.
                testID={demo ? undefined : `brain-qe-center-${i}`}
              >
                {isShape ? (
                  <CenterShape id={opt} size={Math.round(option * 0.55)} color={QE_INK} />
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
            const picked = answered && d === view.pickedDirection && !right
            return (
              <AnswerButton
                key={d}
                index={d}
                size={dirSize}
                round
                position={{ left: x - dirSize / 2, top: y - dirSize / 2 }}
                state={
                  view.phase === 'answerCenter' ? 'preview' : right ? 'right' : picked ? (view.nearMiss ? 'near' : 'picked') : answered ? 'dim' : 'open'
                }
                disabled={view.phase !== 'answerLocation' || !!demo}
                demo={demo}
                label={t(`quickEye.dir.${d}`)}
                onTap={onTap}
                // Only while asked: the dim previews share indices 0-1 with the centre answers.
                registerTarget={view.phase === 'answerLocation' ? registerTarget : undefined}
                testID={demo ? undefined : `brain-qe-dir-${d}`}
              >
                <Text style={[styles.arrow, demo && styles.arrowDemo]} allowFontScaling={false}>
                  {arrow}
                </Text>
              </AnswerButton>
            )
          })
        : null}

      {/* The reveal, over the answers: the star in its colour, circled — "it was here" if missed. */}
      {answered && target ? (
        <Reveal>
          <RevealStar x={target.x} y={target.y} size={geo.stim} color={art.star ?? QE_WARM} pop={!missedPlace} />
          {missedPlace ? <WasHere x={target.x} y={target.y} stim={geo.stim} field={field} text={t('quickEye.wasHere')} /> : null}
        </Reveal>
      ) : null}
    </View>
  )
}

/**
 * The answer's reveal layer: mounted only once the trial is answered (never during the measured
 * frames, never on a voided trial), fading in over 250ms — at once under reduce motion.
 */
function Reveal({ children }: { children: React.ReactNode }) {
  const o = useSharedValue(0)
  useEffect(() => {
    o.value = withTiming(1, { duration: REVEAL_FADE_MS, reduceMotion: ReduceMotion.System })
    // Once per reveal; `o` is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const style = useAnimatedStyle(() => ({ opacity: o.value }))
  return (
    <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, style]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {children}
    </Animated.View>
  )
}

/** The star where it flashed, in the stage group's colour, inside a warm circle; it pops when it was found. */
function RevealStar({ x, y, size, color, pop }: { x: number; y: number; size: number; color: string; pop: boolean }) {
  const anim = useMotion(pop ? 'pop' : null, pop)
  const ring = size + 14
  return (
    <Animated.View pointerEvents="none" style={[styles.revealRing, { width: ring, height: ring, borderRadius: ring / 2, left: x - ring / 2, top: y - ring / 2 }, anim]}>
      <Star x={ring / 2 - 2.5} y={ring / 2 - 2.5} size={size} color={color} />
    </Animated.View>
  )
}

/** "It was here" under the circled star — above it when the star sits low — kept inside the field. */
function WasHere({ x, y, stim, field, text }: { x: number; y: number; stim: number; field: number; text: string }) {
  const below = y + stim / 2 + 10
  const top = below + LABEL_H > field - 4 ? y - stim / 2 - 10 - LABEL_H : below
  const left = Math.max(4, Math.min(field - LABEL_W - 4, x - LABEL_W / 2))
  return (
    <View pointerEvents="none" style={[styles.wasHere, { left, top }]}>
      <Text style={styles.wasHereText} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7} maxFontSizeMultiplier={1.2}>
        {text}
      </Text>
    </View>
  )
}

/**
 * One answer on the field — a centre answer (rounded square) or a direction (circle). Dark glass
 * on the grey field while open; afterwards the right one glows warm with a tick and pops, a wrong
 * pick keeps a dashed outline (amber when it was right next to the star), the rest dim. No red and
 * no cross: a miss at a flash this short is the game working, not a mistake to flag.
 */
type AnswerState = 'open' | 'preview' | 'right' | 'picked' | 'near' | 'dim'

const OPEN: ViewStyle = { backgroundColor: 'rgba(28,26,23,0.30)', borderColor: 'rgba(243,240,232,0.6)' }
const LOOK: Record<AnswerState, ViewStyle> = {
  open: OPEN,
  preview: OPEN,
  right: { backgroundColor: 'rgba(242,196,107,0.22)', borderColor: QE_WARM, boxShadow: `0 0 18px ${QE_WARM}` },
  picked: { ...OPEN, borderColor: QE_INK, borderStyle: 'dashed' },
  near: { ...OPEN, borderColor: FX.amber },
  dim: OPEN,
}
/** On the button itself: the motion's style sets the inner view's opacity. */
const FADE: Record<AnswerState, number> = { open: 1, preview: 0.4, right: 1, picked: 0.8, near: 0.9, dim: 0.35 }

function AnswerButton({
  index,
  size,
  round,
  position,
  state,
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
  state: AnswerState
  disabled: boolean
  demo?: boolean
  label: string
  onTap: (index: number) => void
  registerTarget?: (index: number, node: RNView | null) => void
  testID?: string
  children: React.ReactNode
}) {
  // The arrows are already there (dim) during the centre question: they light up, they do not rise in.
  const motion: Motion = state === 'right' ? 'pop' : state === 'open' && !round ? 'rise' : null
  const anim = useMotion(motion, state)
  const right = state === 'right'
  const strong = right || state === 'near'
  return (
    <Pressable
      ref={registerTarget ? (node) => registerTarget(index, node) : undefined}
      disabled={disabled}
      // An answer that is not being asked takes no touch: on the reveal a tap reaches the field.
      pointerEvents={disabled ? 'none' : 'auto'}
      onPress={() => onTap(index)}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled, checked: right ? true : undefined }}
      style={({ pressed }) => [
        round ? { position: 'absolute', width: size, height: size, ...position } : { width: size, height: size },
        { opacity: FADE[state] },
        pressed && !disabled && { transform: [{ scale: 0.92 }] },
      ]}
      testID={testID}
    >
      <Animated.View
        style={[
          round ? styles.dir : styles.option,
          { width: size, height: size, borderRadius: round ? size / 2 : demo ? 12 : 18, borderWidth: strong ? (round ? 2.5 : 3) : 2 },
          LOOK[state],
          anim,
        ]}
      >
        {children}
        {right ? <Badge small={demo} /> : null}
      </Animated.View>
    </Pressable>
  )
}

/** ✓ on the right answer — the mark, not only the warm colour, tells it apart. */
function Badge({ small }: { small?: boolean }) {
  const s = small ? 16 : 24
  return (
    <View style={[styles.badge, { width: s, height: s, borderRadius: s / 2, top: -s / 4, right: -s / 4 }]}>
      <Feather name="check" size={small ? 10 : 14} color={FRAME} />
    </View>
  )
}

/** The dark ink of the reveal's pills and the badge's tick. */
const FRAME = '#1C1A17'

const styles = StyleSheet.create({
  field: { alignSelf: 'center', borderRadius: FIELD_RADIUS },
  ring: { position: 'absolute', borderWidth: 1, borderStyle: 'dashed', borderColor: QE_INK, opacity: 0.12 },
  box: { position: 'absolute', borderRadius: QUICK_EYE_BOX_RADIUS, borderWidth: 2, borderColor: QE_INK },
  center: { position: 'absolute', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12 },
  // The mask covers the field and nothing else: clipped to its rounded corners.
  mask: { borderRadius: FIELD_RADIUS, overflow: 'hidden' },
  centerOptions: { position: 'absolute', left: 0, flexDirection: 'row', justifyContent: 'center' },
  option: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  optionText: { color: QE_INK, fontSize: 20, fontWeight: '700' },
  dir: { alignItems: 'center', justifyContent: 'center' },
  arrow: { color: QE_INK, fontSize: 26, fontWeight: '700', lineHeight: 30 },
  arrowDemo: { fontSize: 16, lineHeight: 19 },
  badge: { position: 'absolute', backgroundColor: QE_WARM, borderWidth: 2, borderColor: FRAME, alignItems: 'center', justifyContent: 'center' },
  revealRing: { position: 'absolute', borderWidth: 2.5, borderColor: QE_WARM, boxShadow: `0 0 12px ${QE_WARM}` },
  wasHere: {
    position: 'absolute',
    width: LABEL_W,
    height: LABEL_H,
    borderRadius: LABEL_H / 2,
    backgroundColor: 'rgba(28,26,23,0.78)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  wasHereText: { color: QE_INK, fontSize: 13, fontWeight: '700' },
})
