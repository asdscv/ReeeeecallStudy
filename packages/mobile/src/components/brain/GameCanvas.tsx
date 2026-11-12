import { useEffect, useRef, useState, type ReactNode } from 'react'
import { View, Text, Pressable, StyleSheet, useWindowDimensions, type StyleProp, type ViewStyle } from 'react-native'
import Animated, {
  Easing,
  ReduceMotion,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import { StatusBar } from 'expo-status-bar'
import { Feather } from '@expo/vector-icons'
import { formatCount } from '@reeeeecall/shared/lib/format-number'
import type { GameTheme } from '@reeeeecall/shared/lib/brain-games'
import { haptics } from '../../utils/haptics'
import { testProps } from '../../utils/testProps'
import { countdownHaptic } from './fx-haptics'
import { useMotion } from './motion'
import { FX, type FeatherName } from './brain-ui'

/**
 * The game screen's stage — the phone's version of the web's GameCanvas: the game's deep colour,
 * a glow of its second colour from the top and two soft lights behind, white type. Dark in light
 * mode too: a game is its own place, and lit tiles read the same either way.
 *
 * No gradient or blur module is bundled (OTA-safe means no new native code), so the gradients are
 * stacks of translucent circles. The colours involved are close, so the steps do not show.
 */
export function GameCanvas({ theme, children, testID }: { theme: GameTheme; children: ReactNode; testID?: string }) {
  return (
    <View style={[styles.canvas, { backgroundColor: theme.canvasFrom }]} {...testProps(testID, true)}>
      <StatusBar style="light" />
      <CanvasBackdrop theme={theme} />
      <SafeAreaView style={styles.safe} edges={['top', 'bottom', 'left', 'right']}>
        {children}
      </SafeAreaView>
    </View>
  )
}

const TOP_GLOW = [2.2, 1.8, 1.45, 1.15, 0.85, 0.6]
const LIGHT = [0.9, 0.6, 0.34]

function CanvasBackdrop({ theme }: { theme: GameTheme }) {
  const { width: w, height: h } = useWindowDimensions()
  const big = Math.max(w, h)
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {TOP_GLOW.map((k, i) => (
        <Circle key={`t${i}`} d={k * w} x={w / 2} y={0} color={theme.canvasTo} opacity={0.28} />
      ))}
      {LIGHT.map((k, i) => (
        <Circle key={`g${i}`} d={k * big} x={w * 0.05} y={h * 0.12} color={theme.glow} opacity={0.12} />
      ))}
      {LIGHT.map((k, i) => (
        <Circle key={`c${i}`} d={k * big} x={w} y={h * 0.95} color={theme.cardFrom} opacity={0.08} />
      ))}
    </View>
  )
}

function Circle({ d, x, y, color, opacity }: { d: number; x: number; y: number; color: string; opacity: number }) {
  return <View style={{ position: 'absolute', width: d, height: d, borderRadius: d / 2, left: x - d / 2, top: y - d / 2, backgroundColor: color, opacity }} />
}

const FILL_STEPS = [1, 0.82, 0.64, 0.46, 0.28]

/**
 * A card's 135° gradient, `from` at the top left to `to` at the bottom right, with a soft white
 * light in the corner — drawn under the content of a card whose style has `overflow: 'hidden'`.
 * Pass the size when it is known (grid tiles); otherwise it measures itself.
 */
