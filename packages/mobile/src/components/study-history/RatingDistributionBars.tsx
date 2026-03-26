import { View, Text, StyleSheet } from 'react-native'
import { useTheme } from '../../theme'
import { ratingColors } from '@reeeeecall/shared/design-tokens/colors'
import type { RatingDistribution } from '@reeeeecall/shared/lib/study-history-stats'

const RATING_COLORS: Record<string, string> = {
  again: ratingColors.again,
  hard: ratingColors.hard,
  good: ratingColors.good,
  easy: ratingColors.easy,
  unknown: ratingColors.again,
  known: ratingColors.good,
  missed: ratingColors.again,
  got_it: ratingColors.good,
}

interface RatingDistributionBarsProps {
  data: RatingDistribution[]
  testID?: string
}

/**
 * Matches web RatingDistributionChart — horizontal bars per rating.
 * Color-coded bars with percentage labels.
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
        {data.map((item) => {
          const color = RATING_COLORS[item.rating] ?? theme.colors.primary
          return (
            <View key={item.rating} style={styles.row}>
              <View style={styles.labelCol}>
                <Text style={[styles.label, theme.typography.caption, { color: theme.colors.text }]}>
                  {item.rating}
                </Text>
                <Text style={[styles.percentage, { color }]}>
                  {item.percentage}%
                </Text>
              </View>
              <View style={[styles.track, { backgroundColor: theme.isDark ? 'rgba(255,255,255,0.06)' : '#F3F4F6' }]}>
                <View
                  style={[
                    styles.bar,
                    {
                      width: `${(item.count / maxCount) * 100}%`,
                      backgroundColor: color,
                    },
                  ]}
                />
              </View>
              <Text style={[styles.count, theme.typography.caption, { color: theme.colors.textSecondary }]}>
                {item.count}
              </Text>
            </View>
          )
        })}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { borderRadius: 12, borderWidth: 1, padding: 14 },
  bars: { gap: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  labelCol: { width: 72, gap: 1 },
  label: { textTransform: 'capitalize' },
  percentage: { fontSize: 11, fontWeight: '600' },
  track: { flex: 1, height: 10, borderRadius: 5, overflow: 'hidden' },
  bar: { height: '100%', borderRadius: 5, minWidth: 4 },
  count: { width: 32, textAlign: 'right' },
})
