import { View, Text, StyleSheet } from 'react-native'
import { useTranslation } from 'react-i18next'
import { formatCount } from '@reeeeecall/shared/lib/format-number'
import { displayLevel, type BrainGameId } from '@reeeeecall/shared/lib/brain-games'
import type { SessionStats } from '@reeeeecall/shared/hooks/useBrainSession'
import { Button } from '../ui'
import { useTheme } from '../../theme'
import { testProps } from '../../utils/testProps'

export function BrainSummaryView({ stats, onAgain, onHome }: { stats: SessionStats; onAgain: () => void; onHome: () => void }) {
  const theme = useTheme()
  const { t } = useTranslation('brain')
  const accuracy = stats.rounds > 0 ? Math.round((stats.correct / stats.rounds) * 100) : 0
  const levels = Object.entries(stats.levels) as [BrainGameId, { start: number; now: number }][]
  const tile = { backgroundColor: theme.colors.surface }
  return (
    <View style={styles.root}>
      <View style={[styles.card, { backgroundColor: theme.colors.surfaceElevated, borderColor: theme.colors.border }]} {...testProps('brain-summary', true)}>
        <Text style={[styles.title, { color: theme.colors.text }]}>{t('summary.title')}</Text>
        <View style={styles.tiles}>
          {[
            [t('summary.rounds'), formatCount(stats.rounds)],
            [t('summary.accuracy'), `${accuracy}%`],
            [t('summary.points'), formatCount(stats.points)],
            [t('summary.bestStreak'), formatCount(stats.bestStreak)],
          ].map(([label, value]) => (
            <View key={label} style={[styles.tile, tile]}>
              <Text style={{ fontSize: 22, fontWeight: '700', color: theme.colors.text }}>{value}</Text>
              <Text style={{ fontSize: 12, color: theme.colors.textTertiary }}>{label}</Text>
            </View>
          ))}
        </View>
        {levels.length > 0 ? (
          <View style={{ gap: 4 }}>
            <Text style={{ fontSize: 12, color: theme.colors.textTertiary, marginBottom: 2 }}>{t('summary.levels')}</Text>
            {levels.map(([id, l]) => {
              const from = displayLevel(l.start)
              const to = displayLevel(l.now)
              const color = to > from ? theme.colors.success : to < from ? theme.colors.error : theme.colors.textSecondary
              return (
                <View key={id} style={styles.levelRow}>
                  <Text style={{ fontSize: 14, color: theme.colors.text }}>{t(`games.${id}.name`)}</Text>
                  <Text style={{ fontSize: 14, color }}>Lv. {from} → {to}</Text>
                </View>
              )
            })}
          </View>
        ) : null}
        <View style={styles.actions}>
          <Button title={t('summary.home')} variant="outline" onPress={onHome} style={{ flex: 1 }} />
          <Button title={t('summary.again')} onPress={onAgain} style={{ flex: 1 }} testID="brain-again" />
        </View>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'center', paddingHorizontal: 16 },
  card: { borderRadius: 16, borderWidth: 1, padding: 20, gap: 16 },
  title: { fontSize: 20, fontWeight: '700', textAlign: 'center' },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 10 },
  tile: { width: '48%', borderRadius: 12, paddingVertical: 12, alignItems: 'center' },
  levelRow: { flexDirection: 'row', justifyContent: 'space-between' },
  actions: { flexDirection: 'row', gap: 10 },
})
