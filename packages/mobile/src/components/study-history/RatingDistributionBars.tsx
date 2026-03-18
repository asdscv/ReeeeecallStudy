import { View, Text, StyleSheet } from 'react-native'
import { useTheme } from '../../theme'
import type { RatingDistribution } from '@reeeeecall/shared/lib/study-history-stats'

const RATING_COLORS: Record<string, string> = {
  again: '#EF4444',
  hard: '#F97316',
  good: '#22C55E',
  easy: '#3B82F6',
  unknown: '#EF4444',
  known: '#22C55E',
  missed: '#EF4444',
  got_it: '#22C55E',
}

interface RatingDistributionBarsProps {
  data: RatingDistribution[]
  testID?: string
}

/**
 * Matches web RatingDistributionChart — horizontal bars per rating.
 * Wrapped in card (bg-white rounded-xl border p-4).
 */
export function RatingDistributionBars({ data, testID }: RatingDistributionBarsProps) {
  const theme = useTheme()

  if (data.length === 0) return null

  const maxCount = Math.max(...data.map((d) => d.count), 1)

  return (
    <View
      style={[styles.container, { backgroundColor: theme.colors.surfaceElevated, borderColor: theme.colors.border }]}
      testID={testID}
    >
      <Text style={[theme.typography.labelSmall, { color: theme.colors.textSecondary, marginBottom: 10 }]}>
        Rating Distribution
      </Text>
      <View style={styles.bars}>
        {data.map((item) => (
          <View key={item.rating} style={styles.row}>
            <Text style={[styles.label, theme.typography.caption, { color: theme.colors.text }]}>
              {item.rating}
            </Text>
            <View style={[styles.track, { backgroundColor: theme.isDark ? 'rgba(255,255,255,0.06)' : '#F3F4F6' }]}>
              <View
                style={[
                  styles.bar,
                  {
                    width: `${(item.count / maxCount) * 100}%`,
                    backgroundColor: RATING_COLORS[item.rating] ?? theme.colors.primary,
                  },
                ]}
              />
            </View>
            <Text style={[styles.count, theme.typography.caption, { color: theme.colors.textSecondary }]}>
              {item.count}
            </Text>
          </View>
        ))}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { borderRadius: 12, borderWidth: 1, padding: 14 },
  bars: { gap: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  label: { width: 56, textTransform: 'capitalize' },
  track: { flex: 1, height: 10, borderRadius: 5, overflow: 'hidden' },
  bar: { height: '100%', borderRadius: 5, minWidth: 4 },
  count: { width: 32, textAlign: 'right' },
})
