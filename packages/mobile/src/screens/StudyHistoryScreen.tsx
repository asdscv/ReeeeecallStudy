import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { View, Text, FlatList, RefreshControl, TouchableOpacity, ScrollView, StyleSheet } from 'react-native'
import { useNavigation } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { Screen, Button, Badge, ListCard } from '../components/ui'
import { TimePeriodSelector, BarChart } from '../components/charts'
import { OverviewStatsRow, RatingDistributionBars } from '../components/study-history'
import { useAuthState } from '../hooks'
import { useDecks } from '../hooks/useDecks'
import { useTranslation } from 'react-i18next'
import { useTheme, palette } from '../theme'
import { getMobileSupabase } from '../adapters'
import type { TimePeriod } from '@reeeeecall/shared/lib/time-period'
import { periodToDays } from '@reeeeecall/shared/lib/time-period'
import { getStreakDays } from '@reeeeecall/shared/lib/stats'
import {
  filterSessionsByPeriod,
  filterSessionsByDeckScope,
  computeOverviewStats,
  computeRatingDistribution,
  computeDailySessionCounts,
  computeModeBreakdown,
  type DeckScope,
  type ModeBreakdown,
} from '@reeeeecall/shared/lib/study-history-stats'
import {
  formatDuration,
  getStudyModeLabel,
  getStudyModeEmoji,
  groupSessionsByDate,
  aggregateLogsToSessions,
  mergeSessionsWithLogs,
} from '@reeeeecall/shared/lib/study-history'
import type { StudySession, StudyLog } from '@reeeeecall/shared/types/database'
import type { HomeStackParamList } from '../navigation/types'

/**
 * Matches web StudyHistoryPage:
 * - Header: title + TimePeriodTabs
 * - Deck scope selector (horizontal scroll)
 * - OverviewStatsCards
 * - Charts grid (StudyVolumeChart, RatingDistributionChart)
 * - Session list grouped by date
 */
