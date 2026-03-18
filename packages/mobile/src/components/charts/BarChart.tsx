import { View, Text, StyleSheet } from 'react-native'
import { useTheme } from '../../theme'

interface BarChartProps {
  data: { date: string; count: number }[]
  title?: string
  barColor?: string
  maxBars?: number
  height?: number
  testID?: string
}

/**
 * Matches web DailyStudyChart / ForecastWidget — View-based bar chart.
 * Wrapped in white card with border (same as web).
 */
export function BarChart({ data, title, barColor, maxBars = 14, height = 120, testID }: BarChartProps) {
  const theme = useTheme()

  const displayData = data.slice(-maxBars)
  if (displayData.length === 0) return null

  const maxCount = Math.max(...displayData.map((d) => d.count), 1)
  const totalCount = displayData.reduce((s, d) => s + d.count, 0)
  const fillColor = barColor ?? theme.colors.primary

  const formatLabel = (dateStr: string): string => {
    const parts = dateStr.split('-')
    return `${parseInt(parts[1])}/${parseInt(parts[2])}`
  }

  const labelInterval = displayData.length > 10 ? 3 : displayData.length > 7 ? 2 : 1

  return (
    <View
      style={[styles.container, { backgroundColor: theme.colors.surfaceElevated, borderColor: theme.colors.border }]}
      testID={testID}
    >
      <View style={styles.headerRow}>
        <Text style={[theme.typography.labelSmall, { color: theme.colors.textSecondary }]}>
          {title ?? 'Daily Study'}
        </Text>
        <Text style={[theme.typography.caption, { color: theme.colors.textTertiary }]}>
          {totalCount} total
        </Text>
      </View>
      <View style={[styles.chartArea, { height }]}>
        {displayData.map((item, idx) => {
          const barH = maxCount > 0 ? (item.count / maxCount) * (height - 20) : 0
          return (
            <View key={item.date} style={styles.barCol}>
              <View style={styles.barWrapper}>
                <View
                  style={[
                    styles.bar,
                    {
                      height: Math.max(barH, item.count > 0 ? 4 : 0),
                      backgroundColor: item.count > 0 ? fillColor : 'transparent',
                    },
                  ]}
                />
              </View>
              {idx % labelInterval === 0 ? (
                <Text style={[styles.label, { color: theme.colors.textTertiary }]} numberOfLines={1}>
                  {formatLabel(item.date)}
                </Text>
              ) : (
                <Text style={styles.label}> </Text>
              )}
            </View>
          )
        })}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { borderRadius: 12, borderWidth: 1, padding: 14 },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  chartArea: { flexDirection: 'row', alignItems: 'flex-end', gap: 2 },
  barCol: { flex: 1, alignItems: 'center' },
  barWrapper: { flex: 1, justifyContent: 'flex-end', width: '100%' },
  bar: { width: '100%', borderRadius: 2, minWidth: 4 },
  label: { fontSize: 8, marginTop: 2, textAlign: 'center' },
})
