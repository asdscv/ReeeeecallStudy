import { useState, useEffect, useCallback, useRef } from 'react'
import { View, Text, FlatList, TouchableOpacity, RefreshControl, StyleSheet, Platform } from 'react-native'
import { useNavigation, type NavigationProp } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { useTranslation } from 'react-i18next'
import { Screen, DrawerHeader } from '../components/ui'
import { TimePeriodSelector, MiniHeatmap, BarChart } from '../components/charts'
import { LevelCard, StreakFreezeCard, DailyQuestsCard, NextGoalsCard, LevelUpCelebration } from '../components/dashboard'
import { useDashboardData } from '../hooks/useDashboardData'
import { useGamification } from '../hooks/useGamification'
import { useTheme, palette } from '../theme'
import type { HomeStackParamList, MainTabParamList } from '../navigation/types'
import type { TimePeriod } from '@reeeeecall/shared/lib/time-period'
import { shouldShowHeatmap } from '@reeeeecall/shared/lib/time-period'
import { OnboardingModal } from '../components/OnboardingModal'
import { getMobileSupabase } from '../adapters'

type Nav = NativeStackNavigationProp<HomeStackParamList>

export function DashboardScreen() {
  const theme = useTheme()
  const { t } = useTranslation('dashboard')
  const navigation = useNavigation<Nav>()
  const tabNav = navigation.getParent<NavigationProp<MainTabParamList>>()

  const [period, setPeriod] = useState<TimePeriod>('1m')
  const [showOnboarding, setShowOnboarding] = useState(false)
  const [showLevelUp, setShowLevelUp] = useState(false)

  // Data hooks
  const { decks, stats, totalCards, totalDue, streak, mastery, heatmap, dailyCounts, forecastData, loading, refresh } =
    useDashboardData(period)
  const { freezeInfo, quests, goals, levelInfo, achievements, checkAchievements, refresh: refreshGamification } = useGamification()

  // Onboarding check + achievement check on mount
  useEffect(() => {
    const supabase = getMobileSupabase()
    Promise.resolve(supabase.rpc('get_onboarding_status')).then(({ data }) => {
      const result = data as { completed: boolean } | null
      if (result && !result.completed) setShowOnboarding(true)
    }).catch(() => {})
  }, [])

  // Show level-up celebration only when level actually increases
  const prevLevelRef = useRef(0)
  useEffect(() => {
    if (levelInfo && levelInfo.level > 0) {
      const prevLevel = prevLevelRef.current
      prevLevelRef.current = levelInfo.level
      if (prevLevel > 0 && levelInfo.level > prevLevel) {
        setShowLevelUp(true)
      }
    }
  }, [levelInfo?.level])

  const handleRefresh = useCallback(async () => {
    refreshGamification()
    await refresh()
  }, [refresh, refreshGamification])

  return (
    <Screen safeArea padding={false} testID="dashboard-screen">
      <OnboardingModal visible={showOnboarding} onDismiss={() => setShowOnboarding(false)} />
      {levelInfo && (
        <LevelUpCelebration
          level={levelInfo.level}
          visible={showLevelUp}
          onDismiss={() => setShowLevelUp(false)}
        />
      )}
      <DrawerHeader title={t('title')} />

      <FlatList
        data={decks}
        keyExtractor={(item) => item.id}
        extraData={{ levelInfo, freezeInfo, quests, goals, heatmap, dailyCounts, forecastData, streak, mastery }}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={handleRefresh} />}
        contentContainerStyle={styles.list}
        ListHeaderComponent={
          <View style={styles.header}>
            {/* Title + Period selector */}
            <View style={styles.titleSection}>
              <Text style={[theme.typography.h2, { color: theme.colors.text }]}>{t('title')}</Text>
              <TimePeriodSelector value={period} onChange={setPeriod} testID="dashboard-period" />
            </View>

            {/* Quick Study CTA */}
            <TouchableOpacity
              onPress={() => tabNav?.navigate('StudyTab', { screen: 'StudySetup' } as any)}
              activeOpacity={0.8}
              style={styles.quickStudyCard}
              testID="dashboard-quick-study"
            >
              <View style={styles.quickStudyContent}>
                <Text style={styles.quickStudyIcon}>{'\u26A1'}</Text>
                <View style={styles.quickStudyText}>
                  <Text style={styles.quickStudyTitle}>Quick Study</Text>
                  <Text style={styles.quickStudyDesc}>
                    {totalDue > 0 ? `${totalDue} cards due today` : 'Start a study session'}
                  </Text>
                </View>
                <Text style={styles.quickStudyArrow}>{'\u2192'}</Text>
              </View>
            </TouchableOpacity>

            {/* Stats Summary — 2x2 grid */}
            <View style={[styles.sectionCard, { backgroundColor: theme.colors.surfaceElevated, borderColor: theme.colors.border }]}>
              <View style={styles.statsRow}>
                <View style={styles.statItem}>
                  <Text style={[theme.typography.caption, { color: theme.colors.textSecondary }]}>{t('stats.totalCards')}</Text>
                  <Text style={[styles.statValue, { color: theme.colors.text }]}>{totalCards}</Text>
                </View>
                <View style={styles.statItem}>
                  <Text style={[theme.typography.caption, { color: theme.colors.textSecondary }]}>{t('stats.todayReview')}</Text>
                  <Text style={[styles.statValue, { color: palette.yellow[600] }]}>{totalDue}</Text>
                </View>
              </View>
              <View style={styles.statsRow}>
                <View style={styles.statItem}>
                  <Text style={[theme.typography.caption, { color: theme.colors.textSecondary }]}>{t('stats.streak')}</Text>
                  <Text style={[styles.statValue, { color: palette.green[600] }]}>{t('streakDays', { count: streak })}</Text>
                </View>
                <View style={styles.statItem}>
                  <Text style={[theme.typography.caption, { color: theme.colors.textSecondary }]}>{t('stats.masteryRate')}</Text>
                  <Text style={[styles.statValue, { color: palette.blue[600] }]}>{mastery}%</Text>
                </View>
              </View>
            </View>

            {/* Gamification widgets — modular components */}
            {levelInfo && (
              <LevelCard
                levelInfo={levelInfo}
                achievements={achievements}
                onPressAchievements={() => tabNav?.navigate('SettingsTab', { screen: 'Achievements' } as any)}
              />
            )}

            {freezeInfo && <StreakFreezeCard freezeInfo={freezeInfo} totalXp={levelInfo?.total_xp} />}

            <DailyQuestsCard quests={quests} />

            <NextGoalsCard goals={goals} />

            {/* Heatmap */}
            {shouldShowHeatmap(period) && heatmap.length > 0 && (
              <MiniHeatmap data={heatmap} testID="dashboard-heatmap" />
            )}

            {/* Forecast — amber bars */}
            {forecastData.length > 0 && forecastData.some((d) => d.count > 0) && (
              <BarChart data={forecastData} title={t('forecast.title')} barColor={palette.yellow[500]} maxBars={7} testID="dashboard-forecast" />
            )}

            {/* Daily Study Volume — show all days in period */}
            {dailyCounts.length > 0 && (
              <BarChart
                data={dailyCounts}
                title={t('dailyChart.title')}
                maxBars={dailyCounts.length}
                noDataMessage={t('dailyChart.noData')}
                testID="dashboard-barchart"
              />
            )}

            {/* Deck Status header */}
            <Text style={[theme.typography.label, { color: theme.colors.text }]}>{t('recentDecks.title')}</Text>
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
              <View style={[styles.deckColorBar, { backgroundColor: item.color || palette.blue[500] }]} />
              <View style={styles.deckBody}>
                <View style={styles.deckNameRow}>
                  <Text style={styles.deckEmoji}>{item.icon}</Text>
                  <View style={styles.deckNameCol}>
                    <Text style={[theme.typography.label, { color: theme.colors.text }]} numberOfLines={1}>{item.name}</Text>
                    <Text style={[theme.typography.caption, { color: theme.colors.textTertiary }]}>{total} cards</Text>
                  </View>
                </View>
                <View style={styles.deckBottomRow}>
                  <View style={styles.deckBadges}>
                    {newCards > 0 && (
                      <View style={[styles.badge, { backgroundColor: palette.blue[50] }]}>
                        <Text style={[styles.badgeText, { color: palette.blue[700] }]}>New {newCards}</Text>
                      </View>
                    )}
                    {review > 0 && (
                      <View style={[styles.badge, { backgroundColor: palette.yellow[50] }]}>
                        <Text style={[styles.badgeText, { color: palette.yellow[700] }]}>Review {review}</Text>
                      </View>
                    )}
                  </View>
                  <TouchableOpacity
                    onPress={() => tabNav?.navigate('StudyTab')}
                    style={[styles.studyBtn, { backgroundColor: theme.colors.primary }]}
                  >
                    <Text style={[theme.typography.caption, { color: theme.colors.primaryText, fontWeight: '600' }]}>Study</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </TouchableOpacity>
          )
        }}
        ListEmptyComponent={
          !loading ? (
            <View style={[styles.emptyCard, { backgroundColor: theme.colors.surfaceElevated, borderColor: theme.colors.border }]}>
              <Text style={styles.emptyEmoji}>{'\uD83D\uDCDA'}</Text>
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
  header: { gap: 14, paddingTop: 8, paddingBottom: 12 },
  titleSection: { gap: 8 },
  // Stats
  sectionCard: { borderRadius: 12, borderWidth: 1, padding: 14, gap: 10 },
  statsRow: { flexDirection: 'row' },
  statItem: { flex: 1, paddingVertical: 8, paddingHorizontal: 4, alignItems: 'center', gap: 2 },
  statValue: { fontSize: 28, fontWeight: '700' },
  // Quick Study
  quickStudyCard: {
    borderRadius: 14,
    backgroundColor: palette.blue[600],
    padding: 16,
    ...Platform.select({
      ios: { shadowColor: palette.blue[600], shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8 },
      android: { elevation: 6 },
    }),
  },
  quickStudyContent: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  quickStudyIcon: { fontSize: 28 },
  quickStudyText: { flex: 1, gap: 2 },
  quickStudyTitle: { fontSize: 17, fontWeight: '700', color: '#FFFFFF' },
  quickStudyDesc: { fontSize: 13, color: 'rgba(255,255,255,0.85)' },
  quickStudyArrow: { fontSize: 20, fontWeight: '600', color: 'rgba(255,255,255,0.9)' },
  // Deck cards
  deckCard: { borderRadius: 12, borderWidth: 1, overflow: 'hidden', flexDirection: 'row', marginBottom: 10 },
  deckColorBar: { width: 4 },
  deckBody: { flex: 1, padding: 12, gap: 8 },
  deckNameRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  deckEmoji: { fontSize: 24 },
  deckNameCol: { flex: 1, gap: 1 },
  deckBottomRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  deckBadges: { flexDirection: 'row', gap: 6, flex: 1 },
  badge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 12 },
  badgeText: { fontSize: 11, fontWeight: '500' },
  studyBtn: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 8 },
  // Empty
  emptyCard: { borderRadius: 12, borderWidth: 1, padding: 32, alignItems: 'center', gap: 12 },
  emptyEmoji: { fontSize: 40 },
})