export function GradientFill({ from, to, width, height, light = 0.07 }: { from: string; to: string; width?: number; height?: number; light?: number }) {
  const [measured, setMeasured] = useState<{ w: number; h: number } | null>(null)
  const w = width ?? measured?.w
  const h = height ?? measured?.h
  const known = width !== undefined && height !== undefined
  return (
    <View
      pointerEvents="none"
      style={[StyleSheet.absoluteFill, { backgroundColor: from }]}
      onLayout={
        known
          ? undefined
          : (e) => {
              const { width: lw, height: lh } = e.nativeEvent.layout
              setMeasured((p) => (p && p.w === lw && p.h === lh ? p : { w: lw, h: lh }))
            }
      }
    >
      {w && h ? (
        <>
          {FILL_STEPS.map((k, i) => (
            <Circle key={i} d={2 * k * Math.hypot(w, h)} x={w} y={h} color={to} opacity={0.22} />
          ))}
          {light > 0 ? [1.2, 0.76].map((k, i) => <Circle key={`l${i}`} d={k * w} x={w * 0.12} y={h * 0.04} color="#FFFFFF" opacity={light} />) : null}
        </>
      ) : null}
    </View>
  )
}

/**
 * A full-screen layer over a round — paused, the stop question, "round over". It sits inside the
 * canvas's safe area and reaches past it to the screen edges, so the status bar strip dims too.
 * `opaque` hides the board completely (a paused memory game must not keep showing its tiles).
 */
export function CanvasOverlay({ children, testID, opaque, theme }: { children: ReactNode; testID: string; opaque?: boolean; theme: GameTheme }) {
  const insets = useSafeAreaInsets()
  return (
    <View
      style={[
        styles.overlay,
        { top: -insets.top, bottom: -insets.bottom, left: -insets.left, right: -insets.right, paddingTop: insets.top, paddingBottom: insets.bottom },
        { backgroundColor: opaque ? theme.canvasFrom : FX.overlay },
      ]}
      accessibilityViewIsModal
      {...testProps(testID, true)}
    >
      {opaque ? <CanvasBackdrop theme={theme} /> : null}
      {children}
    </View>
  )
}

/** The in-game confirm sheet — a title, a line, the safe choice first and big, the other below. */
export function CanvasSheet({
  theme,
  testID,
  title,
  body,
  keepLabel,
  onKeep,
  keepTestID,
  stopLabel,
  onStop,
  stopTestID,
}: {
  theme: GameTheme
  testID: string
  title: string
  body?: string
  keepLabel: string
  onKeep: () => void
  keepTestID?: string
  stopLabel: string
  onStop: () => void
  stopTestID?: string
}) {
  return (
    <CanvasOverlay testID={testID} opaque theme={theme}>
      <View style={styles.sheet}>
        <Text style={styles.sheetTitle} accessibilityRole="header" maxFontSizeMultiplier={1.4}>
          {title}
        </Text>
        {body ? (
          <Text style={styles.sheetBody} maxFontSizeMultiplier={1.4}>
            {body}
          </Text>
        ) : null}
        <CanvasButton label={keepLabel} onPress={onKeep} theme={theme} testID={keepTestID} style={styles.sheetButton} />
        <CanvasButton label={stopLabel} onPress={onStop} theme={theme} variant="glass" testID={stopTestID} style={styles.sheetButton} />
      </View>
    </CanvasOverlay>
  )
}

/**
 * The canvas's buttons. `primary` is the big white one (start, again, keep playing) in the game's
 * colour; `glass` is the quiet translucent one; `chip` is the small header button.
 */
export function CanvasButton({
  label,
  icon,
  onPress,
  theme,
  variant = 'primary',
  testID,
  style,
  accessibilityLabel,
  disabled,
}: {
  label?: string
  icon?: FeatherName
  onPress: () => void
  theme: GameTheme
  variant?: 'primary' | 'glass' | 'chip'
  testID?: string
  style?: StyleProp<ViewStyle>
  accessibilityLabel?: string
  disabled?: boolean
}) {
  const primary = variant === 'primary'
  const chip = variant === 'chip'
  const color = primary ? theme.cardTo : '#FFFFFF'
  return (
    <Pressable
      onPress={() => {
        if (primary) haptics.tap()
        onPress()
      }}
      style={({ pressed }) => [
        primary ? styles.primary : chip ? styles.chip : styles.glass,
        !label && chip ? styles.chipIconOnly : null,
        pressed && { transform: [{ scale: 0.97 }], opacity: primary ? 1 : 0.85 },
        disabled && styles.disabled,
        style,
      ]}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={disabled ? { disabled: true } : undefined}
      testID={testID}
    >
      {icon ? <Feather name={icon} size={primary ? 24 : chip ? 20 : 20} color={color} /> : null}
      {label ? (
        <Text style={[primary ? styles.primaryText : chip ? styles.chipText : styles.glassText, { color }]} numberOfLines={1} maxFontSizeMultiplier={1.3}>
          {label}
        </Text>
      ) : null}
    </Pressable>
  )
}

