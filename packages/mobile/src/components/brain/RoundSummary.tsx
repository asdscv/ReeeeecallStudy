import { View, Text, ScrollView, StyleSheet } from 'react-native'
import { Feather } from '@expo/vector-icons'
import { useTranslation } from 'react-i18next'
import { formatCount } from '@reeeeecall/shared/lib/format-number'
import { displayLevel, type BrainGameId } from '@reeeeecall/shared/lib/brain-games'
import type { RoundStats } from '@reeeeecall/shared/hooks/useBrainRound'
import { Button } from '../ui'
import { useTheme, type Theme } from '../../theme'
import { testProps } from '../../utils/testProps'

/**
 * The end of a free-practice round. It opens with what went up — the level and any personal best —
 * in words that keep the level this game's record only, never a measure of memory.
 */
export function RoundSummary({
  gameId,
  stats,
  onAgain,
  onHome,
}: {
  gameId: BrainGameId
  stats: RoundStats
  onAgain: () => void
  onHome: () => void
}) {
  const theme = useTheme()
  const { t } = useTranslation('brain')
  const accuracy = stats.trials > 0 ? Math.round((stats.correct / stats.trials) * 100) : 0
  const title = stats.endedBy === 'cap' ? t('summary.cleared') : stats.endedBy === 'stop' ? t('summary.stopped') : t('summary.livesOut')
  const from = displayLevel(stats.levelStart)
  const to = displayLevel(stats.levelEnd)

  return (
    <ScrollView contentContainerStyle={styles.root} showsVerticalScrollIndicator={false}>
      <View style={[styles.card, { backgroundColor: theme.colors.surfaceElevated, borderColor: theme.colors.border }]} {...testProps('brain-summary', true)}>
        <View style={styles.head}>
          <Text style={[styles.game, { color: theme.colors.textSecondary }]}>{t(`games.${gameId}.name`)}</Text>
          <Text style={[styles.title, { color: theme.colors.text }]}>{title}</Text>
        </View>

        {stats.trials > 0 ? (
          <View style={styles.levelBlock}>
            <Text style={[styles.levelLine, { color: theme.colors.text }]}>{t('summary.levelChange', { from, to })}</Text>
            {to > from ? (
              <View style={styles.improved}>
                <Feather name="trending-up" size={18} color={theme.colors.success} />
                <Text style={[styles.improvedText, { color: theme.colors.success }]}>{t('summary.improved')}</Text>
              </View>
            ) : null}
          </View>
        ) : null}

        {stats.isNewBest ? (
          <View style={[styles.best, { backgroundColor: theme.colors.primaryLight }]} testID={'brain-new-best'}>
            <Feather name="award" size={18} color={theme.colors.primary} />
            <Text style={[styles.bestText, { color: theme.colors.primary }]}>{t('summary.newBest')}</Text>
          </View>
        ) : null}

        <View style={styles.tiles}>
          <Stat label={t('summary.trials')} value={formatCount(stats.trials)} theme={theme} />
          <Stat label={t('summary.accuracy')} value={`${accuracy}%`} theme={theme} />
          <Stat label={t('summary.points')} value={formatCount(stats.points)} theme={theme} />
          <Stat label={t('summary.bestStreak')} value={formatCount(stats.bestStreak)} theme={theme} />
        </View>

        <View style={styles.actions}>
          <Button title={t('summary.home')} variant="outline" size="lg" onPress={onHome} style={styles.action} fullWidth={false} testID="brain-summary-home" />
          <Button title={t('summary.again')} size="lg" onPress={onAgain} style={styles.action} fullWidth={false} testID="brain-again" />
        </View>
      </View>
    </ScrollView>
  )
}

export function Stat({ label, value, theme }: { label: string; value: string; theme: Theme }) {
  return (
    <View style={[styles.tile, { backgroundColor: theme.colors.surface }]}>
      <Text style={[styles.tileValue, { color: theme.colors.text }]}>{value}</Text>
      <Text style={[styles.tileLabel, { color: theme.colors.textSecondary }]}>{label}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flexGrow: 1, justifyContent: 'center', padding: 16 },
  card: { borderRadius: 20, borderWidth: 1, padding: 20, gap: 18, width: '100%', maxWidth: 440, alignSelf: 'center' },
  head: { alignItems: 'center', gap: 4 },
  game: { fontSize: 15 },
  title: { fontSize: 24, fontWeight: '700', textAlign: 'center' },
  levelBlock: { alignItems: 'center', gap: 6 },
  levelLine: { fontSize: 18, fontWeight: '600', fontVariant: ['tabular-nums'] },
  improved: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  improvedText: { fontSize: 15, fontWeight: '600' },
  best: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 12, paddingVertical: 10 },
  bestText: { fontSize: 15, fontWeight: '700' },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 10 },
  tile: { width: '48%', borderRadius: 14, paddingVertical: 14, alignItems: 'center', gap: 2 },
  tileValue: { fontSize: 24, fontWeight: '700', fontVariant: ['tabular-nums'] },
  tileLabel: { fontSize: 15 },
  actions: { flexDirection: 'row', gap: 10 },
  action: { flex: 1 },
})
