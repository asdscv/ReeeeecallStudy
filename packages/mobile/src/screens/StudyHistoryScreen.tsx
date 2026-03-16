import { useState, useEffect } from 'react'
import { View, Text, FlatList, StyleSheet } from 'react-native'
import { useNavigation } from '@react-navigation/native'
import { Screen, Button, Badge, ListCard } from '../components/ui'
import { useAuthState } from '../hooks'
import { useTheme } from '../theme'
import { getMobileSupabase } from '../adapters'

interface StudySession {
  id: string
  deck_id: string
  mode: string
  cards_studied: number
  duration_ms: number
  ratings: Record<string, number>
  created_at: string
}

interface DailyStats {
  date: string
  totalCards: number
  totalSessions: number
  totalDurationMs: number
}

export function StudyHistoryScreen() {
  const theme = useTheme()
  const navigation = useNavigation()
  const { user } = useAuthState()

  const [sessions, setSessions] = useState<StudySession[]>([])
  const [dailyStats, setDailyStats] = useState<DailyStats[]>([])
  const [streak, setStreak] = useState(0)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!user) return
    loadData()
  }, [user])

  const loadData = async () => {
    setLoading(true)
    const supabase = getMobileSupabase()

    // Fetch recent sessions
    const { data: sessionData } = await supabase
      .from('study_sessions')
      .select('id, deck_id, mode, cards_studied, duration_ms, ratings, created_at')
      .eq('user_id', user!.id)
      .order('created_at', { ascending: false })
      .limit(50)

    if (sessionData) setSessions(sessionData)

    // Calculate daily stats from sessions
    const dailyMap = new Map<string, DailyStats>()
    sessionData?.forEach((s) => {
      const date = s.created_at.split('T')[0]
      const existing = dailyMap.get(date) ?? { date, totalCards: 0, totalSessions: 0, totalDurationMs: 0 }
      existing.totalCards += s.cards_studied
      existing.totalSessions += 1
      existing.totalDurationMs += s.duration_ms
      dailyMap.set(date, existing)
    })
    const sortedDaily = Array.from(dailyMap.values()).sort((a, b) => b.date.localeCompare(a.date))
    setDailyStats(sortedDaily)

    // Calculate streak
    let streakCount = 0
    const today = new Date().toISOString().split('T')[0]
    const dates = new Set(sortedDaily.map((d) => d.date))
    let checkDate = new Date()

    // Check if studied today
    if (dates.has(today)) {
      streakCount = 1
      checkDate.setDate(checkDate.getDate() - 1)
    }

    while (dates.has(checkDate.toISOString().split('T')[0])) {
      streakCount++
      checkDate.setDate(checkDate.getDate() - 1)
    }
    setStreak(streakCount)

    setLoading(false)
  }

  const totalCards = sessions.reduce((sum, s) => sum + s.cards_studied, 0)
  const totalTime = sessions.reduce((sum, s) => sum + s.duration_ms, 0)
  const totalMinutes = Math.round(totalTime / 60000)

  return (
    <Screen safeArea padding={false} testID="study-history-screen">
      <FlatList
        data={dailyStats}
        keyExtractor={(item) => item.date}
        contentContainerStyle={styles.list}
        ListHeaderComponent={
          <View style={styles.header}>
            <Button title="← Back" variant="ghost" size="sm" fullWidth={false} onPress={() => navigation.goBack()} />

            <Text style={[theme.typography.h1, { color: theme.colors.text }]}>Study History</Text>

            {/* Summary stats */}
            <View style={styles.statsRow}>
              <View style={[styles.statCard, { backgroundColor: theme.colors.primaryLight }]} testID="history-streak">
                <Text style={[theme.typography.h2, { color: theme.colors.primary }]}>🔥 {streak}</Text>
                <Text style={[theme.typography.caption, { color: theme.colors.textSecondary }]}>Day Streak</Text>
              </View>
              <View style={[styles.statCard, { backgroundColor: theme.colors.surface }]} testID="history-total-cards">
                <Text style={[theme.typography.h2, { color: theme.colors.text }]}>{totalCards}</Text>
                <Text style={[theme.typography.caption, { color: theme.colors.textSecondary }]}>Cards Reviewed</Text>
              </View>
              <View style={[styles.statCard, { backgroundColor: theme.colors.surface }]} testID="history-total-time">
                <Text style={[theme.typography.h2, { color: theme.colors.text }]}>{totalMinutes}m</Text>
                <Text style={[theme.typography.caption, { color: theme.colors.textSecondary }]}>Total Time</Text>
              </View>
            </View>

            {/* Heatmap-like daily activity */}
            {dailyStats.length > 0 && (
              <View style={styles.heatmapRow}>
                {dailyStats.slice(0, 14).map((day) => {
                  const intensity = Math.min(day.totalCards / 20, 1)
                  return (
                    <View
                      key={day.date}
                      style={[
                        styles.heatCell,
                        { backgroundColor: theme.colors.primary, opacity: 0.2 + intensity * 0.8 },
                      ]}
                    />
                  )
                })}
              </View>
            )}

            <Text style={[theme.typography.h3, { color: theme.colors.text, marginTop: 8 }]}>Daily Activity</Text>
          </View>
        }
        renderItem={({ item }) => (
          <ListCard testID={`history-day-${item.date}`}>
            <View style={styles.dayRow}>
              <View style={styles.dayInfo}>
                <Text style={[theme.typography.label, { color: theme.colors.text }]}>{formatDate(item.date)}</Text>
                <Text style={[theme.typography.caption, { color: theme.colors.textSecondary }]}>
                  {item.totalSessions} session{item.totalSessions !== 1 ? 's' : ''} · {Math.round(item.totalDurationMs / 60000)}min
                </Text>
              </View>
              <Badge label={`${item.totalCards} cards`} variant="primary" />
            </View>
          </ListCard>
        )}
        ListEmptyComponent={
          !loading ? (
            <View style={styles.empty}>
              <Text style={styles.emptyIcon}>📊</Text>
              <Text style={[theme.typography.h3, { color: theme.colors.text }]}>No study history yet</Text>
              <Text style={[theme.typography.body, { color: theme.colors.textSecondary }]}>
                Start studying to see your progress here
              </Text>
            </View>
          ) : null
        }
      />
    </Screen>
  )
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr)
  const today = new Date()
  const yesterday = new Date()
  yesterday.setDate(yesterday.getDate() - 1)

  if (dateStr === today.toISOString().split('T')[0]) return 'Today'
  if (dateStr === yesterday.toISOString().split('T')[0]) return 'Yesterday'

  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

const styles = StyleSheet.create({
  list: { paddingHorizontal: 20, paddingBottom: 24, gap: 8 },
  header: { gap: 12, paddingTop: 8, paddingBottom: 8 },
  statsRow: { flexDirection: 'row', gap: 8 },
  statCard: { flex: 1, borderRadius: 12, padding: 14, alignItems: 'center', gap: 4 },
  heatmapRow: { flexDirection: 'row', gap: 4, flexWrap: 'wrap' },
  heatCell: { width: 20, height: 20, borderRadius: 4 },
  dayRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  dayInfo: { flex: 1, gap: 2 },
  empty: { alignItems: 'center', gap: 8, padding: 40 },
  emptyIcon: { fontSize: 48 },
})