/** 3 · 2 · 1 · Go — a breath before the first trial, so it never starts under a moving hand. */
export function Countdown({ onDone, goLabel }: { onDone: () => void; goLabel: string }) {
  const reduced = useReducedMotion()
  const [n, setN] = useState(3)
  const done = useRef(onDone)
  useEffect(() => {
    done.current = onDone
  })
  useEffect(() => {
    countdownHaptic(n)
    const t = setTimeout(() => (n > 0 ? setN(n - 1) : done.current()), n > 0 ? (reduced ? 450 : 650) : 450)
    return () => clearTimeout(t)
  }, [n, reduced])
  const pop = useMotion('pop', n)
  return (
    <View style={styles.countdown} accessibilityLiveRegion="assertive" testID="brain-countdown">
      <Animated.Text style={[styles.count, pop]} maxFontSizeMultiplier={1.2} adjustsFontSizeToFit numberOfLines={1}>
        {n > 0 ? formatCount(n) : goLabel}
      </Animated.Text>
    </View>
  )
}

interface Piece {
  x: number
  y: number
  vx: number
  vy: number
  r: number
  rot: number
  vr: number
  c: string
}

const CONFETTI = 56
const CONFETTI_MS = 2700

function makePieces(colors: string[], w: number, h: number): Piece[] {
  return Array.from({ length: CONFETTI }, () => ({
    x: w / 2 + (Math.random() - 0.5) * w * 0.3,
    y: h * 0.35,
    vx: (Math.random() - 0.5) * 16,
    vy: -Math.random() * 15 - 6,
    r: Math.random() * 5 + 4,
    rot: Math.random() * Math.PI,
    vr: (Math.random() - 0.5) * 0.3,
    c: colors[Math.floor(Math.random() * colors.length)],
  }))
}

/**
 * A short confetti burst — for a personal best and a finished session only. The web's canvas
 * physics (gravity, drag, spin, per 60Hz frame), solved in closed form on the UI thread from one
 * clock, so 56 pieces cost one animation. Off under reduce motion.
 */
