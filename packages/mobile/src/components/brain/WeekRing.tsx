import { useEffect } from 'react'
import { View, Text, StyleSheet } from 'react-native'
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated'
import { formatCount } from '@reeeeecall/shared/lib/format-number'

/**
 * Sessions this week out of the goal, as a ring that fills — the one progress figure the research
 * ties to outcomes (completed sessions), so it gets the hero spot instead of a streak.
 *
 * No SVG module is bundled, so the arc is the classic two-halves trick: a ring whose top and right
 * borders are coloured is a half ring; each half of the box shows one, rotated so the coloured part
 * enters its half as the fraction grows.
 */
export function WeekRing({
  done,
  goal,
  size = 96,
  label,
  color = '#FFFFFF',
  track = 'rgba(255,255,255,0.18)',
  testID,
}: {
  done: number
  goal: number
  size?: number
  label: string
  color?: string
  track?: string
  testID?: string
}) {
  const reduced = useReducedMotion()
  const target = Math.min(1, goal > 0 ? done / goal : 0)
  const k = useSharedValue(reduced ? target : 0)
  useEffect(() => {
    k.value = reduced ? target : withTiming(target, { duration: 1100, easing: Easing.bezier(0.2, 0.8, 0.2, 1) })
    // `k` is a stable shared value.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, reduced])

  const stroke = Math.max(6, Math.round(size * 0.1))
  const half = size / 2
  // Clockwise from 12 o'clock: the right half shows 0..180°, the left half 180..360°.
  const rightArc = useAnimatedStyle(() => ({ transform: [{ rotate: `${45 + Math.min(k.value * 360, 180) - 180}deg` }] }))
  const leftArc = useAnimatedStyle(() => ({ transform: [{ rotate: `${45 + Math.max(k.value * 360, 180) - 180}deg` }] }))
  const ring = { width: size, height: size, borderRadius: half, borderWidth: stroke }
  const arc = [
    ring,
    styles.abs,
    { borderTopColor: color, borderRightColor: color, borderBottomColor: 'transparent', borderLeftColor: 'transparent' },
  ]

  return (
    <View style={{ width: size, height: size }} accessible accessibilityRole="image" accessibilityLabel={label} testID={testID}>
      <View style={[ring, styles.abs, { borderColor: track }]} />
      <View style={[styles.abs, { left: half, top: 0, width: half, height: size, overflow: 'hidden' }]}>
        <Animated.View style={[arc, { left: -half, top: 0 }, rightArc]} />
      </View>
      <View style={[styles.abs, { left: 0, top: 0, width: half, height: size, overflow: 'hidden' }]}>
        <Animated.View style={[arc, { left: 0, top: 0 }, leftArc]} />
      </View>
      <View style={[StyleSheet.absoluteFill, styles.center]}>
        <Text style={[styles.value, { fontSize: size * 0.3 }]} allowFontScaling={false}>
          {formatCount(done)}
          <Text style={[styles.goal, { fontSize: size * 0.18 }]}>/{formatCount(goal)}</Text>
        </Text>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  abs: { position: 'absolute' },
  center: { alignItems: 'center', justifyContent: 'center' },
  value: { color: '#FFFFFF', fontWeight: '900', fontVariant: ['tabular-nums'] },
  goal: { color: 'rgba(255,255,255,0.6)', fontWeight: '800' },
})
