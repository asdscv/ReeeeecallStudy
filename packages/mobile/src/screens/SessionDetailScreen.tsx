import { useState, useEffect, useRef } from 'react'
import { View, Text, FlatList, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native'
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native'
import { Screen, Badge } from '../components/ui'
import { useTheme, palette } from '../theme'
import { getMobileSupabase } from '../adapters'
import {
  formatDuration,
  getStudyModeLabel,
  getStudyModeEmoji,
  getSessionPerformance,
} from '@reeeeecall/shared/lib/study-history'
import type { StudySession, StudyLog, Card } from '@reeeeecall/shared/types/database'
import type { HomeStackParamList } from '../navigation/types'

type Route = RouteProp<HomeStackParamList, 'SessionDetail'>
type LogWithCard = StudyLog & { card?: Card }

const RATING_COLORS: Record<string, { bg: string; text: string; label: string }> = {
  again: { bg: palette.red[50], text: palette.red[600], label: 'Again' },
  hard: { bg: '#FFF7ED', text: '#EA580C', label: 'Hard' },
  good: { bg: palette.green[50], text: palette.green[700], label: 'Good' },
  easy: { bg: palette.blue[50], text: palette.blue[600], label: 'Easy' },
  got_it: { bg: palette.green[50], text: palette.green[700], label: 'Got it' },
  missed: { bg: palette.red[50], text: palette.red[600], label: 'Missed' },
  known: { bg: palette.green[50], text: palette.green[700], label: 'Known' },
  unknown: { bg: palette.red[50], text: palette.red[600], label: 'Unknown' },
}

const RATING_BAR_COLORS: Record<string, string> = {
  again: palette.red[400],
  hard: '#FB923C',
  good: palette.green[400],
  easy: palette.blue[400],
}

export function SessionDetailScreen() {
  const theme = useTheme()
  const navigation = useNavigation()
  const route = useRoute<Route>()
  const { session, deckName, deckIcon } = route.params

  const [logs, setLogs] = useState<LogWithCard[]>([])
  const [loading, setLoading] = useState(true)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    const fetchData = async () => {
      setLoading(true)
      const supabase = getMobileSupabase()

      const sessionDate = new Date(session.completed_at)
      const dayStart = new Date(sessionDate)
      dayStart.setHours(0, 0, 0, 0)
      const dayEnd = new Date(sessionDate)
      dayEnd.setHours(23, 59, 59, 999)

      const { data: rawLogs } = await supabase
        .from('study_logs')
        .select('*')
        .eq('deck_id', session.deck_id)
        .eq('study_mode', session.study_mode)
        .gte('studied_at', dayStart.toISOString())
        .lte('studied_at', dayEnd.toISOString())
        .order('studied_at', { ascending: true })

      if (!mountedRef.current) return

      const matchedLogs = (rawLogs ?? []) as StudyLog[]
      const cardIds = [...new Set(matchedLogs.map((l) => l.card_id))]

      let cardMap = new Map<string, Card>()
      if (cardIds.length > 0) {
        const { data: cards } = await supabase
          .from('cards')
          .select('*')
          .in('id', cardIds)
        if (cards) {
          cardMap = new Map((cards as Card[]).map((c) => [c.id, c]))
        }
      }

      if (mountedRef.current) {
        setLogs(matchedLogs.map((log) => ({ ...log, card: cardMap.get(log.card_id) })))
        setLoading(false)
      }
    }

    fetchData()
    return () => { mountedRef.current = false }
  }, [session])

  const performance = getSessionPerformance(session.ratings)
  const ratingEntries = Object.entries(session.ratings)
  const totalRatings = ratingEntries.reduce((s, [, c]) => s + c, 0)

  const completedAt = new Date(session.completed_at)
  const dateStr = completedAt.toLocaleString('en-US', {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })

  const renderLog = ({ item, index }: { item: LogWithCard; index: number }) => {
    const ratingInfo = RATING_COLORS[item.rating] ?? { bg: theme.colors.surface, text: theme.colors.textSecondary, label: item.rating }
    const cardPreview = getCardPreview(item.card)

    return (
      <View
        style={[styles.logRow, { backgroundColor: theme.colors.surfaceElevated, borderColor: theme.colors.border }]}
        testID={`session-log-${index}`}
      >
        <Text style={[styles.logNumber, { color: theme.colors.textTertiary }]}>{index + 1}</Text>
        <View style={styles.logContent}>
          <Text
            style={[theme.typography.bodySmall, { color: theme.colors.text }]}
            numberOfLines={2}
          >
            {cardPreview}
          </Text>
          <View style={styles.logMeta}>
            {item.review_duration_ms ? (
              <Text style={[theme.typography.caption, { color: theme.colors.textTertiary }]}>
                {formatDuration(item.review_duration_ms)}
              </Text>
            ) : null}
            {item.prev_interval != null && item.new_interval != null && (
              <Text style={[theme.typography.caption, { color: theme.colors.textTertiary }]}>
                {item.prev_interval}d {'>'} {item.new_interval}d
              </Text>
            )}
          </View>
        </View>
        <View style={[styles.ratingBadge, { backgroundColor: ratingInfo.bg }]}>
          <Text style={[styles.ratingText, { color: ratingInfo.text }]}>{ratingInfo.label}</Text>
        </View>
      </View>
    )
  }

  return (
    <Screen safeArea padding={false} testID="session-detail-screen">
      <FlatList
        data={logs}
        keyExtractor={(item, i) => item.id ?? String(i)}
        renderItem={renderLog}
        contentContainerStyle={styles.list}
        ListHeaderComponent={
          <View style={styles.header}>
            {/* Back button */}
            <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn} testID="session-detail-back">
              <Text style={[theme.typography.bodySmall, { color: theme.colors.textSecondary }]}>
                {'<-'} Back
              </Text>
            </TouchableOpacity>

            {/* Session info card */}
            <View style={[styles.infoCard, { backgroundColor: theme.colors.surfaceElevated, borderColor: theme.colors.border }]}>
              <View style={styles.infoHeader}>
                <Text style={styles.deckIcon}>{deckIcon}</Text>
                <View style={{ flex: 1 }}>
                  <View style={styles.infoNameRow}>
                    <Text style={[theme.typography.label, { color: theme.colors.text }]} numberOfLines={1}>
                      {deckName}
                    </Text>
                    <Badge
                      label={`${getStudyModeEmoji(session.study_mode)} ${getStudyModeLabel(session.study_mode)}`}
                      variant="neutral"
                    />
                  </View>
                  <Text style={[theme.typography.caption, { color: theme.colors.textTertiary }]}>
                    {dateStr}
                  </Text>
                </View>
              </View>

              {/* Summary stats */}
              <View style={styles.statsRow}>
                <StatPill
                  theme={theme}
                  label="Cards"
                  value={String(session.cards_studied)}
                />
                <StatPill
                  theme={theme}
                  label="Duration"
                  value={formatDuration(session.total_duration_ms)}
                />
                {totalRatings > 0 && (
                  <StatPill
                    theme={theme}
                    label="Performance"
                    value={`${performance}%`}
                  />
                )}
              </View>

              {/* Rating distribution bar */}
              {totalRatings > 0 && (
                <View style={styles.ratingBar}>
                  <View style={styles.ratingBarTrack}>
                    {ratingEntries.map(([rating, count]) => (
                      <View
                        key={rating}
                        style={{
                          flex: count,
                          height: 8,
                          backgroundColor: RATING_BAR_COLORS[rating] ?? palette.gray[300],
                        }}
                      />
                    ))}
                  </View>
                  <View style={styles.ratingLegend}>
                    {ratingEntries.map(([rating, count]) => {
                      const info = RATING_COLORS[rating]
                      return (
                        <View key={rating} style={styles.legendItem}>
                          <View style={[styles.legendDot, { backgroundColor: RATING_BAR_COLORS[rating] ?? palette.gray[300] }]} />
                          <Text style={[theme.typography.caption, { color: theme.colors.textSecondary }]}>
                            {info?.label ?? rating} {count}
                          </Text>
                        </View>
                      )
                    })}
                  </View>
                </View>
              )}
            </View>

            {/* Card details header */}
            <View style={styles.detailHeader}>
              <Text style={[theme.typography.label, { color: theme.colors.text }]}>Card Details</Text>
              <Text style={[theme.typography.caption, { color: theme.colors.textTertiary }]}>
                {logs.length} logs
              </Text>
            </View>

            {loading && (
              <View style={styles.loadingRow}>
                <ActivityIndicator size="small" color={theme.colors.primary} />
                <Text style={[theme.typography.bodySmall, { color: theme.colors.textSecondary }]}>
                  Loading details...
                </Text>
              </View>
            )}
          </View>
        }
        ListEmptyComponent={
          !loading ? (
            <View style={[styles.emptyCard, { backgroundColor: theme.colors.surfaceElevated, borderColor: theme.colors.border }]}>
              <Text style={[theme.typography.body, { color: theme.colors.textSecondary, textAlign: 'center' }]}>
                No detailed logs available for this session
              </Text>
            </View>
          ) : null
        }
      />
    </Screen>
  )
}

