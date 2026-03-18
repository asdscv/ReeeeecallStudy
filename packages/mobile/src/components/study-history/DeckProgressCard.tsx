import { View, Text, StyleSheet } from 'react-native'
import { useTheme } from '../../theme'
import { ProgressBar } from '../charts/ProgressBar'
import { Badge } from '../ui'
import type { ModeBreakdown } from '@reeeeecall/shared/lib/study-history-stats'

interface DeckProgressCardProps {
  deckName: string
  deckIcon: string
  deckColor: string
  totalCards: number
  studiedCards: number
  modes: ModeBreakdown[]
  testID?: string
}

export function DeckProgressCard({ deckName, deckIcon, deckColor, totalCards, studiedCards, modes, testID }: DeckProgressCardProps) {
  const theme = useTheme()
  const pct = totalCards > 0 ? Math.round((studiedCards / totalCards) * 100) : 0

  return (
    <View style={[styles.card, { backgroundColor: theme.colors.surfaceElevated, borderColor: theme.colors.border }]} testID={testID}>
      <View style={styles.titleRow}>
        <View style={[styles.iconBg, { backgroundColor: deckColor + '20' }]}>
          <Text style={styles.emoji}>{deckIcon}</Text>
        </View>
        <View style={styles.titleText}>
          <Text style={[theme.typography.label, { color: theme.colors.text }]} numberOfLines={1}>{deckName}</Text>
          <Text style={[theme.typography.caption, { color: theme.colors.textSecondary }]}>
            {studiedCards}/{totalCards} cards
          </Text>
        </View>
      </View>
      <ProgressBar percentage={pct} />
      {modes.length > 0 && (
        <View style={styles.modesRow}>
          {modes.map((m) => (
            <Badge key={m.mode} label={`${m.mode}: ${m.totalCards}`} variant="neutral" />
          ))}
        </View>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  card: { borderRadius: 12, padding: 14, gap: 10, borderWidth: 1 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  iconBg: { width: 36, height: 36, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  emoji: { fontSize: 18 },
  titleText: { flex: 1, gap: 2 },
  modesRow: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
})
