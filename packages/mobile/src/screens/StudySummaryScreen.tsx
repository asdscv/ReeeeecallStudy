import { View, Text, StyleSheet } from 'react-native'
import { useNavigation } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { Screen, Button } from '../components/ui'
import { testProps } from '../utils/testProps'
import { useStudy } from '../hooks/useStudy'
import { useTheme } from '../theme'
import type { StudyStackParamList } from '../navigation/types'

type Nav = NativeStackNavigationProp<StudyStackParamList, 'StudySummary'>

const RATING_COLORS: Record<string, string> = {
  again: '#EF4444',
  hard: '#F59E0B',
  good: '#22C55E',
  easy: '#3B82F6',
}

export function StudySummaryScreen() {
  const theme = useTheme()
  const navigation = useNavigation<Nav>()
  const { sessionStats, reset } = useStudy()

  const { cardsStudied, totalCards, ratings, totalDurationMs } = sessionStats
  const totalRatings = Object.values(ratings).reduce((a, b) => a + b, 0)
  const accuracy = totalRatings > 0
    ? Math.round(((ratings.good ?? 0) + (ratings.easy ?? 0)) / totalRatings * 100)
    : 0

  const minutes = Math.floor(totalDurationMs / 60000)
  const seconds = Math.floor((totalDurationMs % 60000) / 1000)
  const timeStr = minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`

  const handleStudyAgain = () => {
    reset()
    navigation.replace('StudySetup', {})
  }

  const handleDone = () => {
    reset()
    navigation.popToTop()
  }

  return (
    <Screen testID="study-summary-screen">
      <View style={styles.content}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.emoji}>🎉</Text>
          <Text style={[theme.typography.h1, { color: theme.colors.text, textAlign: 'center' }]}>
            Session Complete!
          </Text>
        </View>

        {/* Stats Grid */}
        <View style={styles.statsGrid}>
          <StatBox
            label="Cards Studied"
            value={`${cardsStudied}/${totalCards}`}
            theme={theme}
            testID="summary-cards"
          />
          <StatBox
            label="Accuracy"
            value={`${accuracy}%`}
            theme={theme}
            testID="summary-accuracy"
          />
          <StatBox
            label="Time"
            value={timeStr}
            theme={theme}
            testID="summary-time"
          />
          <StatBox
            label="Speed"
            value={cardsStudied > 0 ? `${Math.round(totalDurationMs / cardsStudied / 1000)}s/card` : '-'}
            theme={theme}
            testID="summary-speed"
          />
        </View>

        {/* Rating Distribution */}
        <View style={styles.section}>
          <Text style={[theme.typography.h3, { color: theme.colors.text }]}>Rating Distribution</Text>
          <View style={styles.ratingBars}>
            {(['again', 'hard', 'good', 'easy'] as const).map((rating) => {
              const count = ratings[rating] ?? 0
              const pct = totalRatings > 0 ? (count / totalRatings) * 100 : 0
              return (
                <View key={rating} style={styles.ratingBarRow}>
                  <Text style={[theme.typography.labelSmall, { color: theme.colors.text, width: 50, textTransform: 'capitalize' }]}>
                    {rating}
                  </Text>
                  <View style={[styles.barBg, { backgroundColor: theme.colors.surface }]}>
                    <View style={[styles.barFill, { width: `${pct}%`, backgroundColor: RATING_COLORS[rating] }]} />
                  </View>
                  <Text style={[theme.typography.caption, { color: theme.colors.textSecondary, width: 30, textAlign: 'right' }]}>
                    {count}
                  </Text>
                </View>
              )
            })}
          </View>
        </View>

        {/* Actions */}
        <View style={styles.actions}>
          <Button
            testID="summary-study-again"
            title="Study Again"
            onPress={handleStudyAgain}
          />
          <Button
            testID="summary-done"
            title="Done"
            variant="secondary"
            onPress={handleDone}
          />
        </View>
      </View>
    </Screen>
  )
}

function StatBox({ label, value, theme, testID }: {
  label: string; value: string; theme: ReturnType<typeof useTheme>; testID: string
}) {
  return (
    <View style={[styles.statBox, { backgroundColor: theme.colors.surface }]} {...testProps(testID)}>
      <Text style={[theme.typography.h2, { color: theme.colors.text }]}>{value}</Text>
      <Text style={[theme.typography.caption, { color: theme.colors.textSecondary }]}>{label}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  content: { flex: 1, gap: 24, paddingVertical: 24 },
  header: { alignItems: 'center', gap: 12 },
  emoji: { fontSize: 56 },
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  statBox: { width: '47%', borderRadius: 12, padding: 16, alignItems: 'center', gap: 4 },
  section: { gap: 12 },
  ratingBars: { gap: 8 },
  ratingBarRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  barBg: { flex: 1, height: 8, borderRadius: 4, overflow: 'hidden' },
  barFill: { height: '100%', borderRadius: 4 },
  actions: { gap: 10, marginTop: 'auto' },
})
