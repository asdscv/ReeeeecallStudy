import { createContext, useContext, useEffect } from 'react'
import {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated'

/** Short extreme exposures start fully visible; decorative entrances would hide the task. */
export const BrainInstantMotion = createContext(false)


/**
 * The web's game motions (index.css `bfx-*`), on Reanimated so they run on the UI thread:
 *
 *   pop     240ms  0.88 → 1.08 → 1      a right answer, a badge landing
 *   shake   320ms  ±7px, settling       a wrong tap
 *   flip    200ms  rotateY 90° → 0      a card turning face up
 *   lit     220ms  0.9 → 1.05 → 1       a tile lighting to be remembered
 *   pulse   900ms  opacity 1 ↔ 0.45     the cell that should have been tapped (loops)
 *   rise    260ms  14px up, fading in   text that changes (prompt, result), a board's new row
 *   fade    120ms  opacity 0 → 1        a search board coming up all at once
 *   breathe 1400ms opacity 1 ↔ 0.45     Number Pattern's gap tile — slower than 1Hz (loops)
 *   turnX   250ms  rotateX 90° → 0      Color Word's cue strip flipping to the other rule
 *
 * Under the system's reduce-motion setting nothing moves: the element simply shows its end state.
 */
export type Motion = 'pop' | 'shake' | 'flip' | 'lit' | 'pulse' | 'rise' | 'fade' | 'breathe' | 'turnX' | null

const OUT = Easing.out(Easing.cubic)

/** Plays `motion` whenever `trigger` changes (and on mount). */
export function useMotion(motion: Motion, trigger: unknown, delayMs = 0) {
  const systemReduced = useReducedMotion()
  const reduced = useContext(BrainInstantMotion) || systemReduced
  const scale = useSharedValue(1)
  const tx = useSharedValue(0)
  const ty = useSharedValue(0)
  const rot = useSharedValue(0)
  // Entrances start hidden (or turned away), so their first frame never shows the end state.
  const rotX = useSharedValue(motion === 'turnX' && !reduced ? 90 : 0)
  const opacity = useSharedValue((motion === 'rise' || motion === 'fade') && !reduced ? 0 : 1)

  useEffect(() => {
    cancelAnimation(scale)
    cancelAnimation(tx)
    cancelAnimation(ty)
    cancelAnimation(rot)
    cancelAnimation(rotX)
    cancelAnimation(opacity)
    scale.value = 1
    tx.value = 0
    ty.value = 0
    rot.value = 0
    rotX.value = 0
    opacity.value = 1
    if (reduced || !motion) return
    const later = (a: number) => (delayMs > 0 ? withDelay(delayMs, a) : a)
    switch (motion) {
      case 'pop':
        scale.value = 0.88
        scale.value = later(withSequence(withTiming(1.08, { duration: 132, easing: OUT }), withTiming(1, { duration: 108 })))
        break
      case 'lit':
        scale.value = 0.9
        scale.value = withSequence(withTiming(1.05, { duration: 132, easing: OUT }), withTiming(1, { duration: 88 }))
        break
      case 'shake':
        tx.value = withSequence(
          withTiming(-7, { duration: 64 }),
          withTiming(6, { duration: 64 }),
          withTiming(-4, { duration: 64 }),
          withTiming(3, { duration: 64 }),
          withTiming(0, { duration: 64 }),
        )
        break
      case 'flip':
        rot.value = 90
        rot.value = withTiming(0, { duration: 200, easing: OUT })
        break
      case 'pulse':
        opacity.value = withRepeat(withSequence(withTiming(0.45, { duration: 450 }), withTiming(1, { duration: 450 })), -1)
        break
      case 'breathe':
        opacity.value = withRepeat(withSequence(withTiming(0.45, { duration: 700 }), withTiming(1, { duration: 700 })), -1)
        break
      case 'rise':
        ty.value = 14
        opacity.value = 0
        ty.value = withTiming(0, { duration: 260, easing: OUT })
        opacity.value = withTiming(1, { duration: 260, easing: OUT })
        break
      case 'fade':
        opacity.value = 0
        opacity.value = withTiming(1, { duration: 120, easing: OUT })
        break
      case 'turnX':
        rotX.value = 90
        rotX.value = withTiming(0, { duration: 250, easing: OUT })
        break
    }
    // Shared values are stable; the motion replays only when its trigger changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trigger, motion, reduced])

  return useAnimatedStyle(() => ({
    opacity: opacity.value,
    // Perspective only while a flip is turning: on Android a 3D transform changes how the view is
    // rasterised, which is not worth paying on every tile at rest.
    transform:
      rot.value !== 0
        ? [{ perspective: 600 }, { rotateY: `${rot.value}deg` }, { scale: scale.value }]
        : rotX.value !== 0
          ? [{ perspective: 400 }, { rotateX: `${rotX.value}deg` }]
          : [{ translateX: tx.value }, { translateY: ty.value }, { scale: scale.value }],
  }))
}

/**
 * A memorise countdown: a bar's scaleX running 1 → 0 over `ms` (restart it by remounting). A pause
 * holds it where it is and the rest runs on resume; under reduce motion it stays full (static).
 * Give the bar `transformOrigin: 'left'`.
 */
export function useDrain(ms: number, paused: boolean) {
  const reduced = useReducedMotion()
  const p = useSharedValue(1)
  useEffect(() => {
    if (reduced) {
      cancelAnimation(p)
      p.value = 1
      return
    }
    if (paused) {
      cancelAnimation(p)
      return
    }
    p.value = withTiming(0, { duration: Math.max(0, ms * p.value), easing: Easing.linear })
    // `p` is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ms, paused, reduced])
  return useAnimatedStyle(() => ({ transform: [{ scaleX: Math.max(0.0001, p.value) }] }))
}
