import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  View, Text, TouchableOpacity, ScrollView, StyleSheet, ActivityIndicator, RefreshControl,
  AppState, Modal, Pressable,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useNavigation, type NavigationProp } from '@react-navigation/native'
import { useTranslation } from 'react-i18next'
import { Screen, ScreenHeader } from '../components/ui'
import { useTheme } from '../theme'
import { testProps } from '../utils/testProps'
import { useLearningStore } from '@reeeeecall/shared/stores/learning-store'
import { currentPlanContext } from '@reeeeecall/shared/lib/learning-plan-date'
import { cardPromptLabel } from '@reeeeecall/shared/lib/card-prompt'
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
 *
 * And because a phone screen is usually resumed rather than opened, the plan date is kept
 * live instead of being frozen at mount — see `planDate` below.
 */
const SELF_RATINGS: ReadonlyArray<{ score: number; key: string; id: string }> = [
  { score: 0, key: 'today.rate.again', id: 'again' },
  { score: 0.5, key: 'today.rate.partial', id: 'partial' },
  { score: 1, key: 'today.rate.known', id: 'known' },
]

const REASON_KEY: Record<string, string> = {
  due: 'today.reason.due',
  recent_failure: 'today.reason.recentFailure',
  slow_response: 'today.reason.slowResponse',
  goal_relevance: 'today.reason.goalRelevance',
  importance: 'today.reason.importance',
  balanced: 'today.reason.balanced',
}

const MIN_TOUCH = 44
const HIT_SLOP = { top: 8, bottom: 8, left: 8, right: 8 } as const

