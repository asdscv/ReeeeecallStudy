import { useState } from 'react'
import { View, Text, FlatList, TouchableOpacity, RefreshControl, StyleSheet, Platform } from 'react-native'
import { useNavigation, type NavigationProp } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { useTranslation } from 'react-i18next'
import { Screen, ListCard, Badge, DrawerHeader } from '../components/ui'
import { StatCard, TimePeriodSelector, MiniHeatmap, BarChart } from '../components/charts'
import { useDashboardData } from '../hooks/useDashboardData'
import { useTheme, palette } from '../theme'
import type { HomeStackParamList, MainTabParamList } from '../navigation/types'
import type { TimePeriod } from '@reeeeecall/shared/lib/time-period'
import { shouldShowHeatmap } from '@reeeeecall/shared/lib/time-period'

type Nav = NativeStackNavigationProp<HomeStackParamList>

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
  const { t } = useTranslation('dashboard')
  const navigation = useNavigation<Nav>()
  const tabNav = navigation.getParent<NavigationProp<MainTabParamList>>()
  const [period, setPeriod] = useState<TimePeriod>('1m')
  const { decks, stats, totalCards, totalDue, streak, mastery, heatmap, dailyCounts, forecastData, loading, refresh } =
    useDashboardData(period)

  return (
    <Screen safeArea padding={false} testID="dashboard-screen">
      <DrawerHeader title={t('title')} />
      <FlatList
        data={decks}
        keyExtractor={(item) => item.id}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={refresh} />}
        contentContainerStyle={styles.list}
        ListHeaderComponent={
          <View style={styles.header}>
            {/* Quick Study card — prominent entry point */}
            <TouchableOpacity
              onPress={() => tabNav?.navigate('StudyTab', { screen: 'StudySetup' } as any)}
              activeOpacity={0.8}
              style={styles.quickStudyCard}
              testID="dashboard-quick-study"
            >
              <View style={styles.quickStudyContent}>
                <Text style={styles.quickStudyIcon}>⚡</Text>
                <View style={styles.quickStudyText}>
                  <Text style={styles.quickStudyTitle}>Quick Study</Text>
                  <Text style={styles.quickStudyDesc}>
                    {totalDue > 0 ? `${totalDue} cards due today` : 'Start a study session'}
                  </Text>
                </View>
                <Text style={styles.quickStudyArrow}>→</Text>
              </View>
            </TouchableOpacity>

            {/* TimePeriodTabs — matches web */}
            <View style={styles.titleRow}>
              <View />
              <TimePeriodSelector value={period} onChange={setPeriod} testID="dashboard-period" />
            </View>

            {/* StatsSummaryCards — matches web: 2x2 grid with label on top, big value */}
            <View style={styles.statsGrid}>
              <View style={styles.statsRow}>
                <StatCard label={t('stats.totalCards')} value={totalCards} valueColor={theme.colors.text} testID="dashboard-stat-total" />
                <StatCard label={t('stats.todayReview')} value={totalDue} valueColor={palette.yellow[600]} testID="dashboard-stat-due" />
              </View>
              <View style={styles.statsRow}>
                <StatCard label={t('stats.streak')} value={t('streakDays', { count: streak })} valueColor={palette.green[600]} testID="dashboard-stat-streak" />
                <StatCard label={t('stats.masteryRate')} value={`${mastery}%`} valueColor={palette.blue[600]} testID="dashboard-stat-mastery" />
              </View>
            </View>

            {/* Heatmap — matches web: conditional on period */}
            {shouldShowHeatmap(period) && heatmap.length > 0 && (
              <MiniHeatmap data={heatmap} testID="dashboard-heatmap" />
            )}

            {/* ForecastWidget — amber bars */}
            {forecastData.length > 0 && forecastData.some((d) => d.count > 0) && (
              <BarChart data={forecastData} title={t('forecast.title')} barColor="#f59e0b" maxBars={7} testID="dashboard-forecast" />
            )}

            {/* DailyStudyChart — blue bars */}
            {dailyCounts.length > 0 && (
              <BarChart data={dailyCounts} title={t('dailyChart.title')} testID="dashboard-barchart" />
            )}

            {/* Study History link — matches web sidebar item */}
            <TouchableOpacity
              onPress={() => navigation.navigate('StudyHistory')}
              style={[styles.historyLink, { backgroundColor: theme.colors.surfaceElevated, borderColor: theme.colors.border }]}
              testID="dashboard-history-link"
            >
              <Text style={{ fontSize: 18 }}>📝</Text>
              <View style={{ flex: 1 }}>
                <Text style={[theme.typography.label, { color: theme.colors.text }]}>{t('studyHistory')}</Text>
                <Text style={[theme.typography.caption, { color: theme.colors.textSecondary }]}>
                  {t('studyHistoryDesc')}
                </Text>
              </View>
              <Text style={{ color: theme.colors.textTertiary }}>{'>'}</Text>
            </TouchableOpacity>

            {/* Recent Decks header — matches web RecentDecks */}
            <Text style={[theme.typography.labelSmall, { color: theme.colors.textSecondary }]}>
              {t('recentDecks.title')}
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
              onPress={() => tabNav?.navigate('DecksTab')}
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
                    <Text style={[theme.typography.caption, { color: theme.colors.textTertiary }]}>{t('recentDecks.cardCount', { count: total })}</Text>
                  </View>
                </View>
              </View>
              {/* Badges + Study button row */}
              <View style={styles.deckBottomRow}>
                <View style={styles.deckBadges}>
                  {newCards > 0 && (
                    <View style={[styles.badge, { backgroundColor: palette.blue[50] }]}>
                      <Text style={[styles.badgeText, { color: palette.blue[700] }]}>{t('recentDecks.newCards', { count: newCards })}</Text>
                    </View>
                  )}
                  {review > 0 && (
                    <View style={[styles.badge, { backgroundColor: '#FFFBEB' }]}>
                      <Text style={[styles.badgeText, { color: palette.yellow[600] }]}>{t('recentDecks.reviewCards', { count: review })}</Text>
                    </View>
                  )}
                </View>
                <TouchableOpacity
                  onPress={() => tabNav?.navigate('StudyTab')}
                  style={[styles.studyBtn, { backgroundColor: theme.colors.primary }]}
                >
                  <Text style={[theme.typography.caption, { color: theme.colors.primaryText, fontWeight: '500' }]}>{t('recentDecks.study')}</Text>
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
                {t('recentDecks.noDecks')}
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
  historyLink: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    borderRadius: 12, borderWidth: 1, padding: 14,
  },
  // Quick Study card — gradient-like primary color card
  quickStudyCard: {
    borderRadius: 14,
    backgroundColor: palette.blue[600],
    padding: 16,
    ...Platform.select({
      ios: { shadowColor: palette.blue[600], shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8 },
      android: { elevation: 6 },
    }),
  },
  quickStudyContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  quickStudyIcon: { fontSize: 28 },
  quickStudyText: { flex: 1, gap: 2 },
  quickStudyTitle: { fontSize: 17, fontWeight: '700', color: '#FFFFFF' },
  quickStudyDesc: { fontSize: 13, color: 'rgba(255,255,255,0.85)' },
  quickStudyArrow: { fontSize: 20, fontWeight: '600', color: 'rgba(255,255,255,0.9)' },
})
