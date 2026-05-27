import { useEffect } from 'react'
import { View, StyleSheet, type ViewStyle, type DimensionValue } from 'react-native'
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
} from 'react-native-reanimated'
import { useTheme } from '../../theme'

/**
 * Skeleton — content-shaped loading placeholders (Reanimated opacity pulse).
 *
 * Replaces blank screens on cold load so data swaps in without the list
 * popping into existence. Color is token-driven (theme.colors.border) so it
 * adapts to light/dark. Compose <Skeleton> blocks for new shapes.
 */
interface SkeletonProps {
  width?: DimensionValue
  height?: number
  radius?: number
  style?: ViewStyle
}

export function Skeleton({ width = '100%', height = 16, radius = 8, style }: SkeletonProps) {
  const theme = useTheme()
  const opacity = useSharedValue(0.4)

  useEffect(() => {
    opacity.value = withRepeat(withTiming(0.9, { duration: 800 }), -1, true)
  }, [opacity])

  const animatedStyle = useAnimatedStyle(() => ({ opacity: opacity.value }))

  return (
    <Animated.View
      style={[
        { width, height, borderRadius: radius, backgroundColor: theme.colors.border },
        animatedStyle,
        style,
      ]}
    />
  )
}

/** A single ListCard-shaped placeholder row. */
function CardSkeleton() {
  const theme = useTheme()
  return (
    <View
      style={[
        styles.card,
        { backgroundColor: theme.colors.surfaceElevated, borderColor: theme.colors.border },
      ]}
    >
      <Skeleton width="60%" height={18} />
      <Skeleton width="90%" height={12} style={{ marginTop: 10 }} />
      <View style={styles.chipRow}>
        <Skeleton width={56} height={22} radius={11} />
        <Skeleton width={56} height={22} radius={11} />
      </View>
    </View>
  )
}

/** Vertical list of card-shaped rows — decks / marketplace / detail lists. */
export function ListSkeleton({ count = 5 }: { count?: number }) {
  return (
    <View style={styles.list} accessibilityLabel="Loading" accessibilityRole="progressbar">
      {Array.from({ length: count }).map((_, i) => (
        <CardSkeleton key={i} />
      ))}
    </View>
  )
}

/** Dashboard — 2×2 stat cards + a wide panel. */
export function StatGridSkeleton() {
  const theme = useTheme()
  const cell = {
    backgroundColor: theme.colors.surfaceElevated,
    borderColor: theme.colors.border,
  }
  return (
    <View style={styles.dash} accessibilityLabel="Loading" accessibilityRole="progressbar">
      <View style={styles.grid}>
        {Array.from({ length: 4 }).map((_, i) => (
          <View key={i} style={[styles.statCard, cell]}>
            <Skeleton width="50%" height={12} />
            <Skeleton width="70%" height={26} style={{ marginTop: 12 }} />
          </View>
        ))}
      </View>
      <View style={[styles.panel, cell]}>
        <Skeleton width="40%" height={14} />
        <Skeleton width="100%" height={120} style={{ marginTop: 14 }} radius={12} />
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  list: { padding: 16, gap: 12 },
  card: { borderRadius: 12, borderWidth: 1, padding: 16 },
  chipRow: { flexDirection: 'row', gap: 8, marginTop: 14 },
  dash: { padding: 16, gap: 16 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  statCard: { flexGrow: 1, flexBasis: '46%', borderRadius: 12, borderWidth: 1, padding: 16 },
  panel: { borderRadius: 12, borderWidth: 1, padding: 16 },
})
