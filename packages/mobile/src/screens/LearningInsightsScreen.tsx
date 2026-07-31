import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  View, Text, TouchableOpacity, ScrollView, StyleSheet, ActivityIndicator, RefreshControl,
} from 'react-native'
import { useNavigation, type NavigationProp } from '@react-navigation/native'
import { useTranslation } from 'react-i18next'
import { Screen, ScreenHeader } from '../components/ui'
import { useTheme } from '../theme'
import { testProps } from '../utils/testProps'
import { useLearningStore } from '@reeeeecall/shared/stores/learning-store'
import { cardPromptLabel } from '@reeeeecall/shared/lib/card-prompt'
import type { SettingsStackParamList } from '../navigation/types'

/**
 * Learning diagnostics + recommendations — mobile parity with `/learning/insights`.
 *
 * The aggregation is the same pure function both platforms use, so the rule that decides
 * whether this screen is honest is enforced once: NO DATA IS NOT ZERO. 0% accuracy is a real
 * and harsh statement; a learner who has not answered anything must not be shown it.
 *
 * The same rule is why the stats are gated on `insightsGoalId === goalId`: showing one
 * goal's accuracy under another goal's chip is a worse lie than a spinner.
 *
 * Producing recommendations is on an explicit press, because the write REPLACES the pending
 * set server-side — a background refresh would churn what the learner is reading.
 */
const MIN_TOUCH = 44
/** Extends the pressable area without changing layout, as ScreenHeader already does. */
const HIT_SLOP = { top: 8, bottom: 8, left: 8, right: 8 } as const

/**
 * Diagnostics failures reuse the plan screen's error strings: the codes are the same set,
 * and a second copy of "you are not signed in" would only be a second thing to keep in sync.
 */
function insightsErrorKey(code: string): string {
  switch (code) {
    case 'LIMIT_EXCEEDED': return 'today.error.limitExceeded'
    case 'NOT_FOUND': return 'today.error.goalGone'
    case 'INVALID_INPUT': return 'today.error.invalidInput'
    case 'AUTH_REQUIRED': return 'today.error.authRequired'
    case 'FORBIDDEN': return 'today.error.forbidden'
    default: return 'today.error.unknown'
  }
}