// ── Helpers ──

function StatPill({ theme, label, value }: { theme: ReturnType<typeof useTheme>; label: string; value: string }) {
  return (
    <View style={[styles.statPill, { backgroundColor: theme.colors.surface }]}>
      <Text style={[theme.typography.caption, { color: theme.colors.textTertiary }]}>{label}</Text>
      <Text style={[theme.typography.label, { color: theme.colors.text }]}>{value}</Text>
    </View>
  )
}

function getCardPreview(card?: Card): string {
  if (!card) return '(Deleted card)'
  const values = Object.values(card.field_values)
  if (values.length === 0) return '(No content)'
  const front = String(values[0] ?? '').slice(0, 40)
  const back = values[1] ? String(values[1]).slice(0, 30) : ''
  if (back) return `${front} -> ${back}`
  return front
}

const styles = StyleSheet.create({
  list: { paddingHorizontal: 16, paddingBottom: 24, gap: 6 },
  header: { gap: 12, paddingTop: 8, paddingBottom: 8 },
  backBtn: { paddingVertical: 4 },
  // Info card
  infoCard: { borderRadius: 12, borderWidth: 1, padding: 16, gap: 12 },
  infoHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  deckIcon: { fontSize: 30 },
  infoNameRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  statsRow: { flexDirection: 'row', gap: 8 },
  statPill: { flex: 1, padding: 10, borderRadius: 8, alignItems: 'center', gap: 2 },
  // Rating bar
  ratingBar: { gap: 6 },
  ratingBarTrack: { flexDirection: 'row', height: 8, borderRadius: 4, overflow: 'hidden' },
  ratingLegend: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  legendDot: { width: 6, height: 6, borderRadius: 3 },
  // Detail header
  detailHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  loadingRow: { flexDirection: 'row', alignItems: 'center', gap: 8, justifyContent: 'center', paddingVertical: 12 },
  // Log row
  logRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
  },
  logNumber: { fontSize: 11, fontFamily: 'monospace', width: 20, textAlign: 'center' },
  logContent: { flex: 1, gap: 2 },
  logMeta: { flexDirection: 'row', gap: 8 },
  ratingBadge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  ratingText: { fontSize: 11, fontWeight: '600' },
  // Empty
  emptyCard: { borderRadius: 12, borderWidth: 1, padding: 24, alignItems: 'center' },
})
