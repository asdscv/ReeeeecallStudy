import { useState } from 'react'
import { View, Text, FlatList, TouchableOpacity, RefreshControl, StyleSheet } from 'react-native'
import { useNavigation } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { Screen, ListCard, Badge } from '../components/ui'
import { StatCard, TimePeriodSelector, MiniHeatmap, BarChart } from '../components/charts'
import { useDashboardData } from '../hooks/useDashboardData'
import { useTheme, palette } from '../theme'
import type { MainTabParamList } from '../navigation/types'
import type { TimePeriod } from '@reeeeecall/shared/lib/time-period'
import { shouldShowHeatmap } from '@reeeeecall/shared/lib/time-period'

type Nav = NativeStackNavigationProp<MainTabParamList>

/**
 * Matches web DashboardPage exactly:
 * - Header: title + TimePeriodTabs
 * - StatsSummaryCards (2x2 grid)
 * - StudyHeatmap (conditional)
 * - ForecastWidget + DailyStudyChart (stacked on mobile)
 * - RecentDecks
 */
export function DashboardScreen() {
  const theme = useTheme()
  const navigation = useNavigation<Nav>()
  const [period, setPeriod] = useState<TimePeriod>('1m')
  const { decks, stats, totalCards, totalDue, streak, mastery, heatmap, dailyCounts, forecastData, loading, refresh } =
    useDashboardData(period)

  return (
    <Screen safeArea padding={false} testID="dashboard-screen">
      <FlatList
        data={decks}
        keyExtractor={(item) => item.id}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={refresh} />}
        contentContainerStyle={styles.list}
        ListHeaderComponent={
          <View style={styles.header}>
            {/* Header — matches web: title + TimePeriodTabs side by side */}
            <View style={styles.titleRow}>
              <Text style={[theme.typography.h2, { color: theme.colors.text }]}>Dashboard</Text>
              <TimePeriodSelector value={period} onChange={setPeriod} testID="dashboard-period" />
            </View>

            {/* StatsSummaryCards — matches web: 2x2 grid with label on top, big value */}
            <View style={styles.statsGrid}>
              <View style={styles.statsRow}>
                <StatCard label="Total Cards" value={totalCards} valueColor={theme.colors.text} testID="dashboard-stat-total" />
                <StatCard label="Due Today" value={totalDue} valueColor={palette.yellow[600]} testID="dashboard-stat-due" />
              </View>
              <View style={styles.statsRow}>
                <StatCard label="Streak" value={`${streak}d`} valueColor={palette.green[600]} testID="dashboard-stat-streak" />
                <StatCard label="Mastery" value={`${mastery}%`} valueColor={palette.blue[600]} testID="dashboard-stat-mastery" />
              </View>
            </View>

            {/* Heatmap — matches web: conditional on period */}
            {shouldShowHeatmap(period) && heatmap.length > 0 && (
              <MiniHeatmap data={heatmap} testID="dashboard-heatmap" />
            )}

            {/* ForecastWidget — amber bars */}
            {forecastData.length > 0 && forecastData.some((d) => d.count > 0) && (
              <BarChart data={forecastData} title="Forecast" barColor="#f59e0b" maxBars={7} testID="dashboard-forecast" />
            )}

            {/* DailyStudyChart — blue bars */}
            {dailyCounts.length > 0 && (
              <BarChart data={dailyCounts} title="Daily Study" testID="dashboard-barchart" />
            )}

            {/* Recent Decks header — matches web RecentDecks */}
            <Text style={[theme.typography.labelSmall, { color: theme.colors.textSecondary }]}>
              Recent Decks
            </Text>
          </View>
        }
        renderItem={({ item }) => {
          const deckStats = stats.find((s) => s.deck_id === item.id)
          const total = deckStats?.total_cards ?? 0
          const newCards = deckStats?.new_cards ?? 0
          const review = (deckStats?.review_cards ?? 0) + (deckStats?.learning_cards ?? 0)

          return (
            <TouchableOpacity
              onPress={() => navigation.navigate('DecksTab')}
              activeOpacity={0.7}
              style={[styles.deckCard, { backgroundColor: theme.colors.surfaceElevated, borderColor: theme.colors.border }]}
              testID={`dashboard-deck-${item.id}`}
            >
              {/* Matches web RecentDecks: icon + name + card count */}
              <View style={styles.deckTopRow}>
                <View style={styles.deckNameRow}>
                  <Text style={styles.deckEmoji}>{item.icon}</Text>
                  <View style={styles.deckNameCol}>
                    <Text style={[theme.typography.label, { color: theme.colors.text }]} numberOfLines={1}>{item.name}</Text>
                    <Text style={[theme.typography.caption, { color: theme.colors.textTertiary }]}>{total} cards</Text>
                  </View>
                </View>
              </View>
              {/* Badges + Study button row */}
              <View style={styles.deckBottomRow}>
                <View style={styles.deckBadges}>
                  {newCards > 0 && (
                    <View style={[styles.badge, { backgroundColor: palette.blue[50] }]}>
                      <Text style={[styles.badgeText, { color: palette.blue[700] }]}>{newCards} new</Text>
                    </View>
                  )}
                  {review > 0 && (
                    <View style={[styles.badge, { backgroundColor: '#FFFBEB' }]}>
                      <Text style={[styles.badgeText, { color: palette.yellow[600] }]}>{review} due</Text>
                    </View>
                  )}
                </View>
                <TouchableOpacity
                  onPress={() => navigation.navigate('StudyTab')}
                  style={[styles.studyBtn, { backgroundColor: theme.colors.primary }]}
                >
                  <Text style={[theme.typography.caption, { color: theme.colors.primaryText, fontWeight: '500' }]}>Study</Text>
                </TouchableOpacity>
              </View>
            </TouchableOpacity>
          )
        }}
        ListEmptyComponent={
          !loading ? (
            <View style={[styles.emptyCard, { backgroundColor: theme.colors.surfaceElevated, borderColor: theme.colors.border }]}>
              <Text style={styles.emptyEmoji}>📚</Text>
              <Text style={[theme.typography.body, { color: theme.colors.textSecondary, textAlign: 'center' }]}>
                No decks yet. Go to Decks tab to create one!
              </Text>
            </View>
          ) : null
        }
      />
    </Screen>
  )
}

const styles = StyleSheet.create({
  list: { paddingHorizontal: 16, paddingBottom: 24 },
  header: { gap: 16, paddingTop: 16, paddingBottom: 12 },
  titleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  statsGrid: { gap: 8 },
  statsRow: { flexDirection: 'row', gap: 8 },
  // Recent deck cards — matches web: rounded-xl border p-3
  deckCard: { borderRadius: 12, borderWidth: 1, padding: 12, marginBottom: 10 },
  deckTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  deckNameRow: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  deckEmoji: { fontSize: 24 },
  deckNameCol: { flex: 1, gap: 1 },
  deckBottomRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  deckBadges: { flexDirection: 'row', gap: 6, flex: 1 },
  badge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 12 },
  badgeText: { fontSize: 11, fontWeight: '500' },
  studyBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8 },
  emptyCard: { borderRadius: 12, borderWidth: 1, padding: 32, alignItems: 'center', gap: 12 },
  emptyEmoji: { fontSize: 40 },
})
