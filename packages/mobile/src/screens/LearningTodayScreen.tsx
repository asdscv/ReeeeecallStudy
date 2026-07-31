import { useEffect, useMemo, useState } from 'react'
import { View, Text, TouchableOpacity, ScrollView, StyleSheet, ActivityIndicator } from 'react-native'
import { useNavigation, type NavigationProp } from '@react-navigation/native'
import { useTranslation } from 'react-i18next'
import { Screen, ScreenHeader } from '../components/ui'
import { useTheme } from '../theme'
import { useLearningStore } from '@reeeeecall/shared/stores/learning-store'
import { currentPlanContext } from '@reeeeecall/shared/lib/learning-plan-date'
import * as Crypto from 'expo-crypto'
import type { SettingsStackParamList } from '../navigation/types'

/**
 * Today's plan — mobile parity with the web `/learning` screen.
 *
 * The same shared store drives both, so the rules that matter are already enforced there
 * and are NOT re-implemented here:
 *   * plan generation happens on an explicit press, never in an effect (`save_daily_plan`
 *     is capped at 50 writes per user per day);
 *   * a self-rating records an attempt and does NOT reschedule the card — SRS stays with
 *     the study screen's rating;
 *   * an enrichment request spends real credits, so the label says so before the press.
 *
 * The one thing mobile must do differently is the plan date: `currentPlanContext` computes
 * it from the device's local calendar and falls back to a UTC-offset label when the Hermes
 * build has no ICU, instead of importing `Intl` (see shared/lib/learning-plan-date).
 */
const SELF_RATINGS: ReadonlyArray<{ score: number; key: string }> = [
  { score: 0, key: 'today.rate.again' },
  { score: 0.5, key: 'today.rate.partial' },
  { score: 1, key: 'today.rate.known' },
]

const REASON_KEY: Record<string, string> = {
  due: 'today.reason.due',
  recent_failure: 'today.reason.recentFailure',
  slow_response: 'today.reason.slowResponse',
  goal_relevance: 'today.reason.goalRelevance',
  importance: 'today.reason.importance',
  balanced: 'today.reason.balanced',
}

