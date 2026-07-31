import { useEffect, useMemo, useState } from 'react'
import { View, Text, TouchableOpacity, ScrollView, StyleSheet, ActivityIndicator } from 'react-native'
import { useTranslation } from 'react-i18next'
import { Screen, ScreenHeader } from '../components/ui'
import { useTheme } from '../theme'
import { useLearningStore } from '@reeeeecall/shared/stores/learning-store'

/**
 * Learning diagnostics + recommendations — mobile parity with `/learning/insights`.
 *
 * The aggregation is the same pure function both platforms use, so the rule that decides
 * whether this screen is honest is enforced once: NO DATA IS NOT ZERO. 0% accuracy is a real
 * and harsh statement; a learner who has not answered anything must not be shown it.
 *
 * Producing recommendations is on an explicit press, because the write REPLACES the pending
 * set server-side — a background refresh would churn what the learner is reading.
 */
export function LearningInsightsScreen() {
  const { t } = useTranslation('learning')
  const theme = useTheme()
  const {
    goals, goalsLoading, fetchGoals, insights, insightsLoading, fetchInsights, planCards,
    recommendations, recommendationBusyId, fetchRecommendations, regenerateRecommendations,
    resolveRecommendation,
  } = useLearningStore()

  const [goalOverrideId, setGoalOverrideId] = useState<string | null>(null)

  useEffect(() => { void fetchGoals() }, [fetchGoals])

  const active = useMemo(() => goals.filter((g) => g.status === 'active'), [goals])
  const goalId = active.some((g) => g.id === goalOverrideId) ? goalOverrideId : active[0]?.id ?? null

  useEffect(() => { if (goalId) void fetchInsights(goalId) }, [goalId, fetchInsights])
  useEffect(() => { if (goalId) void fetchRecommendations(goalId) }, [goalId, fetchRecommendations])

  const pct = (value: number | null): string =>
    value === null ? t('insights.noData') : `${Math.round(value * 100)}%`
  const seconds = (ms: number | null): string =>
    ms === null ? t('insights.noData') : t('insights.seconds', { count: Math.round(ms / 100) / 10 })

  const stat = (label: string, value: string) => (
    <View
      key={label}
      style={[styles.stat, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}
    >
      <Text style={[theme.typography.caption, { color: theme.colors.textTertiary }]}>{label}</Text>
      <Text style={[theme.typography.bodySmall, { color: theme.colors.text, marginTop: 2 }]}>{value}</Text>
    </View>
  )

  return (
    <Screen>
      <ScreenHeader title={t('insights.title')} mode="back" />

      <ScrollView contentContainerStyle={styles.body}>
        {goalsLoading && goals.length === 0 ? (
          <ActivityIndicator />
        ) : active.length === 0 ? (
          <Text style={[theme.typography.bodySmall, { color: theme.colors.textSecondary }]}>
            {t('today.empty.noGoal')}
          </Text>
        ) : (
          <>
            {active.length > 1 && (
              <View style={styles.chipRow}>
                {active.map((option) => (
                  <TouchableOpacity
                    key={option.id}
                    onPress={() => setGoalOverrideId(option.id)}
                    style={[styles.chip, {
                      borderColor: option.id === goalId ? theme.colors.primary : theme.colors.border,
                    }]}
                  >
                    <Text style={[theme.typography.caption, {
                      color: option.id === goalId ? theme.colors.primary : theme.colors.textSecondary,
                    }]}>{option.title}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}

            {insightsLoading && !insights ? (
              <ActivityIndicator />
            ) : !insights ? null : (
              <>
                <View style={styles.statRow}>
                  {stat(t('insights.attempts'), String(insights.attemptCount))}
                  {stat(t('insights.accuracy'), pct(insights.accuracy))}
                </View>
                <View style={styles.statRow}>
                  {stat(t('insights.typicalTime'), seconds(insights.medianDurationMs))}
                  {stat(t('insights.adherence'), pct(insights.overallAdherence))}
                </View>
                {insights.scoredCount === 0 && (
                  <Text style={[theme.typography.caption, { color: theme.colors.textTertiary }]}>
                    {t('insights.notScoredYet')}
                  </Text>
                )}

                <Text style={[theme.typography.bodySmall, { color: theme.colors.text, marginTop: 8 }]}>
                  {t('insights.weakTitle')}
                </Text>
                <Text style={[theme.typography.caption, { color: theme.colors.textTertiary }]}>
                  {t('insights.weakHint')}
                </Text>
                {insights.weakCards.length === 0 ? (
                  <Text style={[theme.typography.bodySmall, { color: theme.colors.textSecondary }]}>
                    {t('insights.weakEmpty')}
                  </Text>
                ) : insights.weakCards.map((card) => {
                  const ref = planCards[card.cardId]
                  const label = ref ? Object.values(ref.field_values)[0] ?? '' : ''
                  return (
                    <View
                      key={card.cardId}
                      style={[styles.row, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}
                    >
                      <Text style={[theme.typography.caption, { color: theme.colors.text, flex: 1 }]} numberOfLines={1}>
                        {label || t('insights.cardFallback')}
                      </Text>
                      <Text style={[theme.typography.caption, { color: theme.colors.textTertiary }]}>
                        {pct(card.meanScore)} · {t('insights.attemptCount', { count: card.attempts })}
                      </Text>
                    </View>
                  )
                })}

                {/* ── Recommendations (mig 174) ── */}
                <View style={styles.sectionHead}>
                  <Text style={[theme.typography.bodySmall, { color: theme.colors.text }]}>
                    {t('recommend.title')}
                  </Text>
                  <TouchableOpacity
                    disabled={insights.weakCards.length === 0}
                    onPress={() => { if (goalId) void regenerateRecommendations(goalId) }}
                    testID="learning-recommend-refresh"
                  >
                    <Text style={[theme.typography.caption, {
                      color: insights.weakCards.length === 0 ? theme.colors.textTertiary : theme.colors.primary,
                    }]}>{t('recommend.regenerate')}</Text>
                  </TouchableOpacity>
                </View>
                <Text style={[theme.typography.caption, { color: theme.colors.textTertiary }]}>
                  {t('recommend.hint')}
                </Text>

                {recommendations.length === 0 ? (
                  <Text style={[theme.typography.bodySmall, { color: theme.colors.textSecondary }]}>
                    {t('recommend.empty')}
                  </Text>
                ) : recommendations.map((rec) => {
                  const ref = rec.card_id ? planCards[rec.card_id] : undefined
                  const label = ref ? Object.values(ref.field_values)[0] ?? '' : ''
                  return (
                    <View
                      key={rec.id}
                      style={[styles.card, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}
                    >
                      <Text style={[theme.typography.caption, { color: theme.colors.text }]} numberOfLines={1}>
                        {label || t('insights.cardFallback')}
                      </Text>
                      {rec.reason && (
                        <Text style={[theme.typography.caption, { color: theme.colors.textTertiary }]}>
                          {rec.reason}
                        </Text>
                      )}
                      {rec.status === 'pending' ? (
                        <View style={styles.actionRow}>
                          <TouchableOpacity
                            disabled={recommendationBusyId === rec.id}
                            onPress={() => void resolveRecommendation(rec.id, 'accepted')}
                          >
                            <Text style={[theme.typography.caption, { color: theme.colors.primary }]}>
                              {t('recommend.accept')}
                            </Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            disabled={recommendationBusyId === rec.id}
                            onPress={() => void resolveRecommendation(rec.id, 'dismissed')}
                          >
                            <Text style={[theme.typography.caption, { color: theme.colors.textTertiary }]}>
                              {t('recommend.dismiss')}
                            </Text>
                          </TouchableOpacity>
                        </View>
                      ) : (
                        // The decision is terminal server-side, so no action is offered that
                        // would come back as a conflict.
                        <Text style={[theme.typography.caption, { color: theme.colors.textTertiary, marginTop: 4 }]}>
                          {t(`recommend.status.${rec.status}`)}
                        </Text>
                      )}
                    </View>
                  )
                })}

                <Text style={[theme.typography.caption, { color: theme.colors.textTertiary, marginTop: 8 }]}>
                  {t('insights.scopeNote')}
                </Text>
              </>
            )}
          </>
        )}
      </ScrollView>
    </Screen>
  )
}

const styles = StyleSheet.create({
  body: { padding: 16, gap: 8, paddingBottom: 48 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, borderWidth: 1 },
  statRow: { flexDirection: 'row', gap: 8 },
  stat: { flex: 1, padding: 10, borderRadius: 12, borderWidth: 1 },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    padding: 10, borderRadius: 10, borderWidth: 1,
  },
  card: { padding: 10, borderRadius: 10, borderWidth: 1 },
  sectionHead: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 12,
  },
  actionRow: { flexDirection: 'row', gap: 16, marginTop: 6 },
})
