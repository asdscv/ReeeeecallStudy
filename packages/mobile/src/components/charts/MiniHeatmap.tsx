import { View, Text, StyleSheet, ScrollView } from 'react-native'
import { useTranslation } from 'react-i18next'
import { useTheme } from '../../theme'

interface MiniHeatmapProps {
  data: { date: string; count: number }[]
  testID?: string
}

/**
 * GitHub-style study heatmap — horizontal scroll, week columns, day rows.
 * Works with any data length (30 days, 180 days, etc).
 */
export function MiniHeatmap({ data, testID }: MiniHeatmapProps) {
  const theme = useTheme()
  const { t } = useTranslation('dashboard')

  if (data.length === 0) return null

  const sorted = [...data].sort((a, b) => a.date.localeCompare(b.date))
  const maxCount = Math.max(...sorted.map((d) => d.count), 1)

  const getColor = (count: number): string => {
    if (count === 0) return theme.isDark ? 'rgba(255,255,255,0.06)' : '#ebedf0'
    const ratio = count / maxCount
    if (ratio <= 0.25) return '#9be9a8'
    if (ratio <= 0.5) return '#40c463'
    if (ratio <= 0.75) return '#30a14e'
    return '#216e39'
  }

  // Build week-based columns (GitHub style): each column = 1 week, rows = Mon-Sun
  const firstDate = new Date(sorted[0].date + 'T00:00:00')
  const firstDow = firstDate.getDay() // 0=Sun

  // Prepend nulls so first column starts on Sunday
  const cells: ({ date: string; count: number } | null)[] = []
  for (let i = 0; i < firstDow; i++) cells.push(null)
  for (const d of sorted) cells.push(d)

  // Split into columns of 7 (each column = 1 week)
  const weeks: (typeof cells)[] = []
  for (let i = 0; i < cells.length; i += 7) {
    weeks.push(cells.slice(i, i + 7))
  }

  // Month labels
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  const monthLabels: { label: string; weekIdx: number }[] = []
  let lastMonth = -1
  weeks.forEach((week, wi) => {
    const firstCell = week.find((c) => c !== null)
    if (firstCell) {
      const m = new Date(firstCell.date + 'T00:00:00').getMonth()
      if (m !== lastMonth) {
        monthLabels.push({ label: MONTHS[m], weekIdx: wi })
        lastMonth = m
      }
    }
  })

  const CELL = 11
  const GAP = 2
  const DAY_W = 20
  const COL_W = CELL + GAP
  const DOW = ['', 'M', '', 'W', '', 'F', '']

  return (
    <View
      style={[styles.container, { backgroundColor: theme.colors.surfaceElevated, borderColor: theme.colors.border }]}
      testID={testID}
    >
      <Text style={[theme.typography.labelSmall, { color: theme.colors.textSecondary, marginBottom: 6 }]}>
        {t('heatmap.title')}
      </Text>

      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View>
          {/* Month labels */}
          <View style={{ flexDirection: 'row', height: 14, marginLeft: DAY_W }}>
            {monthLabels.map((ml, i) => (
              <Text
                key={i}
                style={[styles.monthLabel, { color: theme.colors.textTertiary, position: 'absolute', left: ml.weekIdx * COL_W }]}
              >
                {ml.label}
              </Text>
            ))}
          </View>

          {/* Grid */}
          <View style={{ flexDirection: 'row' }}>
            {/* Day-of-week labels */}
            <View style={{ width: DAY_W, gap: GAP }}>
              {DOW.map((label, i) => (
                <View key={i} style={{ height: CELL, justifyContent: 'center' }}>
                  <Text style={{ fontSize: 8, color: theme.colors.textTertiary }}>{label}</Text>
                </View>
              ))}
            </View>

            {/* Week columns */}
            <View style={{ flexDirection: 'row', gap: GAP }}>
              {weeks.map((week, wi) => (
                <View key={wi} style={{ gap: GAP }}>
                  {week.map((cell, di) => (
                    <View
                      key={di}
                      style={{
                        width: CELL,
                        height: CELL,
                        borderRadius: 2,
                        backgroundColor: cell ? getColor(cell.count) : 'transparent',
                      }}
                    />
                  ))}
                  {week.length < 7 &&
                    Array.from({ length: 7 - week.length }).map((_, i) => (
                      <View key={`p${i}`} style={{ width: CELL, height: CELL }} />
                    ))}
                </View>
              ))}
            </View>
          </View>
        </View>
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { borderRadius: 12, borderWidth: 1, padding: 14 },
  monthLabel: { fontSize: 9 },
})