export function LearningTodayScreen() {
  const { t, i18n } = useTranslation('learning')
  const theme = useTheme()
  const navigation = useNavigation<NavigationProp<SettingsStackParamList>>()
  const {
    goals, goalsLoading, fetchGoals,
    plan, planItems, planCards, planLoading, planGenerating, planError, planBlockedReason,
    recordingItemId, fetchPlan, generatePlan, recordAttempt,
    enrichment, enrichmentPendingCardId, enrichmentError, requestEnrichment,
    resolveEnrichment, dismissEnrichment,
  } = useLearningStore()

  const [goalOverrideId, setGoalOverrideId] = useState<string | null>(null)
  const ctx = useMemo(() => currentPlanContext(), [])

  useEffect(() => { void fetchGoals() }, [fetchGoals])

  const active = useMemo(() => goals.filter((g) => g.status === 'active'), [goals])
  const goalId = active.some((g) => g.id === goalOverrideId) ? goalOverrideId : active[0]?.id ?? null
  const goal = active.find((g) => g.id === goalId)

  useEffect(() => {
    if (goalId) void fetchPlan(goalId, ctx.planDate)
  }, [goalId, ctx.planDate, fetchPlan])

  const errorKey = (code: string): string => {
    switch (code) {
      case 'LIMIT_EXCEEDED': return 'today.error.limitExceeded'
      case 'CONFLICT': return 'today.error.completedPlan'
      case 'NOT_FOUND': return 'today.error.goalGone'
      case 'INVALID_INPUT': return 'today.error.invalidInput'
      case 'AUTH_REQUIRED': return 'today.error.authRequired'
      case 'FORBIDDEN': return 'today.error.forbidden'
      default: return 'today.error.unknown'
    }
  }

  return (
    <Screen>
      <ScreenHeader
        title={t('today.title')}
        mode="drawer"
        rightContent={
          <TouchableOpacity onPress={() => navigation.navigate('LearningGoals')} testID="learning-manage-goals">
            <Text style={[theme.typography.caption, { color: theme.colors.primary }]}>
              {t('today.manageGoals')}
            </Text>
          </TouchableOpacity>
        }
      />

      <ScrollView contentContainerStyle={styles.body}>
        {goalsLoading && goals.length === 0 ? (
          <ActivityIndicator />
        ) : active.length === 0 ? (
          <View style={[styles.card, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
            <Text style={[theme.typography.bodySmall, { color: theme.colors.textSecondary }]}>
              {t('today.empty.noGoal')}
            </Text>
            <TouchableOpacity
              onPress={() => navigation.navigate('LearningGoals')}
              style={[styles.primaryBtn, { backgroundColor: theme.colors.primary }]}
              testID="learning-create-goal"
            >
              <Text style={[theme.typography.bodySmall, { color: '#fff' }]}>{t('today.empty.createGoal')}</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <>
            {active.length > 1 && (
              <View style={styles.goalRow}>
                {active.map((option) => (
                  <TouchableOpacity
                    key={option.id}
                    onPress={() => setGoalOverrideId(option.id)}
                    style={[styles.chip, {
                      borderColor: option.id === goalId ? theme.colors.primary : theme.colors.border,
                      backgroundColor: theme.colors.surface,
                    }]}
                  >
                    <Text style={[theme.typography.caption, {
                      color: option.id === goalId ? theme.colors.primary : theme.colors.textSecondary,
                    }]}>{option.title}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}

            {goal && (
              <View style={[styles.card, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
                <Text style={[theme.typography.bodySmall, { color: theme.colors.text }]}>{goal.title}</Text>
                <Text style={[theme.typography.caption, { color: theme.colors.textTertiary, marginTop: 2 }]}>
                  {t('today.budget', { count: goal.daily_minutes })}
                  {plan ? ` · ${t('today.progress', { done: plan.completed_items, total: plan.total_items })}` : ''}
                </Text>
              </View>
            )}

            {planError && (
              <Text style={[theme.typography.caption, { color: theme.colors.error }]} testID="learning-plan-error">
                {t(errorKey(planError.code))}
              </Text>
            )}
            {enrichmentError && (
              <Text style={[theme.typography.caption, { color: theme.colors.error }]} testID="learning-enrichment-error">
                {t(`enrichment.error.${enrichmentError}`)}
              </Text>
            )}

            {planBlockedReason === 'no_decks' && (
              <Text style={[theme.typography.bodySmall, { color: theme.colors.textSecondary }]}>
                {t('today.empty.noDecks')}
              </Text>
            )}
            {planBlockedReason === 'no_candidates' && (
              <Text style={[theme.typography.bodySmall, { color: theme.colors.textSecondary }]}>
                {t('today.empty.nothingDue')}
              </Text>
            )}

            {planLoading ? (
              <ActivityIndicator />
            ) : plan ? (
              <>
                {planItems.map((item) => {
                  const card = item.card_id ? planCards[item.card_id] : undefined
                  const label = card ? Object.values(card.field_values)[0] ?? '' : ''
                  const done = item.status === 'completed'
                  return (
                    <View
                      key={item.id}
                      style={[styles.card, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}
                    >
                      <Text
                        style={[theme.typography.bodySmall, {
                          color: done ? theme.colors.textTertiary : theme.colors.text,
                          textDecorationLine: done ? 'line-through' : 'none',
                        }]}
                        numberOfLines={2}
                      >
                        {label || t('today.item.untitled')}
                      </Text>
                      <Text style={[theme.typography.caption, { color: theme.colors.textTertiary, marginTop: 2 }]}>
                        {t(REASON_KEY[item.reason_code] ?? 'today.reason.balanced')}
                      </Text>

                      {done ? (
                        <Text style={[theme.typography.caption, { color: theme.colors.success, marginTop: 6 }]}>
                          {t('today.item.recorded')}
                        </Text>
                      ) : (
                        <>
                          <View style={styles.rateRow}>
                            {SELF_RATINGS.map((rating) => (
                              <TouchableOpacity
                                key={rating.key}
                                disabled={recordingItemId === item.id}
                                onPress={() => {
                                  if (!goalId) return
                                  void recordAttempt({
                                    planItem: item,
                                    goalId,
                                    score: rating.score,
                                    clientAttemptId: Crypto.randomUUID(),
                                  }, ctx.planDate)
                                }}
                                style={[styles.rateBtn, { borderColor: theme.colors.border }]}
                              >
                                <Text style={[theme.typography.caption, { color: theme.colors.text }]}>
                                  {t(rating.key)}
                                </Text>
                              </TouchableOpacity>
                            ))}
                          </View>
                          <Text style={[theme.typography.caption, { color: theme.colors.textTertiary, marginTop: 4 }]}>
                            {t('today.rate.hint')}
                          </Text>
                        </>
                      )}

                      {item.card_id && goalId && (
                        <TouchableOpacity
                          disabled={enrichmentPendingCardId === item.card_id}
                          onPress={() => void requestEnrichment({
                            action: 'explain', goalId, cardId: item.card_id as string, uiLang: i18n.language,
                          })}
                          style={{ marginTop: 8 }}
                        >
                          <Text style={[theme.typography.caption, { color: theme.colors.primary }]}>
                            {enrichmentPendingCardId === item.card_id
                              ? t('enrichment.requesting')
                              : `${t('enrichment.explainCta')} · ${t('enrichment.costHint')}`}
                          </Text>
                        </TouchableOpacity>
                      )}
                    </View>
                  )
                })}

                <TouchableOpacity
                  disabled={planGenerating || plan.status === 'completed'}
                  onPress={() => { if (goal) void generatePlan(goal, ctx) }}
                  style={[styles.secondaryBtn, { borderColor: theme.colors.border }]}
                  testID="learning-regenerate"
                >
                  <Text style={[theme.typography.bodySmall, { color: theme.colors.text }]}>
                    {planGenerating ? t('today.regenerating') : t('today.regenerate')}
                  </Text>
                </TouchableOpacity>
              </>
            ) : !planBlockedReason ? (
              <TouchableOpacity
                disabled={planGenerating || !goal}
                onPress={() => { if (goal) void generatePlan(goal, ctx) }}
                style={[styles.primaryBtn, { backgroundColor: theme.colors.primary }]}
                testID="learning-generate"
              >
                <Text style={[theme.typography.bodySmall, { color: '#fff' }]}>
                  {planGenerating ? t('today.generating') : t('today.generate')}
                </Text>
              </TouchableOpacity>
            ) : null}
          </>
        )}
      </ScrollView>

      {/* Enrichment preview. The charge already happened, so this asks whether to KEEP the
          result — it never implies that discarding refunds anything. */}
      {enrichment && (
        <View style={[styles.sheet, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
          <ScrollView style={{ maxHeight: 320 }}>
            {Object.entries(enrichment.content)
              .filter(([key]) => key !== 'sources')
              .map(([key, value]) => (
                <View key={key} style={{ marginBottom: 8 }}>
                  <Text style={[theme.typography.caption, { color: theme.colors.textTertiary }]}>{key}</Text>
                  <Text style={[theme.typography.bodySmall, { color: theme.colors.text }]}>
                    {Array.isArray(value)
                      ? value.map((v) => (typeof v === 'object' && v !== null
                        ? Object.values(v as Record<string, unknown>).filter((x) => typeof x === 'string').join(' — ')
                        : String(v))).join('\n')
                      : typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value)}
                  </Text>
                </View>
              ))}
            <Text style={[theme.typography.caption, { color: theme.colors.textTertiary }]}>
              {t('enrichment.sources')}
            </Text>
            {enrichment.sources.length === 0 ? (
              <Text style={[theme.typography.caption, { color: theme.colors.textTertiary }]}>
                {t('enrichment.noSources')}
              </Text>
            ) : enrichment.sources.map((source, i) => (
              <Text key={i} style={[theme.typography.caption, { color: theme.colors.text }]}>
                {source.title || source.clause || source.id}
                {source.clause && source.title ? ` · ${source.clause}` : ''}
              </Text>
            ))}
            <Text style={[theme.typography.caption, { color: theme.colors.textTertiary, marginTop: 6 }]}>
              {t('enrichment.chargedNote')}
            </Text>
          </ScrollView>
          <View style={styles.sheetActions}>
            <TouchableOpacity onPress={dismissEnrichment}>
              <Text style={[theme.typography.caption, { color: theme.colors.textTertiary }]}>
                {t('enrichment.later')}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => void resolveEnrichment('rejected')}>
              <Text style={[theme.typography.bodySmall, { color: theme.colors.textSecondary }]}>
                {t('enrichment.discard')}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => void resolveEnrichment('accepted')}>
              <Text style={[theme.typography.bodySmall, { color: theme.colors.primary }]}>
                {t('enrichment.keep')}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
    </Screen>
  )
}

const styles = StyleSheet.create({
  body: { padding: 16, gap: 10, paddingBottom: 48 },
  card: { padding: 12, borderRadius: 12, borderWidth: 1 },
  goalRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, borderWidth: 1 },
  rateRow: { flexDirection: 'row', gap: 6, marginTop: 8 },
  rateBtn: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, borderWidth: 1 },
  primaryBtn: { marginTop: 10, paddingVertical: 12, borderRadius: 12, alignItems: 'center' },
  secondaryBtn: { marginTop: 4, paddingVertical: 12, borderRadius: 12, borderWidth: 1, alignItems: 'center' },
  sheet: {
    position: 'absolute', left: 12, right: 12, bottom: 12,
    padding: 12, borderRadius: 16, borderWidth: 1,
  },
  sheetActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 16, marginTop: 10 },
})