export function LearningTodayScreen() {
  const { t, i18n } = useTranslation('learning')
  const { t: tCommon } = useTranslation('common')
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const navigation = useNavigation<NavigationProp<SettingsStackParamList>>()
  const {
    goals, goalsLoading, fetchGoals,
    plan, planItems, planCards, planTemplateFields, planLoading, planGenerating, planError,
    planBlockedReason,
    recordingItemId, fetchPlan, generatePlan, recordAttempt,
    enrichment, enrichmentPendingCardId, enrichmentError, requestEnrichment,
    resolveEnrichment, dismissEnrichment,
  } = useLearningStore()

  const [goalOverrideId, setGoalOverrideId] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  /**
   * The plan date, kept live.
   *
   * Freezing it at mount was wrong on a phone: this screen is normally resumed, not opened,
   * so an app left overnight kept asking for YESTERDAY's plan and a rating would have been
   * recorded against it. The state only changes when the calendar date actually changes, so
   * the fetch effect below does not re-run on every tick.
   */
  const [planDate, setPlanDate] = useState(() => currentPlanContext().planDate)
  useEffect(() => {
    const sync = () => setPlanDate((prev) => {
      const next = currentPlanContext().planDate
      return next === prev ? prev : next
    })
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') sync()
    })
    // Also catches a rollover while the screen simply stays open.
    const timer = setInterval(sync, 60_000)
    return () => { subscription.remove(); clearInterval(timer) }
  }, [])

  useEffect(() => { void fetchGoals() }, [fetchGoals])

  const active = useMemo(() => goals.filter((g) => g.status === 'active'), [goals])
  const goalId = active.some((g) => g.id === goalOverrideId) ? goalOverrideId : active[0]?.id ?? null
  const goal = active.find((g) => g.id === goalId)

  useEffect(() => {
    if (goalId) void fetchPlan(goalId, planDate)
  }, [goalId, planDate, fetchPlan])

  const reload = useCallback(async () => {
    if (!goalId) return
    setRefreshing(true)
    try { await fetchPlan(goalId, planDate) } finally { setRefreshing(false) }
  }, [goalId, planDate, fetchPlan])

  /**
   * Generation reads a FRESH context, never the rendered one: `ctx.now` is the due-card
   * cutoff, and reusing a value captured minutes ago would plan against a stale clock.
   */
  const regenerate = useCallback(() => {
    if (goal) void generatePlan(goal, currentPlanContext())
  }, [goal, generatePlan])

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
    <Screen padding={false} testID="learning-today-screen">
      <ScreenHeader
        title={t('today.title')}
        mode="drawer"
        rightContent={
          <View style={styles.headerActions}>
            <TouchableOpacity
              onPress={() => navigation.navigate('LearningInsights')}
              style={styles.headerLink}
              hitSlop={HIT_SLOP}
              accessibilityRole="button"
              {...testProps('learning-insights-link')}
            >
              <Text style={[theme.typography.caption, { color: theme.colors.primary }]}>
                {t('today.insightsLink')}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => navigation.navigate('LearningGoals')}
              style={styles.headerLink}
              hitSlop={HIT_SLOP}
              accessibilityRole="button"
              {...testProps('learning-manage-goals')}
            >
              <Text style={[theme.typography.caption, { color: theme.colors.primary }]}>
                {t('today.manageGoals')}
              </Text>
            </TouchableOpacity>
          </View>
        }
      />

      <ScrollView
        contentContainerStyle={styles.body}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => void reload()} tintColor={theme.colors.primary} />
        }
      >
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
              <Text style={[theme.typography.bodySmall, { color: theme.colors.textInverse }]}>{t('today.empty.createGoal')}</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <>
            {active.length > 1 && (
              <View style={styles.goalRow}>
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
                      {...testProps(`learning-today-goal-${index}`)}
                    >
                      <Text style={[theme.typography.caption, {
                        color: selected ? theme.colors.primary : theme.colors.textSecondary,
                      }]}>
                        {selected ? '\u2713 ' : ''}{option.title}
                      </Text>
                    </TouchableOpacity>
                  )
                })}
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
              <View
                style={[styles.card, { backgroundColor: theme.colors.surface, borderColor: theme.colors.error }]}
                {...testProps('learning-plan-error', true)}
              >
                <Text style={[theme.typography.bodySmall, { color: theme.colors.error }]}>
                  {t(errorKey(planError.code))}
                </Text>
                {/* A code alone is not a next step. LIMIT_EXCEEDED is the one failure a retry
                    cannot help with — the cap is per day — so it is the one case with no
                    button, instead of a button that is guaranteed to fail again. */}
                {planError.code !== 'LIMIT_EXCEEDED' && (
                  <TouchableOpacity
                    onPress={() => void reload()}
                    style={styles.touchRow}
                    hitSlop={HIT_SLOP}
                    accessibilityRole="button"
                    {...testProps('learning-plan-retry')}
                  >
                    <Text style={[theme.typography.bodySmall, { color: theme.colors.primary }]}>
                      {tCommon('actions.retry')}
                    </Text>
                  </TouchableOpacity>
                )}
              </View>
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
                {planItems.map((item, index) => {
                  const card = item.card_id ? planCards[item.card_id] : undefined
                  // NOT `Object.values(...)[0]` — jsonb key order is Postgres's, not the
                  // template's, so that can show the answer instead of the prompt.
                  const label = cardPromptLabel(card?.field_values, card?.template_id, planTemplateFields)
                  const done = item.status === 'completed'
                  // One attempt write at a time in the store, so every row's ratings go
                  // inert together rather than looking tappable and doing nothing.
                  const recording = recordingItemId !== null
                  return (
                    <View
                      key={item.id}
                      style={[styles.card, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}
                      {...testProps(`learning-plan-item-${index}`, true)}
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
                        {/* `position` is 0-based in the row; web renders `position + 1` and the two screens
                            must not number the same plan differently. */}
                        {`${item.position + 1}. `}
                        {t(REASON_KEY[item.reason_code] ?? 'today.reason.balanced')}
                        {/* The planner budgets the day in minutes, so the row that spends the
                            budget should say what it costs — web already showed this. */}
                        {item.estimated_minutes !== null
                          ? ` · ${t('today.item.minutes', { count: item.estimated_minutes })}`
                          : ''}
                      </Text>

                      {done ? (
                        <Text
                          style={[theme.typography.caption, { color: theme.colors.success, marginTop: 6 }]}
                          {...testProps(`learning-item-recorded-${index}`)}
                        >
                          {t('today.item.recorded')}
                        </Text>
                      ) : (
                        <>
                          <View style={styles.rateRow}>
                            {SELF_RATINGS.map((rating) => (
                              <TouchableOpacity
                                key={rating.key}
                                disabled={recording}
                                onPress={() => {
                                  if (!goalId) return
                                  void recordAttempt({
                                    planItem: item,
                                    goalId,
                                    score: rating.score,
                                    clientAttemptId: Crypto.randomUUID(),
                                  }, planDate)
                                }}
                                style={[
                                  styles.rateBtn,
                                  { borderColor: theme.colors.border },
                                  recording && styles.disabled,
                                ]}
                                accessibilityRole="button"
                                accessibilityState={{ disabled: recording }}
                                {...testProps(`learning-rate-${rating.id}-${index}`)}
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
                          disabled={enrichmentPendingCardId !== null}
                          onPress={() => void requestEnrichment({
                            action: 'explain', goalId, cardId: item.card_id as string, uiLang: i18n.language,
                          })}
                          style={[
                            styles.touchRow,
                            { marginTop: 4 },
                            enrichmentPendingCardId !== null && styles.disabled,
                          ]}
                          hitSlop={HIT_SLOP}
                          accessibilityRole="button"
                          accessibilityState={{ disabled: enrichmentPendingCardId !== null }}
                          {...testProps(`learning-enrich-${index}`)}
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
                  onPress={regenerate}
                  style={[
                    styles.secondaryBtn,
                    { borderColor: theme.colors.border },
                    (planGenerating || plan.status === 'completed') && styles.disabled,
                  ]}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: planGenerating || plan.status === 'completed' }}
                  {...testProps('learning-regenerate')}
                >
                  <Text style={[theme.typography.bodySmall, { color: theme.colors.text }]}>
                    {planGenerating ? t('today.regenerating') : t('today.regenerate')}
                  </Text>
                </TouchableOpacity>
              </>
            ) : !planBlockedReason ? (
              <TouchableOpacity
                disabled={planGenerating || !goal}
                onPress={regenerate}
                style={[
                  styles.primaryBtn,
                  { backgroundColor: theme.colors.primary },
                  (planGenerating || !goal) && styles.disabled,
                ]}
                accessibilityRole="button"
                accessibilityState={{ disabled: planGenerating || !goal }}
                {...testProps('learning-generate')}
              >
                <Text style={[theme.typography.bodySmall, { color: theme.colors.textInverse }]}>
                  {planGenerating ? t('today.generating') : t('today.generate')}
                </Text>
              </TouchableOpacity>
            ) : null}
          </>
        )}
      </ScrollView>

      {/* Enrichment preview. The charge already happened, so this asks whether to KEEP the
          result — it never implies that discarding refunds anything.

          A real Modal, not an absolutely-positioned View: as a plain overlay the list behind
          it stayed scrollable and tappable (a rating could be recorded "through" the sheet),
          the Android back button popped the whole screen instead of closing the sheet, and a
          screen reader walked straight past it into the content underneath. */}
      <Modal
        visible={!!enrichment}
        transparent
        animationType="fade"
        onRequestClose={dismissEnrichment}
        statusBarTranslucent
      >
        <Pressable
          style={styles.backdrop}
          onPress={dismissEnrichment}
          accessibilityRole="button"
          accessibilityLabel={tCommon('actions.close')}
          {...testProps('learning-enrichment-backdrop')}
        />
        {enrichment && (
          <View
            style={[
              styles.sheet,
              {
                backgroundColor: theme.colors.surface,
                borderColor: theme.colors.border,
                bottom: Math.max(insets.bottom, 12),
              },
            ]}
            accessibilityViewIsModal
            {...testProps('learning-enrichment-sheet', true)}
          >
            <ScrollView style={{ maxHeight: 320 }}>
              {Object.entries(enrichment.content)
                .filter(([key]) => key !== 'sources')
                .map(([key, value]) => (
                  <View key={key} style={{ marginBottom: 8 }}>
                    <Text style={[theme.typography.caption, { color: theme.colors.textTertiary }]}>{key}</Text>
                    <Text style={[theme.typography.bodySmall, { color: theme.colors.text }]}>
                      {renderEnrichmentValue(value)}
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
                <Text key={`${source.id ?? source.title ?? 'source'}-${i}`} style={[theme.typography.caption, { color: theme.colors.text }]}>
                  {source.title || source.clause || source.id}
                  {source.clause && source.title ? ` · ${source.clause}` : ''}
                </Text>
              ))}
              <Text style={[theme.typography.caption, { color: theme.colors.textTertiary, marginTop: 6 }]}>
                {t('enrichment.chargedNote')}
              </Text>
            </ScrollView>
            <View style={styles.sheetActions}>
              <TouchableOpacity
                onPress={dismissEnrichment}
                style={styles.touchRow}
                hitSlop={HIT_SLOP}
                accessibilityRole="button"
                {...testProps('learning-enrichment-later')}
              >
                <Text style={[theme.typography.caption, { color: theme.colors.textTertiary }]}>
                  {t('enrichment.later')}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => void resolveEnrichment('rejected')}
                style={styles.touchRow}
                hitSlop={HIT_SLOP}
                accessibilityRole="button"
                {...testProps('learning-enrichment-discard')}
              >
                <Text style={[theme.typography.bodySmall, { color: theme.colors.textSecondary }]}>
                  {t('enrichment.discard')}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => void resolveEnrichment('accepted')}
                style={styles.touchRow}
                hitSlop={HIT_SLOP}
                accessibilityRole="button"
                {...testProps('learning-enrichment-keep')}
              >
                <Text style={[theme.typography.bodySmall, { color: theme.colors.primary }]}>
                  {t('enrichment.keep')}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      </Modal>
    </Screen>
  )
}

/**
 * Render one enrichment field for a human.
 *
 * The previous fallback was `JSON.stringify`, which showed braces and quotes to someone who
 * had just paid for the answer. An unrecognised shape is flattened to its readable leaves
 * instead, and only a value with nothing readable in it is dropped.
 */
function renderEnrichmentValue(value: unknown): string {
  const leaves = (input: unknown): string[] => {
    if (input === null || input === undefined) return []
    if (typeof input === 'string') return input.trim() ? [input] : []
    if (typeof input === 'number' || typeof input === 'boolean') return [String(input)]
    if (Array.isArray(input)) return input.flatMap(leaves)
    if (typeof input === 'object') return Object.values(input as Record<string, unknown>).flatMap(leaves)
    return []
  }
  return Array.isArray(value) ? value.map((v) => leaves(v).join(' — ')).filter(Boolean).join('\n')
    : leaves(value).join('\n')
}

const styles = StyleSheet.create({
  body: { padding: 16, gap: 10, paddingBottom: 48 },
  card: { padding: 12, borderRadius: 12, borderWidth: 1 },
  headerActions: { flexDirection: 'row', gap: 4 },
  headerLink: { minHeight: 32, paddingHorizontal: 6, justifyContent: 'center' },
  goalRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  // 44pt is the iOS HIG minimum and 48dp Material's; a 12px caption inside 6px of padding
  // was 28, which is a mis-tap on a moving train.
  chip: {
    paddingHorizontal: 14, minHeight: MIN_TOUCH, borderRadius: 999, borderWidth: 1,
    justifyContent: 'center',
  },
  rateRow: { flexDirection: 'row', gap: 6, marginTop: 8 },
  rateBtn: {
    paddingHorizontal: 14, minHeight: MIN_TOUCH, borderRadius: 8, borderWidth: 1,
    justifyContent: 'center', alignItems: 'center', flex: 1,
  },
  primaryBtn: { marginTop: 10, minHeight: MIN_TOUCH, paddingVertical: 12, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  secondaryBtn: { marginTop: 4, minHeight: MIN_TOUCH, paddingVertical: 12, borderRadius: 12, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  touchRow: { minHeight: MIN_TOUCH, justifyContent: 'center', paddingHorizontal: 4 },
  disabled: { opacity: 0.5 },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.45)' },
  sheet: {
    position: 'absolute', left: 12, right: 12,
    padding: 12, borderRadius: 16, borderWidth: 1,
  },
  sheetActions: { flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', gap: 12, marginTop: 6 },
})
