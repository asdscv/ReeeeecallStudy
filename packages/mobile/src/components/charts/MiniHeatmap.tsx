import { View, Text, StyleSheet } from 'react-native'
import { useTheme } from '../../theme'

interface MiniHeatmapProps {
  data: { date: string; count: number }[]
  testID?: string
}

/**
 * Matches web StudyHeatmap — color-coded activity grid.
 * Rows = 7 columns (weeks). Green scale based on intensity.
 */
export function MiniHeatmap({ data, testID }: MiniHeatmapProps) {
  const theme = useTheme()

  if (data.length === 0) return null

  const maxCount = Math.max(...data.map((d) => d.count), 1)

  // Group into rows of 7
  const rows: { date: string; count: number }[][] = []
  for (let i = 0; i < data.length; i += 7) {
    rows.push(data.slice(i, i + 7))
  }

  const getColor = (count: number): string => {
    if (count === 0) return theme.isDark ? 'rgba(255,255,255,0.06)' : '#ebedf0'
    const ratio = count / maxCount
    if (ratio <= 0.25) return '#9be9a8'
    if (ratio <= 0.5) return '#40c463'
    if (ratio <= 0.75) return '#30a14e'
    return '#216e39'
  }

  return (
    <View
      style={[styles.container, { backgroundColor: theme.colors.surfaceElevated, borderColor: theme.colors.border }]}
      testID={testID}
    >
      <Text style={[theme.typography.labelSmall, { color: theme.colors.textSecondary, marginBottom: 8 }]}>
        Activity
      </Text>
      <View style={styles.grid}>
        {rows.map((row, ri) => (
          <View key={ri} style={styles.row}>
            {row.map((cell) => (
              <View
                key={cell.date}
                style={[styles.cell, { backgroundColor: getColor(cell.count) }]}
              />
            ))}
            {row.length < 7 &&
              Array.from({ length: 7 - row.length }).map((_, i) => (
                <View key={`pad-${i}`} style={[styles.cell, { backgroundColor: 'transparent' }]} />
              ))}
          </View>
        ))}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { borderRadius: 12, borderWidth: 1, padding: 14 },
  grid: { gap: 3 },
  row: { flexDirection: 'row', gap: 3 },
  cell: { flex: 1, aspectRatio: 1, borderRadius: 2, minHeight: 12, maxHeight: 18 },
})
