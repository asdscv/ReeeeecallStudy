import { View, Text, StyleSheet } from 'react-native'
import { useNavigation } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { Screen, Button } from '../components/ui'
import { testProps } from '../utils/testProps'
import { useStudy } from '../hooks/useStudy'
import { useTranslation } from 'react-i18next'
import { useTheme } from '../theme'
import { ratingColors } from '@reeeeecall/shared/design-tokens/colors'
import type { StudyStackParamList } from '../navigation/types'

type Nav = NativeStackNavigationProp<StudyStackParamList, 'StudySummary'>

const RATING_COLORS: Record<string, string> = {
  again: ratingColors.again,
  hard: ratingColors.hard,
  good: ratingColors.good,
  easy: ratingColors.easy,
  missed: ratingColors.again,
  got_it: ratingColors.good,
  unknown: ratingColors.again,
  known: ratingColors.good,
}

export function StudySummaryScreen() {
  const theme = useTheme()
  const { t } = useTranslation('study')
  const navigation = useNavigation<Nav>()
  const { sessionStats, config, reset } = useStudy()

  const { cardsStudied, totalCards, ratings, totalDurationMs } = sessionStats
  const totalRatings = Object.values(ratings).reduce((a, b) => a + b, 0)
  const isCramming = config?.mode === 'cramming'

  // Accuracy for normal modes
  const accuracy = totalRatings > 0
    ? Math.round(((ratings.good ?? 0) + (ratings.easy ?? 0) + (ratings.known ?? 0) + (ratings.got_it ?? 0)) / totalRatings * 100)
    : 0

  const minutes = Math.floor(totalDurationMs / 60000)
  const seconds = Math.floor((totalDurationMs % 60000) / 1000)
  const timeStr = minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`

  const handleStudyAgain = () => {
    reset()
    navigation.replace('StudySetup', {})
  }

  const handleBackToDeck = () => {
    reset()
    navigation.popToTop()
  }

  // Determine which ratings to show
  const ratingKeys = isCramming
    ? ['got_it', 'missed'] as const
    : config?.mode === 'srs'
      ? ['again', 'hard', 'good', 'easy'] as const
      : ['unknown', 'known'] as const

  const ratingLabels: Record<string, string> = {
    again: 'Again', hard: 'Hard', good: 'Good', easy: 'Easy',
    missed: 'Missed', got_it: 'Got It', unknown: 'Unknown', known: 'Known',
  }

  return (
    <Screen testID="study-summary-screen">
      <View style={styles.content}>
        {/* Header — matches web: emoji + heading */}
        <View style={styles.header}>
          <Text style={styles.emoji}>{isCramming ? '⚡' : '🎉'}</Text>
          <Text style={[theme.typography.h1, { color: theme.colors.text, textAlign: 'center' }]}>
            {isCramming ? t('summary.crammingTitle') : t('summary.title')}
          </Text>
        </View>

        {/* Stats — matches web: label + value rows in card */}
        <View style={[styles.summaryCard, { backgroundColor: theme.colors.surfaceElevated, borderColor: theme.colors.border }]}>
          <SummaryRow label={t('summary.cardsStudied')} value={`${cardsStudied} / ${totalCards}`} theme={theme} testID="summary-cards" />
          <SummaryRow label={t('summary.timeSpent')} value={timeStr} theme={theme} testID="summary-time" />
          <SummaryRow
            label={t('summary.avgPerCard')}
            value={cardsStudied > 0 ? `${Math.round(totalDurationMs / cardsStudied / 1000)}s` : '-'}
            theme={theme}
            testID="summary-speed"
          />
          {isCramming && (
            <SummaryRow
              label={t('summary.mastery')}
              value={`${accuracy}%`}
              theme={theme}
              testID="summary-mastery"
              highlight={accuracy >= 80}
            />
          )}

          {/* Rating Distribution — matches web: colored badges */}
          {totalRatings > 0 && (
            <>
              <View style={[styles.divider, { borderTopColor: theme.colors.border }]} />
              <Text style={[theme.typography.caption, { color: theme.colors.textSecondary }]}>{t('summary.ratingDistribution')}</Text>
              <View style={styles.ratingBadges}>
                {ratingKeys.map((key) => {
                  const count = ratings[key] ?? 0
                  if (count === 0) return null
                  return (
                    <View key={key} style={[styles.ratingBadge, { backgroundColor: RATING_COLORS[key] + '20' }]}>
                      <View style={[styles.ratingDot, { backgroundColor: RATING_COLORS[key] }]} />
                      <Text style={[theme.typography.caption, { color: RATING_COLORS[key], fontWeight: '600' }]}>
                        {ratingLabels[key]} {count}
                      </Text>
                    </View>
                  )
                })}
              </View>
            </>
          )}
        </View>

        {/* Actions — matches web */}
        <View style={styles.actions}>
          <Button
            testID="summary-back-to-deck"
            title={t('summary.backToDeck')}
            variant="outline"
            onPress={handleBackToDeck}
          />
          <Button
            testID="summary-study-again"
            title={isCramming ? t('summary.crammingAgain') : t('summary.studyAgain')}
            onPress={handleStudyAgain}
          />
        </View>
      </View>
    </Screen>
  )
}

function SummaryRow({ label, value, theme, testID, highlight }: {
  label: string; value: string; theme: ReturnType<typeof useTheme>; testID: string; highlight?: boolean
}) {
  return (
    <View style={styles.summaryRow} {...testProps(testID)}>
      <Text style={[theme.typography.bodySmall, { color: theme.colors.textSecondary }]}>{label}</Text>
      <Text style={[theme.typography.label, { color: highlight ? ratingColors.good : theme.colors.text }]}>{value}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  content: { flex: 1, gap: 24, paddingVertical: 24 },
  header: { alignItems: 'center', gap: 12 },
  emoji: { fontSize: 56 },
  // Summary card — matches web: white card with stat rows
  summaryCard: { borderRadius: 12, borderWidth: 1, padding: 16, gap: 12 },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  divider: { borderTopWidth: 1, marginVertical: 4 },
  ratingBadges: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  ratingBadge: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20 },
  ratingDot: { width: 8, height: 8, borderRadius: 4 },
  actions: { gap: 10, marginTop: 'auto' },
})
