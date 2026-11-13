import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { View, Pressable, StyleSheet, type View as RNView } from 'react-native'
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated'
import { Feather } from '@expo/vector-icons'
import { useTranslation } from 'react-i18next'
import { GAME_THEMES, buildDemo, maxColsFor, type BrainGameId } from '@reeeeecall/shared/lib/brain-games'
import { BrainBoard } from './BrainBoard'
import { useMotion } from './motion'
import { FX } from './brain-ui'

const noop = () => {}
const BOARD_MAX_H = 240
const GLIDE = Easing.bezier(0.3, 0.7, 0.2, 1)

/**
 * How to play, shown rather than told: the real engine plays an easy round on the real board, and
 * a fingertip makes each tap. It loops until the player starts; under reduce motion it holds each
 * frame longer and the fingertip jumps instead of gliding.
 *
 * Quick Eye demonstrates the player's own stage (`variant`; a new player's is the first one with
 * the star, the task the round really opens with).
 */
export function DemoPlayer({ gameId, width, centerOnly = false, variant }: { gameId: BrainGameId; width: number; centerOnly?: boolean; variant?: number }) {
  const { t } = useTranslation('brain')
  const reduced = useReducedMotion()
  const theme = GAME_THEMES[gameId]
  const boardWidth = Math.max(200, Math.min(width - 32, 300))
  // A player on Quick Eye's "centre only" setting sees the centre-only task demonstrated.
  const frames = useMemo(
    () => buildDemo(gameId, { maxCols: Math.min(4, maxColsFor(boardWidth)), centerOnly, ...(variant !== undefined ? { variant } : {}) }),
    [gameId, boardWidth, centerOnly, variant],
  )
  const [i, setI] = useState(0)
  const [run, setRun] = useState(0)
  // The frames differ in height (Quick Eye's answers replace its box, a choice's options appear):
  // hold the tallest seen so far, so the page under the demo never jumps.
  const [minH, setMinH] = useState(gameId === 'quickEye' ? Math.min(BOARD_MAX_H, boardWidth) : 160)
  const frame = frames[Math.min(i, frames.length - 1)]

  useEffect(() => {
    if (!frame) return
    const hold = frame.holdMs * (reduced ? 1.4 : 1)
    // The last frame (the result) holds a little longer before the loop starts over.
    const t = setTimeout(() => setI((k) => (k + 1 >= frames.length ? 0 : k + 1)), i === frames.length - 1 ? hold + 900 : hold)
    return () => clearTimeout(t)
  }, [i, frame, frames.length, reduced, run])

  // ── The fingertip ─────────────────────────────────────────────────────────
  const box = useRef<RNView>(null)
  const targets = useRef(new Map<number, RNView>())
  const registerTarget = useCallback((index: number, node: RNView | null) => {
    if (node) targets.current.set(index, node)
    else targets.current.delete(index)
  }, [])
  const x = useSharedValue(0)
  const y = useSharedValue(0)
  const press = useSharedValue(0)
  const [shown, setShown] = useState(false)
  const placed = useRef(false)

  useEffect(() => {
    if (!frame || frame.tap === undefined) return
    const tap = frame.tap
    let pressTimer: ReturnType<typeof setTimeout> | undefined
    // After this frame's layout: find the target, glide there, press just before the frame changes.
    const raf = requestAnimationFrame(() => {
      const node = targets.current.get(tap)
      const root = box.current
      if (!node || !root) return
      node.measureLayout(
        root,
        (left, top, w, h) => {
          const tx = left + w / 2
          const ty = top + h / 2
          const jump = reduced || !placed.current
          x.value = jump ? tx : withTiming(tx, { duration: 320, easing: GLIDE })
          y.value = jump ? ty : withTiming(ty, { duration: 320, easing: GLIDE })
          press.value = 0
          placed.current = true
          setShown(true)
        },
        noop,
      )
      pressTimer = setTimeout(() => {
        press.value = reduced ? 1 : withTiming(1, { duration: 120 })
      }, frame.holdMs * 0.65)
    })
    return () => {
      cancelAnimationFrame(raf)
      if (pressTimer) clearTimeout(pressTimer)
    }
    // Shared values are stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frame, reduced])

  const fingertip = useAnimatedStyle(() => ({
    transform: [{ translateX: x.value - TIP / 2 }, { translateY: y.value - TIP / 2 }, { scale: 1 - press.value * 0.18 }],
  }))
  const dot = useAnimatedStyle(() => ({ opacity: 0.55 + press.value * 0.45 }))
  const promptIn = useMotion('rise', frame?.view.prompt.key)

  if (!frame) return null
  const pointing = shown && frame.tap !== undefined
  return (
    <View style={styles.card}>
      <View
        ref={box}
        style={[styles.stage, { minHeight: minH }]}
        pointerEvents="none"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        onLayout={(e) => {
          const h = Math.ceil(e.nativeEvent.layout.height)
          setMinH((m) => (h > m ? h : m))
        }}
      >
        <BrainBoard
          view={frame.view}
          onTap={noop}
          onExposure={noop}
          width={boardWidth}
          height={Math.min(BOARD_MAX_H, boardWidth)}
          theme={theme}
          demo
          registerTarget={registerTarget}
        />
        {pointing ? (
          <Animated.View style={[styles.tip, fingertip]}>
            <Animated.View style={[styles.tipDot, dot]} />
          </Animated.View>
        ) : null}
      </View>
      <View style={styles.footer}>
        {/* What the board is asking at this step, as the game would say it. */}
        <Animated.Text style={[styles.prompt, promptIn]} numberOfLines={2} maxFontSizeMultiplier={1.3} accessibilityElementsHidden importantForAccessibility="no">
          {t(frame.view.prompt.key, frame.view.prompt.params)}
        </Animated.Text>
        <Pressable
          onPress={() => {
            setI(0)
            setRun((n) => n + 1)
          }}
          style={({ pressed }) => [styles.replay, pressed && { backgroundColor: 'rgba(255,255,255,0.2)' }]}
          accessibilityRole="button"
          accessibilityLabel={t('intro.replay')}
          testID="brain-demo-replay"
        >
          <Feather name="rotate-ccw" size={20} color="#FFFFFF" />
        </Pressable>
      </View>
    </View>
  )
}

const TIP = 44

const styles = StyleSheet.create({
  card: { borderRadius: 24, backgroundColor: 'rgba(255,255,255,0.06)', borderWidth: 1, borderColor: FX.glassBorder, padding: 16, paddingBottom: 10 },
  footer: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10 },
  stage: { alignItems: 'center', justifyContent: 'center' },
  tip: {
    position: 'absolute',
    left: 0,
    top: 0,
    width: TIP,
    height: TIP,
    borderRadius: TIP / 2,
    borderWidth: 3,
    borderColor: 'rgba(255,255,255,0.95)',
    backgroundColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
  },
  tipDot: { width: 18, height: 18, borderRadius: 9, backgroundColor: '#FFFFFF' },
  // Centred over the board: the replay button's width is mirrored on the left.
  prompt: { flex: 1, marginLeft: 56, color: 'rgba(255,255,255,0.9)', fontSize: 16, fontWeight: '600', textAlign: 'center' },
  replay: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(255,255,255,0.10)',
    alignItems: 'center',
    justifyContent: 'center',
  },
})
