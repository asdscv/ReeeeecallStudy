import { View, Text, ScrollView, StyleSheet } from 'react-native'
import { useTranslation } from 'react-i18next'
import { useTheme, palette } from '../../theme'
import { StatCard } from '../charts/StatCard'
import { ProgressBar } from '../charts/ProgressBar'
import { calculateDeckStats } from '@reeeeecall/shared/lib/stats'
import type { Card } from '@reeeeecall/shared/types/database'

interface DeckStatsTabProps {
  cards: Card[]
  testID?: string
}

/**
 * Matches web DeckDetail Statistics tab — stat cards + distribution bar + mastery.
 */
export function DeckStatsTab({ cards, testID }: DeckStatsTabProps) {
  const theme = useTheme()
  const { t } = useTranslation('decks')
  const deckStats = calculateDeckStats(cards)

  const statusDistribution = [
    { key: 'new', label: t('status.new'), count: deckStats.newCount, color: palette.blue[600] },
    { key: 'learning', label: t('status.learning'), count: deckStats.learningCount, color: palette.yellow[500] },
    { key: 'review', label: t('status.review'), count: deckStats.reviewCount, color: palette.green[500] },
  ]

  return (
    <ScrollView contentContainerStyle={styles.container} testID={testID}>
      {/* Stats Grid — 2x2 */}
      <View style={styles.statsGrid}>
        <View style={styles.statsRow}>
          <StatCard label={t('statsTab.total')} value={deckStats.totalCards} />
          <StatCard label={t('status.new')} value={deckStats.newCount} valueColor={palette.blue[600]} />
        </View>
        <View style={styles.statsRow}>
          <StatCard label={t('status.learning')} value={deckStats.learningCount} valueColor={palette.yellow[600]} />
          <StatCard label={t('status.review')} value={deckStats.reviewCount} valueColor={palette.green[600]} />
        </View>
      </View>

      {/* Status Distribution Bar */}
      <View style={[styles.card, { backgroundColor: theme.colors.surfaceElevated, borderColor: theme.colors.border }]}>
        <Text style={[theme.typography.labelSmall, { color: theme.colors.textSecondary, marginBottom: 8 }]}>
          {t('statsTab.statusDistribution')}
        </Text>
        {deckStats.totalCards > 0 ? (
          <View style={styles.distributionBar}>
            {statusDistribution.map((s) => {
              const pct = (s.count / deckStats.totalCards) * 100
              if (pct === 0) return null
              return (
                <View key={s.key} style={[styles.distributionSegment, { width: `${pct}%`, backgroundColor: s.color }]} />
              )
            })}
          </View>
        ) : (
          <View style={[styles.distributionBar, { backgroundColor: theme.colors.surface }]} />
        )}
        <View style={styles.legendRow}>
          {statusDistribution.map((s) => (
            <View key={s.key} style={styles.legendItem}>
              <View style={[styles.legendDot, { backgroundColor: s.color }]} />
              <Text style={[theme.typography.caption, { color: theme.colors.textSecondary }]}>
                {s.label} ({s.count})
              </Text>
            </View>
          ))}
        </View>
      </View>

      {/* Mastery Progress */}
      <View style={[styles.card, { backgroundColor: theme.colors.surfaceElevated, borderColor: theme.colors.border }]}>
        <ProgressBar percentage={deckStats.masteryRate} label={t('statsTab.masteryRate')} testID="deck-stats-mastery" />
      </View>

      {/* Additional stats */}
      <View style={[styles.card, { backgroundColor: theme.colors.surfaceElevated, borderColor: theme.colors.border }]}>
        <InfoRow theme={theme} label={t('statsTab.avgEaseFactor')} value={deckStats.avgEase.toFixed(2)} />
        <InfoRow theme={theme} label={t('statsTab.avgInterval')} value={`${deckStats.avgInterval.toFixed(1)} ${t('statsTab.days')}`} />
      </View>
    </ScrollView>
  )
}

function InfoRow({ theme, label, value }: { theme: ReturnType<typeof useTheme>; label: string; value: string }) {
  return (
    <View style={styles.infoRow}>
      <Text style={[theme.typography.body, { color: theme.colors.textSecondary }]}>{label}</Text>
      <Text style={[theme.typography.label, { color: theme.colors.text }]}>{value}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { gap: 16, paddingBottom: 24 },
  statsGrid: { gap: 8 },
  statsRow: { flexDirection: 'row', gap: 8 },
  card: { borderRadius: 12, borderWidth: 1, padding: 14, gap: 10 },
  distributionBar: { flexDirection: 'row', height: 12, borderRadius: 6, overflow: 'hidden' },
  distributionSegment: { height: '100%' },
  legendRow: { flexDirection: 'row', flexWrap: 'wrap', rowGap: 6, gap: 16, marginTop: 4 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  infoRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
})