export function StudyHistoryScreen() {
  const theme = useTheme()
  const navigation = useNavigation<NativeStackNavigationProp<HomeStackParamList>>()
  const { user } = useAuthState()
  const { decks } = useDecks()

  const [allSessions, setAllSessions] = useState<StudySession[]>([])
  const [allLogs, setAllLogs] = useState<StudyLog[]>([])
  const [period, setPeriod] = useState<TimePeriod>('1m')
  const [deckScope, setDeckScope] = useState<DeckScope>('all')
  const [loading, setLoading] = useState(true)
  const [modeFilter, setModeFilter] = useState<string>('all')
  const mountedRef = useRef(true)

  const loadData = useCallback(async () => {
    if (!user) return
    setLoading(true)
    const supabase = getMobileSupabase()

    const [sessionsRes, logsRes] = await Promise.all([
      supabase
        .from('study_sessions')
        .select('*')
        .eq('user_id', user.id)
        .order('completed_at', { ascending: false })
        .limit(500),
      supabase
        .from('study_logs')
        .select('*')
        .eq('user_id', user.id)
        .order('studied_at', { ascending: false })
        .limit(5000),
    ])

    if (mountedRef.current) {
      const realSessions = (sessionsRes.data ?? []) as StudySession[]
      const logs = (logsRes.data ?? []) as StudyLog[]
      setAllLogs(logs)
      const logSessions = aggregateLogsToSessions(logs)
      setAllSessions(mergeSessionsWithLogs(realSessions, logSessions))
      setLoading(false)
    }
  }, [user])

  useEffect(() => {
    mountedRef.current = true
    loadData()
    return () => { mountedRef.current = false }
  }, [loadData])

  // Derived data
  const days = periodToDays(period)
  const periodSessions = useMemo(() => filterSessionsByPeriod(allSessions, days), [allSessions, days])
  const scopedSessions = useMemo(() => filterSessionsByDeckScope(periodSessions, deckScope), [periodSessions, deckScope])
  const overview = useMemo(() => computeOverviewStats(scopedSessions), [scopedSessions])
  const streak = useMemo(() => getStreakDays(allLogs), [allLogs])
  const ratingDist = useMemo(() => computeRatingDistribution(scopedSessions), [scopedSessions])
  const dailyCounts = useMemo(() => computeDailySessionCounts(scopedSessions, days), [scopedSessions, days])
  const dailyData = dailyCounts.map((d) => ({ date: d.date, count: d.cards }))
  const modeBreakdown = useMemo(() => computeModeBreakdown(scopedSessions), [scopedSessions])
  const filteredByMode = useMemo(() =>
    modeFilter === 'all' ? scopedSessions : scopedSessions.filter((s) => s.study_mode === modeFilter),
    [scopedSessions, modeFilter],
  )
  const grouped = useMemo(() => groupSessionsByDate(filteredByMode), [filteredByMode])

  // Decks that have sessions (for scope selector)
  const sessionDeckIds = useMemo(() => new Set(periodSessions.map((s) => s.deck_id)), [periodSessions])
  const sessionDecks = decks.filter((d) => sessionDeckIds.has(d.id))
  const selectedDeck = deckScope !== 'all' ? decks.find((d) => d.id === deckScope) : null

  return (
    <Screen safeArea padding={false} testID="study-history-screen">
      <FlatList
        data={grouped}
        keyExtractor={(item) => item.date}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={loadData} />}
        contentContainerStyle={styles.list}
        ListHeaderComponent={
          <View style={styles.header}>
            {/* Back + Title */}
            <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
              <Text style={[theme.typography.bodySmall, { color: theme.colors.textSecondary }]}>← {t('back')}</Text>
            </TouchableOpacity>

            <View style={styles.titleRow}>
              <Text style={[theme.typography.h2, { color: theme.colors.text }]}>
                {selectedDeck ? `${selectedDeck.icon} ${selectedDeck.name}` : t('title')}
              </Text>
              <TimePeriodSelector value={period} onChange={setPeriod} testID="history-period" />
            </View>

            {/* Deck scope selector — matches web: horizontal scroll */}
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.scopeScroll}>
              <View style={styles.scopeRow}>
                <TouchableOpacity
                  onPress={() => setDeckScope('all')}
                  style={[
                    styles.scopeChip,
                    {
                      backgroundColor: deckScope === 'all' ? theme.colors.primary : theme.colors.surfaceElevated,
                      borderColor: deckScope === 'all' ? theme.colors.primary : theme.colors.border,
                    },
                  ]}
                >
                  <Text style={[
                    theme.typography.caption,
                    { color: deckScope === 'all' ? theme.colors.primaryText : theme.colors.text, fontWeight: '500' },
                  ]}>{t('all')}</Text>
                </TouchableOpacity>
                {sessionDecks.map((d) => (
                  <TouchableOpacity
                    key={d.id}
                    onPress={() => setDeckScope(d.id)}
                    style={[
                      styles.scopeChip,
                      {
                        backgroundColor: deckScope === d.id ? theme.colors.primary : theme.colors.surfaceElevated,
                        borderColor: deckScope === d.id ? theme.colors.primary : theme.colors.border,
                      },
                    ]}
                  >
                    <Text style={[
                      theme.typography.caption,
                      { color: deckScope === d.id ? theme.colors.primaryText : theme.colors.text, fontWeight: '500' },
                    ]}>{d.icon} {d.name}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </ScrollView>

            {/* Overview Stats */}
            <OverviewStatsRow stats={overview} streak={streak} testID="history-overview" />

            {/* Charts: Study volume + Rating distribution */}
            {dailyData.length > 0 && (
              <BarChart data={dailyData} title={t('studyVolume')} testID="history-barchart" />
            )}

            <RatingDistributionBars data={ratingDist} testID="history-ratings" />

            {/* Mode Breakdown — matches web */}
            {modeBreakdown.length > 0 && (
              <View style={styles.modeBreakdownSection}>
                <Text style={[theme.typography.labelSmall, { color: theme.colors.textSecondary, marginBottom: 8 }]}>
                  Mode Breakdown
                </Text>
                <View style={styles.modeBreakdownGrid}>
                  {modeBreakdown.map((mb) => (
                    <View
                      key={mb.mode}
                      style={[styles.modeBreakdownCard, { backgroundColor: theme.colors.surfaceElevated, borderColor: theme.colors.border }]}
                    >
                      <Text style={styles.modeBreakdownEmoji}>{getStudyModeEmoji(mb.mode)}</Text>
                      <Text style={[theme.typography.label, { color: theme.colors.text }]}>{getStudyModeLabel(mb.mode)}</Text>
                      <View style={styles.modeBreakdownStats}>
                        <Text style={[theme.typography.caption, { color: theme.colors.textSecondary }]}>
                          {mb.sessionCount} sessions
                        </Text>
                        <Text style={[theme.typography.caption, { color: theme.colors.textSecondary }]}>
                          {mb.totalCards} cards
                        </Text>
                        <Text style={[theme.typography.caption, { color: theme.colors.textSecondary }]}>
                          {formatDuration(mb.totalTimeMs)}
                        </Text>
                        <Text style={[theme.typography.caption, { color: palette.blue[600], fontWeight: '500' }]}>
                          {mb.avgPerformance}%
                        </Text>
                      </View>
                    </View>
                  ))}
                </View>
              </View>
            )}

            {/* Deck Progress — matches web */}
            {sessionDecks.length > 0 && deckScope === 'all' && (
              <View style={styles.deckProgressSection}>
                <Text style={[theme.typography.labelSmall, { color: theme.colors.textSecondary, marginBottom: 8 }]}>
                  Deck Progress
                </Text>
                {sessionDecks.map((deck) => {
                  const deckSessions = periodSessions.filter((s) => s.deck_id === deck.id)
                  const totalCards = deckSessions.reduce((sum, s) => sum + s.cards_studied, 0)
                  const totalTime = deckSessions.reduce((sum, s) => sum + s.total_duration_ms, 0)
                  return (
                    <View
                      key={deck.id}
                      style={[styles.deckProgressCard, { backgroundColor: theme.colors.surfaceElevated, borderColor: theme.colors.border }]}
                    >
                      <View style={styles.deckProgressHeader}>
                        <Text style={[theme.typography.label, { color: theme.colors.text }]}>
                          {deck.icon} {deck.name}
                        </Text>
                        <Text style={[theme.typography.caption, { color: theme.colors.textSecondary }]}>
                          {totalCards} cards · {formatDuration(totalTime)}
                        </Text>
                      </View>
                      <View style={[styles.progressBarBg, { backgroundColor: theme.colors.surface }]}>
                        <View style={[styles.progressBarFill, { width: `${Math.min(100, (deckSessions.length / Math.max(scopedSessions.length, 1)) * 100)}%`, backgroundColor: theme.colors.primary }]} />
                      </View>
                    </View>
                  )
                })}
              </View>
            )}

            {/* Sessions header + mode filter — matches web */}
            <Text style={[theme.typography.labelSmall, { color: theme.colors.textSecondary }]}>
              Session List
            </Text>
            {modeBreakdown.length > 1 && (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.modeFilterScroll}>
                <View style={styles.modeFilterRow}>
                  <TouchableOpacity
                    onPress={() => setModeFilter('all')}
                    style={[styles.modeFilterChip, {
                      backgroundColor: modeFilter === 'all' ? theme.colors.primary : theme.colors.surfaceElevated,
                      borderColor: modeFilter === 'all' ? theme.colors.primary : theme.colors.border,
                    }]}
                  >
                    <Text style={[theme.typography.caption, {
                      color: modeFilter === 'all' ? theme.colors.primaryText : theme.colors.text,
                    }]}>{t('allModes')}</Text>
                  </TouchableOpacity>
                  {modeBreakdown.map((mb) => (
                    <TouchableOpacity
                      key={mb.mode}
                      onPress={() => setModeFilter(mb.mode)}
                      style={[styles.modeFilterChip, {
                        backgroundColor: modeFilter === mb.mode ? theme.colors.primary : theme.colors.surfaceElevated,
                        borderColor: modeFilter === mb.mode ? theme.colors.primary : theme.colors.border,
                      }]}
                    >
                      <Text style={[theme.typography.caption, {
                        color: modeFilter === mb.mode ? theme.colors.primaryText : theme.colors.text,
                      }]}>{getStudyModeEmoji(mb.mode)} {getStudyModeLabel(mb.mode)}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </ScrollView>
            )}
          </View>
        }
        renderItem={({ item: group }) => (
          <View style={styles.dateGroup}>
            <Text style={[theme.typography.labelSmall, { color: theme.colors.textSecondary, marginBottom: 6 }]}>
              {formatDateLabel(group.date)}
            </Text>
            {group.sessions.map((session) => {
              const deck = decks.find((d) => d.id === session.deck_id)
              return (
                <TouchableOpacity
                  key={session.id}
                  style={[styles.sessionCard, { backgroundColor: theme.colors.surfaceElevated, borderColor: theme.colors.border }]}
                  activeOpacity={0.7}
                  onPress={() => navigation.navigate('SessionDetail', {
                    session,
                    deckName: deck?.name ?? 'Unknown Deck',
                    deckIcon: deck?.icon ?? '📚',
                  })}
                  testID={`session-card-${session.id}`}
                >
                  <View style={styles.sessionRow}>
                    <Text style={styles.modeEmoji}>{getStudyModeEmoji(session.study_mode)}</Text>
                    <View style={styles.sessionInfo}>
                      <Text style={[theme.typography.label, { color: theme.colors.text }]} numberOfLines={1}>
                        {deck?.name ?? 'Unknown Deck'}
                      </Text>
                      <Text style={[theme.typography.caption, { color: theme.colors.textSecondary }]}>
                        {getStudyModeLabel(session.study_mode)} · {session.cards_studied} cards · {formatDuration(session.total_duration_ms)}
                      </Text>
                    </View>
                    <Text style={{ color: theme.colors.textTertiary, fontSize: 14 }}>{'>'}</Text>
                  </View>
                </TouchableOpacity>
              )
            })}
          </View>
        )}
        ListEmptyComponent={
          !loading ? (
            <View style={[styles.emptyCard, { backgroundColor: theme.colors.surfaceElevated, borderColor: theme.colors.border }]}>
              <Text style={styles.emptyEmoji}>📝</Text>
              <Text style={[theme.typography.h3, { color: theme.colors.text }]}>{t('empty')}</Text>
              <Text style={[theme.typography.body, { color: theme.colors.textSecondary, textAlign: 'center' }]}>
                Start studying to see your progress here
              </Text>
            </View>
          ) : null
        }
      />
    </Screen>
  )
}

function formatDateLabel(dateStr: string): string {
  const today = new Date().toISOString().split('T')[0]
  const yesterday = new Date()
  yesterday.setDate(yesterday.getDate() - 1)
  const yesterdayStr = yesterday.toISOString().split('T')[0]

  if (dateStr === today) return 'Today'
  if (dateStr === yesterdayStr) return 'Yesterday'
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

const styles = StyleSheet.create({
  list: { paddingHorizontal: 16, paddingBottom: 24, gap: 8 },
  header: { gap: 14, paddingTop: 8, paddingBottom: 8 },
  backBtn: { paddingVertical: 4 },
  titleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  scopeScroll: { flexGrow: 0 },
  scopeRow: { flexDirection: 'row', gap: 6 },
  scopeChip: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, borderWidth: 1 },
  dateGroup: { marginBottom: 12 },
  sessionCard: { borderRadius: 12, borderWidth: 1, padding: 12, marginBottom: 6 },
  sessionRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  modeEmoji: { fontSize: 20 },
  sessionInfo: { flex: 1, gap: 2 },
  emptyCard: { borderRadius: 12, borderWidth: 1, padding: 32, alignItems: 'center', gap: 8 },
  emptyEmoji: { fontSize: 40 },
  // Mode filter
  modeFilterScroll: { flexGrow: 0 },
  modeFilterRow: { flexDirection: 'row', gap: 6 },
  modeFilterChip: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, borderWidth: 1 },
  // Mode Breakdown
  modeBreakdownSection: { gap: 4 },
  modeBreakdownGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  modeBreakdownCard: { width: '47%' as any, borderRadius: 12, borderWidth: 1, padding: 12, gap: 6 },
  modeBreakdownEmoji: { fontSize: 20 },
  modeBreakdownStats: { gap: 2 },
  // Deck Progress
  deckProgressSection: { gap: 4 },
  deckProgressCard: { borderRadius: 12, borderWidth: 1, padding: 12, gap: 8, marginBottom: 6 },
  deckProgressHeader: { gap: 2 },
  progressBarBg: { height: 6, borderRadius: 3, overflow: 'hidden' },
  progressBarFill: { height: '100%', borderRadius: 3 },
})
