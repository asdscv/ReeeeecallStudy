import { View, StyleSheet } from 'react-native'
import { StatCard } from '../charts/StatCard'
import { formatDuration } from '@reeeeecall/shared/lib/study-history'
import { palette } from '../../theme'
import type { OverviewStats } from '@reeeeecall/shared/lib/study-history-stats'

interface OverviewStatsRowProps {
  stats: OverviewStats
  streak: number
  testID?: string
}

/**
 * Matches web OverviewStatsCards: grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5
 * On mobile: 2 columns, 3 rows
 */
export function OverviewStatsRow({ stats, streak, testID }: OverviewStatsRowProps) {
  return (
    <View style={styles.container} testID={testID}>
      <View style={styles.row}>
        <StatCard label="Sessions" value={stats.totalSessions} testID="history-sessions" />
        <StatCard label="Cards Studied" value={stats.totalCardsStudied} valueColor={palette.blue[600]} testID="history-total-cards" />
      </View>
      <View style={styles.row}>
        <StatCard label="Total Time" value={formatDuration(stats.totalTimeMs)} valueColor="#9333EA" testID="history-total-time" />
        <StatCard label="Performance" value={`${stats.avgPerformance}%`} valueColor={palette.green[600]} testID="history-performance" />
      </View>
      <View style={styles.row}>
        <StatCard label="Streak" value={`${streak}d`} valueColor={palette.yellow[600]} testID="history-streak" />
        <StatCard
          label="Avg Duration"
          value={stats.totalSessions > 0 ? formatDuration(Math.round(stats.totalTimeMs / stats.totalSessions)) : '—'}
          valueColor="#C2410C"
          testID="history-avg-duration"
        />
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { gap: 8 },
  row: { flexDirection: 'row', gap: 8 },
})
