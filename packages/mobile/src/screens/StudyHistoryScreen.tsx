import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { View, Text, FlatList, RefreshControl, TouchableOpacity, ScrollView, StyleSheet } from 'react-native'
import { useNavigation } from '@react-navigation/native'
import { Screen, Button, Badge, ListCard } from '../components/ui'
import { TimePeriodSelector, BarChart } from '../components/charts'
import { OverviewStatsRow, RatingDistributionBars } from '../components/study-history'
import { useAuthState } from '../hooks'
import { useDecks } from '../hooks/useDecks'
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
  type DeckScope,
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
  const navigation = useNavigation()
  const { user } = useAuthState()
  const { decks } = useDecks()

  const [allSessions, setAllSessions] = useState<StudySession[]>([])
  const [allLogs, setAllLogs] = useState<StudyLog[]>([])
  const [period, setPeriod] = useState<TimePeriod>('1m')
  const [deckScope, setDeckScope] = useState<DeckScope>('all')
  const [loading, setLoading] = useState(true)
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
  const grouped = useMemo(() => groupSessionsByDate(scopedSessions), [scopedSessions])

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
              <Text style={[theme.typography.bodySmall, { color: theme.colors.textSecondary }]}>← Back</Text>
            </TouchableOpacity>

            <View style={styles.titleRow}>
              <Text style={[theme.typography.h2, { color: theme.colors.text }]}>
                {selectedDeck ? `${selectedDeck.icon} ${selectedDeck.name}` : 'Study History'}
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
                  ]}>All</Text>
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
              <BarChart data={dailyData} title="Study Volume" testID="history-barchart" />
            )}

            <RatingDistributionBars data={ratingDist} testID="history-ratings" />

            {/* Sessions header */}
            <Text style={[theme.typography.labelSmall, { color: theme.colors.textSecondary }]}>
              Sessions
            </Text>
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
                <View
                  key={session.id}
                  style={[styles.sessionCard, { backgroundColor: theme.colors.surfaceElevated, borderColor: theme.colors.border }]}
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
                  </View>
                </View>
              )
            })}
          </View>
        )}
        ListEmptyComponent={
          !loading ? (
            <View style={[styles.emptyCard, { backgroundColor: theme.colors.surfaceElevated, borderColor: theme.colors.border }]}>
              <Text style={styles.emptyEmoji}>📝</Text>
              <Text style={[theme.typography.h3, { color: theme.colors.text }]}>No study history yet</Text>
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
})