export function Confetti({ colors }: { colors: string[] }) {
  const reduced = useReducedMotion()
  const { width, height } = useWindowDimensions()
  // One burst per mount: a parent re-rendering (the score counting up) must not restart it.
  const [pieces] = useState(() => makePieces(colors, width, height))
  const clock = useSharedValue(0)
  useEffect(() => {
    if (reduced) return
    clock.value = withTiming(CONFETTI_MS, { duration: CONFETTI_MS, easing: Easing.linear, reduceMotion: ReduceMotion.Never })
    // Once, on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  if (reduced) return null
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {pieces.map((p, i) => (
        <ConfettiPiece key={i} p={p} clock={clock} />
      ))}
    </View>
  )
}

function ConfettiPiece({ p, clock }: { p: Piece; clock: SharedValue<number> }) {
  const style = useAnimatedStyle(() => {
    const f = (clock.value / 1000) * 60
    // vy += 0.38 per frame, vx *= 0.99 per frame — summed over f frames.
    const x = p.x + p.vx * ((1 - Math.pow(0.99, f)) / 0.01)
    const y = p.y + p.vy * f + 0.38 * ((f * (f + 1)) / 2)
    return {
      opacity: Math.max(0, 1 - clock.value / 2600),
      transform: [{ translateX: x - p.r }, { translateY: y - p.r / 2 }, { rotate: `${p.rot + p.vr * f}rad` }],
    }
  })
  return <Animated.View style={[styles.piece, { width: p.r * 2, height: p.r, backgroundColor: p.c }, style]} />
}

/** A number that counts up to its value — the score on the results screen. */
export function useCountUp(target: number, ms = 900): number {
  const reduced = useReducedMotion()
  const [value, setValue] = useState(0)
  useEffect(() => {
    if (reduced) return
    let id = 0
    const start = Date.now()
    const tick = () => {
      const k = Math.min(1, (Date.now() - start) / ms)
      setValue(Math.round(target * (1 - Math.pow(1 - k, 3))))
      if (k < 1) id = requestAnimationFrame(tick)
    }
    id = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(id)
  }, [target, ms, reduced])
  return reduced ? target : value
}

/** A glass tile with an icon, a label and a big number (intro, results, session end). */
export function StatTile({ icon, label, value, accent, center, testID }: { icon: FeatherName; label: string; value: string; accent?: string; center?: boolean; testID?: string }) {
  return (
    <View style={[styles.stat, center && styles.statCenter]} accessible accessibilityLabel={`${label} ${value}`} testID={testID}>
      <View style={[styles.statHead, center && styles.statHeadCenter]}>
        <Feather name={icon} size={18} color={accent ?? 'rgba(255,255,255,0.78)'} />
        <Text style={styles.statLabel} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75} maxFontSizeMultiplier={1.3}>
          {label}
        </Text>
      </View>
      <Text style={styles.statValue} numberOfLines={1} adjustsFontSizeToFit maxFontSizeMultiplier={1.2}>
        {value}
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  canvas: { flex: 1, overflow: 'hidden' },
  safe: { flex: 1 },
  overlay: { position: 'absolute', zIndex: 40, elevation: 40, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 },
  sheet: { width: '100%', maxWidth: 360, alignItems: 'center', gap: 16, paddingHorizontal: 24 },
  sheetTitle: { color: '#FFFFFF', fontSize: 26, fontWeight: '800', textAlign: 'center' },
  sheetBody: { color: 'rgba(255,255,255,0.82)', fontSize: 16, lineHeight: 23, textAlign: 'center' },
  sheetButton: { alignSelf: 'stretch' },
  primary: {
    minHeight: 64,
    borderRadius: 18,
    backgroundColor: '#FFFFFF',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingHorizontal: 20,
    boxShadow: '0 14px 40px rgba(0,0,0,0.35)',
  },
  primaryText: { fontSize: 20, fontWeight: '800', flexShrink: 1 },
  glass: {
    minHeight: 56,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.10)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 18,
  },
  glassText: { fontSize: 17, fontWeight: '600', flexShrink: 1 },
  chip: {
    minHeight: 48,
    minWidth: 48,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.10)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: 12,
  },
  chipIconOnly: { width: 48, paddingHorizontal: 0 },
  disabled: { opacity: 0.4 },
  chipText: { fontSize: 16, fontWeight: '600', flexShrink: 1 },
  countdown: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 },
  count: { color: '#FFFFFF', fontSize: 104, fontWeight: '900', fontVariant: ['tabular-nums'], textShadowColor: 'rgba(0,0,0,0.45)', textShadowOffset: { width: 0, height: 4 }, textShadowRadius: 8 },
  piece: { position: 'absolute', left: 0, top: 0, borderRadius: 1 },
  stat: { flex: 1, borderRadius: 18, backgroundColor: FX.glass, borderWidth: 1, borderColor: FX.glassBorder, paddingHorizontal: 12, paddingVertical: 12, gap: 4 },
  statCenter: { alignItems: 'center' },
  statHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  statHeadCenter: { justifyContent: 'center' },
  statLabel: { color: 'rgba(255,255,255,0.8)', fontSize: 14, flexShrink: 1 },
  statValue: { color: '#FFFFFF', fontSize: 24, fontWeight: '700', fontVariant: ['tabular-nums'] },
})