export function LearningInsightsScreen() {
  const { t } = useTranslation('learning')
  const { t: tCommon } = useTranslation('common')
  const theme = useTheme()
  const navigation = useNavigation<NavigationProp<SettingsStackParamList>>()
  const {
    goals, goalsLoading, fetchGoals, insights, insightsLoading, insightsGoalId, insightsError,
    fetchInsights, planCards, planTemplateFields,
    recommendations, recommendationBusyId, fetchRecommendations, regenerateRecommendations,
    resolveRecommendation,
  } = useLearningStore()

  const [goalOverrideId, setGoalOverrideId] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  useEffect(() => { void fetchGoals() }, [fetchGoals])

  const active = useMemo(() => goals.filter((g) => g.status === 'active'), [goals])
  const goalId = active.some((g) => g.id === goalOverrideId) ? goalOverrideId : active[0]?.id ?? null

  useEffect(() => { if (goalId) void fetchInsights(goalId) }, [goalId, fetchInsights])
  useEffect(() => { if (goalId) void fetchRecommendations(goalId) }, [goalId, fetchRecommendations])

  const reload = useCallback(async () => {
    if (!goalId) return
    setRefreshing(true)
    try { await Promise.all([fetchInsights(goalId), fetchRecommendations(goalId)]) }
    finally { setRefreshing(false) }
  }, [goalId, fetchInsights, fetchRecommendations])

  /** The numbers belong to `insightsGoalId`; anything else is another goal's data. */
  const shown = insights && insightsGoalId === goalId ? insights : null
  const busy = recommendationBusyId !== null

  const pct = (value: number | null): string =>
    value === null ? t('insights.noData') : `${Math.round(value * 100)}%`
  const seconds = (ms: number | null): string =>
    ms === null ? t('insights.noData') : t('insights.seconds', { count: Math.round(ms / 100) / 10 })

  const stat = (label: string, value: string, testID: string) => (
    <View
      key={label}
      style={[styles.stat, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}
      {...testProps(testID, true)}
    >
      <Text style={[theme.typography.caption, { color: theme.colors.textTertiary }]}>{label}</Text>
      <Text
        style={[theme.typography.bodySmall, { color: theme.colors.text, marginTop: 2 }]}
        {...testProps(`${testID}-value`)}
      >
        {value}
      </Text>
    </View>
  )

  return (
    <Screen padding={false} testID="learning-insights-screen">
      <ScreenHeader title={t('insights.title')} mode="back" />

      <ScrollView
        contentContainerStyle={styles.body}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => void reload()} tintColor={theme.colors.primary} />
        }
      >
        {goalsLoading && goals.length === 0 ? (
          <ActivityIndicator />
        ) : active.length === 0 ? (
          // A paragraph on its own is a dead end. The web page offers the goal screen from
          // this exact state, and the only thing a learner can do here is create a goal.
          <View
            style={[styles.card, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}
            {...testProps('learning-insights-empty', true)}
          >
            <Text style={[theme.typography.bodySmall, { color: theme.colors.textSecondary }]}>
              {t('today.empty.noGoal')}
            </Text>
            <TouchableOpacity
              onPress={() => navigation.navigate('LearningGoals')}
              style={[styles.primaryBtn, { backgroundColor: theme.colors.primary }]}
              accessibilityRole="button"
              {...testProps('learning-insights-create-goal')}
            >
              <Text style={[theme.typography.bodySmall, { color: theme.colors.textInverse }]}>
                {t('today.empty.createGoal')}
              </Text>
            </TouchableOpacity>
          </View>
        ) : (
          <>
            {active.length > 1 && (
              <View style={styles.chipRow}>
                {active.map((option, index) => {
                  const selected = option.id === goalId
                  return (
                    <TouchableOpacity
                      key={option.id}
                      onPress={() => setGoalOverrideId(option.id)}
                      style={[styles.chip, {
                        borderColor: selected ? theme.colors.primary : theme.colors.border,
                        borderWidth: selected ? 2 : 1,
                        backgroundColor: theme.colors.surface,
                      }]}
                      accessibilityRole="button"
                      accessibilityState={{ selected }}
                      {...testProps(`learning-insights-goal-${index}`)}
                    >
                      <Text style={[theme.typography.caption, {
                        color: selected ? theme.colors.primary : theme.colors.textSecondary,
                      }]}>
                        {/* A filled background AND a mark: selection must not be carried by
                            colour alone (WCAG 1.4.1) — a monochrome or colour-blind reading
                            of this row has to still say which goal is selected. */}
                        {selected ? '\u2713 ' : ''}{option.title}
                      </Text>
                    </TouchableOpacity>
                  )
                })}
              </View>
            )}

            {/* A failed load used to render nothing at all: a blank screen with no message
                and no way to retry. */}
            {insightsError && (
              <View
                style={[styles.card, { backgroundColor: theme.colors.surface, borderColor: theme.colors.error }]}
                {...testProps('learning-insights-error', true)}
              >
                <Text style={[theme.typography.bodySmall, { color: theme.colors.error }]}>
                  {t(insightsErrorKey(insightsError.code))}
                </Text>
                <TouchableOpacity
                  onPress={() => void reload()}
                  style={styles.touchRow}
                  accessibilityRole="button"
                  {...testProps('learning-insights-retry')}
                >
                  <Text style={[theme.typography.bodySmall, { color: theme.colors.primary }]}>
                    {tCommon('actions.retry')}
                  </Text>
                </TouchableOpacity>
              </View>
            )}

            {!shown ? (
              insightsError ? null : <ActivityIndicator />
            ) : (
              <>
                <View style={styles.statRow}>
                  {stat(t('insights.attempts'), String(shown.attemptCount), 'learning-insights-attempts')}
                  {stat(t('insights.accuracy'), pct(shown.accuracy), 'learning-insights-accuracy')}
                </View>
                <View style={styles.statRow}>
                  {stat(t('insights.typicalTime'), seconds(shown.medianDurationMs), 'learning-insights-time')}
                  {stat(t('insights.adherence'), pct(shown.overallAdherence), 'learning-insights-adherence')}
                </View>
                {shown.scoredCount === 0 && (
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
                {shown.weakCards.length === 0 ? (
                  <Text style={[theme.typography.bodySmall, { color: theme.colors.textSecondary }]}>
                    {t('insights.weakEmpty')}
                  </Text>
                ) : shown.weakCards.map((card, index) => {
                  const ref = planCards[card.cardId]
                  const label = cardPromptLabel(ref?.field_values, ref?.template_id, planTemplateFields)
                  return (
                    <View
                      key={card.cardId}
                      style={[styles.row, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}
                      {...testProps(`learning-weak-card-${index}`, true)}
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

                {/* Per-day adherence. The overall number above says how much of the plan got
                    done; this says WHICH days, which is the part a habit question needs. It
                    was on web only — the two screens are meant to answer the same question. */}
                <Text style={[theme.typography.bodySmall, { color: theme.colors.text, marginTop: 8 }]}>
                  {t('insights.adherenceTitle')}
                </Text>
                {shown.adherence.length === 0 ? (
                  <Text style={[theme.typography.bodySmall, { color: theme.colors.textSecondary }]}>
                    {t('insights.adherenceEmpty')}
                  </Text>
                ) : shown.adherence.map((day) => (
                  <View
                    key={day.planDate}
                    style={[styles.row, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}
                    {...testProps(`learning-adherence-${day.planDate}`, true)}
                  >
                    <Text style={[theme.typography.caption, { color: theme.colors.text, flex: 1 }]}>
                      {day.planDate}
                    </Text>
                    <Text style={[theme.typography.caption, { color: theme.colors.textTertiary }]}>
                      {day.ratio === null
                        ? t('insights.noPlanItems')
                        : t('insights.dayRatio', {
                          done: day.completedItems,
                          total: day.totalItems,
                          pct: Math.round(day.ratio * 100),
                        })}
                    </Text>
                  </View>
                ))}

                {/* ── Recommendations (mig 174) ── */}
                <View style={styles.sectionHead}>
                  <Text style={[theme.typography.bodySmall, { color: theme.colors.text }]}>
                    {t('recommend.title')}
                  </Text>
                  <TouchableOpacity
                    disabled={shown.weakCards.length === 0 || busy}
                    onPress={() => { if (goalId) void regenerateRecommendations(goalId) }}
                    style={[styles.touchRow, (shown.weakCards.length === 0 || busy) && styles.disabled]}
                    hitSlop={HIT_SLOP}
                    accessibilityRole="button"
                    accessibilityState={{ disabled: shown.weakCards.length === 0 || busy }}
                    {...testProps('learning-recommend-refresh')}
                  >
                    <Text style={[theme.typography.caption, { color: theme.colors.primary }]}>
                      {t('recommend.regenerate')}
                    </Text>
                  </TouchableOpacity>
                </View>
                <Text style={[theme.typography.caption, { color: theme.colors.textTertiary }]}>
                  {t('recommend.hint')}
                </Text>

                {recommendations.length === 0 ? (
                  <Text style={[theme.typography.bodySmall, { color: theme.colors.textSecondary }]}>
                    {t('recommend.empty')}
                  </Text>
                ) : recommendations.map((rec, index) => {
                  const ref = rec.card_id ? planCards[rec.card_id] : undefined
                  const label = cardPromptLabel(ref?.field_values, ref?.template_id, planTemplateFields)
                  return (
                    <View
                      key={rec.id}
                      style={[styles.card, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}
                      {...testProps(`learning-recommendation-${index}`, true)}
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
                          {/* The store takes ONE recommendation write at a time, so every
                              row's buttons go inert while any is in flight. Disabling only
                              the row being written left the others looking tappable while
                              they silently did nothing. */}
                          <TouchableOpacity
                            disabled={busy}
                            onPress={() => void resolveRecommendation(rec.id, 'accepted')}
                            style={[styles.touchRow, busy && styles.disabled]}
                            hitSlop={HIT_SLOP}
                            accessibilityRole="button"
                            accessibilityState={{ disabled: busy }}
                            {...testProps(`learning-recommend-accept-${index}`)}
                          >
                            <Text style={[theme.typography.caption, { color: theme.colors.primary }]}>
                              {recommendationBusyId === rec.id ? t('form.saving') : t('recommend.accept')}
                            </Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            disabled={busy}
                            onPress={() => void resolveRecommendation(rec.id, 'dismissed')}
                            style={[styles.touchRow, busy && styles.disabled]}
                            hitSlop={HIT_SLOP}
                            accessibilityRole="button"
                            accessibilityState={{ disabled: busy }}
                            {...testProps(`learning-recommend-dismiss-${index}`)}
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
  // Chips and inline actions are sized to the platform minimum rather than to their text:
  // iOS HIG asks for 44pt, Material for 48dp, and a 12px caption in 6px of padding is 28.
  chip: {
    paddingHorizontal: 14, minHeight: MIN_TOUCH, borderRadius: 999, borderWidth: 1,
    justifyContent: 'center',
  },
  statRow: { flexDirection: 'row', gap: 8 },
  stat: { flex: 1, padding: 10, borderRadius: 12, borderWidth: 1 },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    padding: 10, borderRadius: 10, borderWidth: 1,
  },
  card: { padding: 10, borderRadius: 10, borderWidth: 1 },
  sectionHead: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 4,
  },
  actionRow: { flexDirection: 'row', gap: 8, marginTop: 2 },
  touchRow: { minHeight: MIN_TOUCH, justifyContent: 'center', paddingHorizontal: 4 },
  primaryBtn: {
    marginTop: 10, minHeight: MIN_TOUCH, paddingVertical: 12, borderRadius: 12,
    alignItems: 'center', justifyContent: 'center',
  },
  // Matches ScreenHeader's own disabled treatment, so "cannot press this" reads the same
  // everywhere instead of being carried by text colour alone.
  disabled: { opacity: 0.5 },
})
