import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  View, Text, TouchableOpacity, ScrollView, StyleSheet, ActivityIndicator,
  RefreshControl, AppState, Modal, Pressable, Alert,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useNavigation, useRoute, type NavigationProp, type RouteProp } from '@react-navigation/native'
import { useTranslation } from 'react-i18next'
import { Screen, ScreenHeader } from '../components/ui'
import { useTheme } from '../theme'
import { testProps } from '../utils/testProps'
import { useLearningStore, type AttemptRow, type RemediationAction } from '@reeeeecall/shared/stores/learning-store'
import { useDeckStore } from '@reeeeecall/shared/stores/deck-store'
import type { PlanSelection } from '@reeeeecall/shared/stores/study-store'
import { currentPlanContext } from '@reeeeecall/shared/lib/learning-plan-date'
import { cardPromptLabel } from '@reeeeecall/shared/lib/card-prompt'
import {
  attemptNeedsRemediation, attemptTypedAnswer,
} from '@reeeeecall/shared/lib/learning-attempt-selection'
import { formatUsdMicro } from '@reeeeecall/shared/lib/ai/server-client'
import { planComposition } from '@reeeeecall/shared/lib/plan-composition'
import { goalKnowledgeSummary } from '@reeeeecall/shared/lib/goal-knowledge-summary'
import { utcToLocalDateKey } from '@reeeeecall/shared/lib/date-utils'
import { useStudy } from '../hooks/useStudy'
import type { SettingsStackParamList } from '../navigation/types'

/**
 * Today's plan — mobile parity with the web `/learning` screen.
 *
 * The same shared store drives both, so the rules that matter are already enforced there
 * and are NOT re-implemented here:
 *   * plan generation happens on an explicit press, never in an effect (`save_daily_plan`
 *     is capped at 50 writes per user per day);
 *   * studying belongs to the study screen, where one rating both reschedules the card and
 *     completes the plan item (`apply_plan_study_rating`);
 *   * an enrichment request spends real credits, so the label says so before the press.
 *
 * There is no per-card list of the day, on either platform. It was thirty rows of scroll that
 * repeated one phrase, offered nothing to tap, and showed the estimates the planner wrote at
 * dawn — stale for anyone returning mid-day. What it was really asked, "what am I in for?",
 * is one line in the summary card: reviews versus cards never seen.
 *
 * The one thing mobile must do differently is the plan date: `currentPlanContext` computes
 * it from the device's local calendar and falls back to a UTC-offset label when the Hermes
 * build has no ICU, instead of importing `Intl` (see shared/lib/learning-plan-date).
 *
 * And because a phone screen is usually resumed rather than opened, the plan date is kept
 * live instead of being frozen at mount — see `planDate` below.
 */
const MIN_TOUCH = 44
const HIT_SLOP = { top: 8, bottom: 8, left: 8, right: 8 } as const

/** How far ahead the day strip looks. A week is as far as a forecast stays worth reading. */
const FORECAST_DAYS = 6
const DAY_MS = 86_400_000

/**
 * The remediation actions the SERVER serves.
 *
 * Two, not six. `compare` and `evaluate` are refused by the edge function's `SERVED_ACTIONS`
 * list (Stage 0 of the compare/evaluate plan), so offering them here would spend credits on a
 * rejected request. It is no longer true that there is nothing to compare — a typed item stores
 * `{ self_rated, text }` — what is missing is the server-resolved reference answer.
 *
 * Nothing here may imply the model read an answer: these two are grounded in the score and the
 * card. Two actions are rendered as two inline text links rather than a menu: the repo has no
 * dropdown primitive, and every other action on these screens is an inline link.
 */
const REMEDIATION_ACTIONS: ReadonlyArray<{
  action: RemediationAction
  key: string
  id: string
  /**
   * Whether this action can be honestly offered for a given attempt — per action, because
   * `compare` needs the learner's own words and the other two do not. The server refuses an
   * ungrounded compare, so offering the button would spend a request to earn a refusal.
   */
  offeredFor: (attempt: AttemptRow) => boolean
}> = [
  { action: 'explain', key: 'enrichment.action.explain', id: 'explain', offeredFor: () => true },
  { action: 'hint', key: 'enrichment.action.hint', id: 'hint', offeredFor: () => true },
  {
    action: 'compare',
    key: 'enrichment.action.compare',
    id: 'compare',
    offeredFor: (attempt) => attemptTypedAnswer(attempt) !== null,
  },
]

/** How many recent attempts the list shows — the same window as web's `AttemptHistory`. */
const ATTEMPT_ROWS = 10

/**
 * Score → band label, using web's thresholds verbatim so the same attempt cannot read
 * "Partly" on the phone and "Knew it" in the browser.
 *
 * Deliberately NOT `KNOWN_SCORE_THRESHOLD`, even though 0.75 appears in both: that constant
 * gates what a learner can be CHARGED for, and aliasing it here would let a cosmetic tweak to
 * a label silently change who gets offered a paid request.
 */
const scoreKey = (score: number | null): string => {
  if (score === null) return 'history.score.unknown'
  if (score >= 0.75) return 'today.rate.known'
  if (score >= 0.25) return 'today.rate.partial'
  return 'today.rate.again'
}

export function LearningTodayScreen() {
  const { t, i18n } = useTranslation('learning')
  const { t: tCommon } = useTranslation('common')
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const navigation = useNavigation<NavigationProp<SettingsStackParamList>>()
  const route = useRoute<RouteProp<SettingsStackParamList, 'LearningToday'>>()
  const {
    goals, goalsLoading, fetchGoals,
    plan, planItems, planCards, planTemplateFields, planLoading, planGenerating, planError,
    planBlockedReason,
    fetchPlan, generatePlan, autoGeneratePlan, planAbsentFor, autoPlanAttempted,
    extendPlan, planExtending, planExtension,
    planForecast, planForecastLoading, forecastPlan,
    attempts, attemptsLoading, fetchAttempts,
    enrichment, enrichmentPendingCardId, enrichmentError, requestEnrichment,
    enrichmentQuote, loadEnrichmentQuote,
    resolveEnrichment, dismissEnrichment,
    knowledge, fetchGoalKnowledge,
  } = useLearningStore()
  const { startPlanSession } = useStudy()
  const { decks, fetchDecks } = useDeckStore()

  const [refreshing, setRefreshing] = useState(false)
  /** 0 = today's real plan. Anything above it is a forecast, never a saved plan. */
  const [dayOffset, setDayOffset] = useState(0)
  const [starting, setStarting] = useState(false)

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
  // The plan is addressed by the route now, mirroring web's /learning/:goalId. A route id that
  // names no plannable goal (archived, deleted) resolves to nothing rather than quietly showing
  // a different plan under the same navigation entry.
  const goalId = active.some((g) => g.id === route.params?.goalId) ? route.params.goalId : null
  const goal = active.find((g) => g.id === goalId)

  useEffect(() => {
    if (goalId) void fetchPlan(goalId, planDate)
  }, [goalId, planDate, fetchPlan])

  /**
   * Same rule as web, from the same store action: build today's plan once the read has come back
   * empty. Kept in the store rather than duplicated here — the decision has four conditions and
   * two drifting copies of it would eventually wipe a day's progress.
   */
  useEffect(() => {
    // A FRESH context, like `regenerate` — `now` is the planner's due-card cutoff, and this
    // screen stays mounted across midnight, so a value captured at mount would plan against a
    // stale clock.
    if (goal) void autoGeneratePlan(goal, currentPlanContext())
  }, [goal, planDate, autoGeneratePlan, planAbsentFor])

  /**
   * Whether automation still has its turn — the same conditions `autoGeneratePlan` checks.
   *
   * Read so the manual button does not flash for a frame between the empty read and the effect
   * that acts on it. `planDate` rather than a fresh context: the key is a date, and re-reading
   * the clock here would make this recompute on every render.
   */
  const autoWillRun = !!goal
    && planAbsentFor === `${goal.id}|${planDate}`
    && !autoPlanAttempted[`${goal.id}|${planDate}`]
    && !!goal.decks?.length

  // Judged at the target date when the goal has one — "what will I still know on the day" — and
  // at today otherwise. Server-aggregated: the plan only ever loads DUE cards.
  //
  // The fallback is memoised on purpose. A bare `new Date().toISOString()` is a NEW value every
  // render, so this effect re-fires, `fetchGoalKnowledge` calls `set()`, the screen (which
  // subscribes to the whole store) re-renders, and the RPC loops without end — for every goal
  // with no target date, which the form allows. Web escapes it because its `ctx` is memoised at
  // mount; this port dropped that.
  const mountedAt = useMemo(() => new Date().toISOString(), [])
  // Judged NOW, never at the target date — same rule as the web dashboard, and it has to be the
  // same or one goal reports two different numbers depending on which device is in your hand.
  //
  // Judging at the deadline answers "what would I still know if I stopped today": a forecast,
  // and a bleak one. On a real account it read "0 of 120 known" for a learner who had studied
  // 55 cards, because every SRS interval was shorter than the time remaining. Worth showing
  // eventually with its assumption stated; not as the line that says where you stand.
  const judgedAt = mountedAt
  useEffect(() => {
    if (goalId) void fetchGoalKnowledge(goalId, judgedAt)
  }, [goalId, judgedAt, fetchGoalKnowledge])

  /**
   * Attempts are goal-scoped, not date-scoped, so this deliberately does NOT depend on
   * `planDate` — a rollover at midnight must not re-query a list that did not change.
   */
  useEffect(() => {
    if (goalId) void fetchAttempts(goalId)
  }, [goalId, fetchAttempts])

  const reload = useCallback(async () => {
    if (!goalId) return
    setRefreshing(true)
    // Both, not just the plan. Pulling to refresh a screen that then refreshes half of
    // itself is worse than not offering the gesture: the attempt list would keep showing a
    // stale score next to a paid action grounded in it.
    try {
      await Promise.all([fetchPlan(goalId, planDate), fetchAttempts(goalId)])
    } finally { setRefreshing(false) }
  }, [goalId, planDate, fetchPlan, fetchAttempts])

  /**
   * This goal's attempts.
   *
   * Filtered by `goal_id`, not merely sliced: `fetchAttempts` leaves the previous goal's rows
   * in place until the new read lands, so for one round trip after a goal switch the list
   * would show another goal's misses under this goal's heading — and a tap in that window
   * would spend credits explaining a card the learner is no longer looking at. In the steady
   * state the filter is a no-op, which is exactly what it should be.
   */
  const goalAttempts = useMemo(
    () => attempts.filter((attempt) => attempt.goal_id === goalId),
    [attempts, goalId],
  )
  const recentAttempts = useMemo(() => goalAttempts.slice(0, ATTEMPT_ROWS), [goalAttempts])
  // Which ROW is waiting, not which card. The store tracks only the pending CARD, and the
  // learner this feature targets — someone who missed the same card twice — has two remediable
  // rows sharing one card_id. Keying on the card makes both claim to be the request in flight.
  const [requestingAttemptId, setRequestingAttemptId] = useState<string | null>(null)

  /** Is any visible row worth paying to remediate? Drives the price line, and only it. */
  const canRemediate = useMemo(
    () => recentAttempts.some((attempt) => attempt.card_id !== null && attemptNeedsRemediation(attempt)),
    [recentAttempts],
  )

  /**
   * Read the price, but only when there is something to spend it on.
   *
   * `loadEnrichmentQuote` is a wallet RPC, so this fires on TRANSITIONS, never per render:
   * once when a remediable row first appears, and again each time a request finishes
   * (`enrichmentPendingCardId` back to null) — because the balance moved, and a number that
   * was true one purchase ago is still a wrong number.
   *
   * A failed read leaves the quote `null`, which renders NO price at all. Never `$0.00`: the
   * only error here that costs a learner money is understating what a request costs.
   */
  useEffect(() => {
    if (!canRemediate || enrichmentPendingCardId !== null) return
    void loadEnrichmentQuote()
  }, [canRemediate, enrichmentPendingCardId, loadEnrichmentQuote])

  /**
   * Generation reads a FRESH context, never the rendered one: `ctx.now` is the due-card
   * cutoff, and reusing a value captured minutes ago would plan against a stale clock.
   */
  const regenerate = useCallback(() => {
    if (goal) void generatePlan(goal, currentPlanContext())
  }, [goal, generatePlan])

  // A fresh context, like `regenerate` — the screen stays mounted across midnight, so a value
  // captured at mount would append to yesterday.
  const studyMore = useCallback(() => {
    if (goal) void extendPlan(goal, currentPlanContext())
  }, [goal, extendPlan])

  useEffect(() => { void fetchDecks() }, [fetchDecks])

  /** The day the strip is pointing at. Offset 0 is the real, saved plan. */
  const viewedDate = useMemo(
    () => new Date(Date.parse(`${planDate}T00:00:00Z`) + dayOffset * DAY_MS)
      .toISOString().slice(0, 10),
    [planDate, dayOffset],
  )

  // Forecast on demand, once per date. It runs the real planner and DOES NOT save: every quota
  // and destructive cost of planning lives in `save_daily_plan`, so a preview is free.
  useEffect(() => {
    if (dayOffset === 0 || !goal) return
    const base = currentPlanContext()
    void forecastPlan(goal, {
      ...base,
      planDate: viewedDate,
      now: new Date(Date.parse(base.now) + dayOffset * DAY_MS).toISOString(),
    })
  }, [dayOffset, goal, viewedDate, forecastPlan])

  /**
   * The day's work split by deck, because a study session cannot span decks:
   * `finalize_study_session` takes one `p_deck_id` and refuses a session whose events cover
   * more than one. Ordered by the plan's own positions, so the primary button starts whichever
   * deck the planner put first.
   */
  const deckGroups = useMemo(() => {
    const byDeck = new Map<string, {
      deckId: string; pending: number; done: number; first: number
      cardIds: string[]; items: PlanSelection['items']
    }>()
    for (const item of [...planItems].sort((a, b) => a.position - b.position)) {
      const deckId = item.card_id ? planCards[item.card_id]?.deck_id : undefined
      if (!deckId || !item.card_id) continue
      const entry = byDeck.get(deckId)
        ?? { deckId, pending: 0, done: 0, first: item.position, cardIds: [], items: {} }
      if (item.status === 'completed') {
        entry.done += 1
      } else {
        entry.pending += 1
        // Pending only. Replaying a finished row would spend a rating to earn a P0007 —
        // `record_answer_attempt` refuses to complete an item twice.
        entry.cardIds.push(item.card_id)
        ;(entry.items as Record<string, PlanSelection['items'][string]>)[item.card_id] = {
          id: item.id,
          activity_type: item.activity_type,
          response_type: item.response_type,
          evaluator_type: item.evaluator_type,
        }
      }
      entry.first = Math.min(entry.first, item.position)
      byDeck.set(deckId, entry)
    }
    return [...byDeck.values()].sort((a, b) => a.first - b.first)
  }, [planItems, planCards])

  const pendingTotal = deckGroups.reduce((sum, group) => sum + group.pending, 0)
  const doneTotal = deckGroups.reduce((sum, group) => sum + group.done, 0)
  const nextDeck = deckGroups.find((group) => group.pending > 0) ?? null

  /** What is LEFT today. Shared with web so the two screens cannot disagree about it. */
  const composition = useMemo(() => planComposition(planItems), [planItems])

  /**
   * Where the goal stands. Shared with web and the dashboard tile, which had already drifted into
   * dividing by different denominators and drawing two bars from one RPC's numbers.
   *
   * Computed unconditionally with a zeroed fallback: the card below is rendered behind a guard,
   * and a hook cannot live inside one.
   */
  const goalSummary = useMemo(
    () => goalKnowledgeSummary(
      (goalId ? knowledge[goalId] : null) ?? { total: 0, known: 0, unknown: 0, unseen: 0 },
    ),
    [goalId, knowledge],
  )
  // Each half dropped when empty — "복습 밀림 0장" is a sentence about nothing, and a learner who
  // is caught up should see that rather than a row of noughts.
  const progressDetail = [
    goalSummary.overdue > 0 ? t('progress.overdue', { count: goalSummary.overdue }) : null,
    goalSummary.unstudied > 0 ? t('progress.unstudied', { count: goalSummary.unstudied }) : null,
  ].filter(Boolean).join(' · ')

  const deckName = useCallback(
    (deckId: string) => decks.find((deck) => deck.id === deckId)?.name ?? t('today.item.untitled'),
    [decks, t],
  )

  /**
   * Hand the day to the real study session.
   *
   * The session is prepared BEFORE navigating — the same order `StudySetupScreen` uses — so the
   * study screen never mounts against an empty queue. `StudySession` lives in the Study tab's
   * stack while this screen is in Settings, hence the parent navigator.
   */
  const startDeck = useCallback(async (group: typeof deckGroups[number]) => {
    if (!goalId || starting) return
    setStarting(true)
    try {
      await startPlanSession(group.deckId, {
        goalId, cardIds: group.cardIds, items: group.items,
      })
      // Cross-stack: `StudySession` lives in the Study tab's stack, this screen in Settings.
      // Same shape DecksListScreen uses to reach it; the cast is because the drawer/tab param
      // list is not expressed in this screen's typed navigator.
      const tabNav = navigation.getParent() as unknown as
        { navigate: (name: string, params?: unknown) => void } | undefined
      tabNav?.navigate('StudyTab', { screen: 'StudySession' })
    } catch {
      Alert.alert(t('today.error.unknown'))
    } finally {
      setStarting(false)
    }
  }, [goalId, starting, startPlanSession, navigation, t])

  const dayLabel = useCallback((offset: number) => {
    if (offset === 0) return t('today.days.today')
    if (offset === 1) return t('today.days.tomorrow')
    return t('today.days.inDays', { count: offset })
  }, [t])

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
      {/* One way out, and it is back to the list. Two links that both went to the goals screen —
          one of them labelled "진단" for a screen that no longer exists — was the old shape. */}
      <ScreenHeader
        title={goal?.title ?? t('today.title')}
        mode="back"
        rightContent={
          <TouchableOpacity
            onPress={() => navigation.navigate('LearningGoals')}
            style={styles.headerLink}
            hitSlop={HIT_SLOP}
            accessibilityRole="button"
            {...testProps('learning-back-to-plans')}
          >
            <Text style={[theme.typography.caption, { color: theme.colors.primary }]}>
              {t('today.backToPlans')}
            </Text>
          </TouchableOpacity>
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
        ) : !goalId ? (
          // Goals exist, but this route names none of them — paused, completed, or a nav state
          // restored from before the plan took a goalId. Without this branch the learner got a
          // disabled Generate button with the PREVIOUS goal's plan items still on screen, because
          // the store does not clear `planItems` on a goal change.
          <View style={[styles.card, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
            <Text style={[theme.typography.bodySmall, { color: theme.colors.textSecondary }]}>
              {t('today.empty.noGoal')}
            </Text>
            <TouchableOpacity
              onPress={() => navigation.navigate('LearningGoals')}
              style={[styles.primaryBtn, { backgroundColor: theme.colors.primary }]}
              {...testProps('learning-back-to-plans-empty')}
            >
              <Text style={[theme.typography.bodySmall, { color: theme.colors.textInverse }]}>{t('today.backToPlans')}</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <>
            {/* Where this goal stands. The chip row that used to sit here let you switch plans
                from inside a plan; the list does that now, and this space says something.

                `testProps(id, true)` is the CONTAINER form. Without the second argument it
                returns `accessible: true` plus `accessibilityLabel: id`, and being spread last it
                would overwrite any translated label and collapse the subtree — TalkBack would
                announce the literal "learning-progress" and neither number inside it. */}
            {goalId && knowledge[goalId] && knowledge[goalId].total > 0 && (
              <View
                style={[styles.card, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}
                {...testProps('learning-progress', true)}
              >
                {/* `known` means "still inside its review window", not "확실히 안다" — one rating
                    on an overdue card moves it there. The old headline renamed it and read
                    "29장 중 1장 기억" over a goal with 18 overdue reviews and 10 untouched cards,
                    which sounds like amnesia and means nothing of the kind. */}
                <Text style={[theme.typography.bodySmall, { color: theme.colors.text }]}>
                  {goalSummary.notStarted
                    ? t('progress.notStarted', { total: knowledge[goalId].total })
                    : t('progress.withinWindow', {
                      attempted: goalSummary.attempted, known: goalSummary.withinWindow,
                    })}
                </Text>
                {progressDetail !== '' && (
                  <Text style={[theme.typography.caption, { color: theme.colors.textTertiary, marginTop: 4 }]}>
                    {progressDetail}
                  </Text>
                )}
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

            {/* ── Day strip ────────────────────────────────────────────────────
                Today is the plan; the rest are forecasts. The same control on purpose —
                "what is coming" is one question — and the panel below always says which
                of the two is on screen. */}
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.dayStrip}
              accessibilityLabel={t('today.days.label')}
            >
              {Array.from({ length: FORECAST_DAYS + 1 }, (_, offset) => {
                const selected = offset === dayOffset
                return (
                  <TouchableOpacity
                    key={offset}
                    onPress={() => setDayOffset(offset)}
                    style={[styles.dayChip, {
                      borderColor: selected ? theme.colors.primary : theme.colors.border,
                      backgroundColor: selected ? theme.colors.primaryLight : 'transparent',
                      borderWidth: selected ? 2 : 1,
                    }]}
                    accessibilityRole="radio"
                    accessibilityState={{ selected }}
                    {...testProps(`learning-day-${offset}`)}
                  >
                    <Text style={[theme.typography.caption, {
                      color: selected ? theme.colors.primary : theme.colors.textSecondary,
                    }]}>
                      {dayLabel(offset)}
                    </Text>
                  </TouchableOpacity>
                )
              })}
            </ScrollView>

            {dayOffset > 0 ? (
              /* ── A day that has not happened ───────────────────────────────── */
              <View
                style={[styles.card, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}
                {...testProps('learning-forecast', true)}
              >
                <Text style={[theme.typography.caption, { color: theme.colors.textSecondary }]}>
                  {t('today.forecast.title')}
                </Text>
                {planForecastLoading === viewedDate ? (
                  <ActivityIndicator style={{ marginTop: 8 }} />
                ) : planForecast[viewedDate] ? (
                  <>
                    <Text style={[theme.typography.h3, { color: theme.colors.text, marginTop: 4 }]}>
                      {t('today.forecast.cards', { count: planForecast[viewedDate]!.totalItems })}
                    </Text>
                    <Text style={[theme.typography.bodySmall, { color: theme.colors.textSecondary, marginTop: 2 }]}>
                      {t('today.forecast.minutes', {
                        count: Math.max(1, Math.round(planForecast[viewedDate]!.estimatedMinutes)),
                      })}
                      {' · '}
                      {t('today.forecast.breakdown', {
                        newCards: planForecast[viewedDate]!.newCards,
                        reviewCards: planForecast[viewedDate]!.reviewCards,
                      })}
                    </Text>
                  </>
                ) : (
                  <Text style={[theme.typography.bodySmall, { color: theme.colors.textSecondary, marginTop: 4 }]}>
                    {t('today.forecast.empty')}
                  </Text>
                )}
                {/* Said every time: the number above is only as good as the assumption that
                    nothing is studied between now and then — which is exactly the assumption
                    a learner reading a plan is about to break. */}
                <Text style={[theme.typography.caption, { color: theme.colors.textTertiary, marginTop: 8 }]}>
                  {t('today.forecast.note')}
                </Text>
              </View>
            ) : (
              <>
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
                {/* ── The day, and the way into it ─────────────────────────────
                    This block used to render every plan item as a card with a text box and
                    three self-rating buttons. That surface recorded an attempt and rescheduled
                    NOTHING — its own hint said so — so a learner who worked through it moved no
                    due date and got the same plan back tomorrow. Studying is the study screen's
                    job now, and one rating there does both halves. */}
                <View style={[styles.card, {
                  backgroundColor: theme.colors.surface, borderColor: theme.colors.border,
                }]} {...testProps('learning-today-summary', true)}>
                  <View style={styles.summaryRow}>
                    <Text style={[theme.typography.h3, { color: theme.colors.text }]}
                      {...testProps('learning-remaining')}>
                      {pendingTotal > 0
                        ? t('today.remaining', { count: pendingTotal })
                        : t('today.allDone')}
                    </Text>
                    <Text style={[theme.typography.caption, { color: theme.colors.textTertiary }]}>
                      {t('today.progress', { done: doneTotal, total: plan.total_items })}
                    </Text>
                  </View>
                  <View style={[styles.progressTrack, { backgroundColor: theme.colors.border }]}>
                    <View style={[styles.progressFill, {
                      backgroundColor: theme.colors.primary,
                      width: `${plan.total_items > 0
                        ? Math.round((doneTotal / plan.total_items) * 100) : 0}%`,
                    }]} />
                  </View>

                  {/* Everything the per-card list used to say, in one line. A half with nothing
                      in it is left out rather than printed as "0": "복습 19장" on its own already
                      says the day holds no new cards. */}
                  {(composition.review > 0 || composition.fresh > 0) && (
                    <Text
                      style={[theme.typography.caption, { color: theme.colors.textTertiary, marginTop: 6 }]}
                      {...testProps('learning-composition')}
                    >
                      {[
                        composition.review > 0 ? t('today.composition.review', { count: composition.review }) : null,
                        composition.fresh > 0 ? t('today.composition.fresh', { count: composition.fresh }) : null,
                      ].filter(Boolean).join(' · ')}
                    </Text>
                  )}

                  {nextDeck ? (
                    <>
                      <TouchableOpacity
                        disabled={starting}
                        onPress={() => void startDeck(nextDeck)}
                        style={[
                          styles.primaryBtn,
                          { backgroundColor: theme.colors.primary },
                          starting && styles.disabled,
                        ]}
                        accessibilityRole="button"
                        accessibilityState={{ disabled: starting }}
                        {...testProps('learning-start-study')}
                      >
                        <Text style={[theme.typography.bodySmall, { color: theme.colors.textInverse, fontWeight: '600' }]}>
                          {doneTotal > 0 ? t('today.continueStudy') : t('today.startStudy')}
                        </Text>
                      </TouchableOpacity>
                      {/* Said here because the old screen's own hint told learners the
                          opposite about its buttons. */}
                      <Text style={[theme.typography.caption, {
                        color: theme.colors.textTertiary, marginTop: 6, textAlign: 'center',
                      }]}>
                        {t('today.studyNote')}
                      </Text>
                    </>
                  ) : (
                    <Text style={[theme.typography.bodySmall, {
                      color: theme.colors.success, marginTop: 12, textAlign: 'center',
                    }]} {...testProps('learning-all-done')}>
                      {t('today.allDoneNote')}
                    </Text>
                  )}
                </View>

                {/* Per deck, because a session cannot span decks. Only shown when there is
                    more than one — otherwise the primary button already IS the whole plan. */}
                {deckGroups.length > 1 && (
                  <View style={[styles.card, {
                    backgroundColor: theme.colors.surface, borderColor: theme.colors.border,
                  }]}>
                    <Text style={[theme.typography.caption, { color: theme.colors.textSecondary }]}>
                      {t('today.byDeck')}
                    </Text>
                    {deckGroups.map((group, index) => (
                      <View key={group.deckId} style={styles.deckRowSplit}>
                        <View style={styles.deckRowText}>
                          <Text style={[theme.typography.bodySmall, { color: theme.colors.text }]} numberOfLines={1}>
                            {deckName(group.deckId)}
                          </Text>
                          <Text style={[theme.typography.caption, { color: theme.colors.textTertiary }]}>
                            {group.pending > 0
                              ? t('today.remaining', { count: group.pending })
                              : t('today.deckDone')}
                          </Text>
                        </View>
                        {group.pending > 0 && (
                          <TouchableOpacity
                            disabled={starting}
                            onPress={() => void startDeck(group)}
                            style={[styles.deckStartBtn, { borderColor: theme.colors.border }, starting && styles.disabled]}
                            hitSlop={HIT_SLOP}
                            accessibilityRole="button"
                            accessibilityState={{ disabled: starting }}
                            {...testProps(`learning-start-deck-${index}`)}
                          >
                            <Text style={[theme.typography.caption, { color: theme.colors.primary }]}>
                              {t('today.item.study')}
                            </Text>
                          </TouchableOpacity>
                        )}
                      </View>
                    ))}
                  </View>
                )}

                {/* "더 하기" comes FIRST and is the primary action. Rebuilding is the
                    destructive one — it deletes every item and zeroes the day's progress — so
                    the additive option has to be the easier one to reach. */}
                <TouchableOpacity
                  disabled={planExtending || planGenerating || !goal}
                  onPress={studyMore}
                  style={[
                    styles.primaryBtn,
                    { backgroundColor: theme.colors.primary },
                    (planExtending || planGenerating || !goal) && styles.disabled,
                  ]}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: planExtending || planGenerating || !goal }}
                  {...testProps('learning-extend')}
                >
                  <Text style={[theme.typography.bodySmall, { color: theme.colors.textInverse }]}>
                    {planExtending ? t('today.extending') : t('today.extend')}
                  </Text>
                </TouchableOpacity>

                {planExtension && (
                  <Text
                    style={[theme.typography.caption, { color: theme.colors.textSecondary }]}
                    accessibilityLiveRegion="polite"
                    {...testProps('learning-extend-result')}
                  >
                    {planExtension.appended === 0
                      ? t('today.extendNothing')
                      // The cost, said out loud. Every card started today comes back tomorrow,
                      // and a button that grows tomorrow's list in silence is how a learner
                      // ends up abandoning a goal they were doing well at.
                      : t('today.extendAdded', { count: planExtension.appended })
                        + (planExtension.reviewsTomorrow > 0
                          ? ' ' + t('today.extendTomorrow', { count: planExtension.reviewsTomorrow })
                          : '')}
                  </Text>
                )}

                <TouchableOpacity
                  disabled={planGenerating || planExtending || plan.status === 'completed'}
                  onPress={regenerate}
                  style={[
                    styles.secondaryBtn,
                    { borderColor: theme.colors.border },
                    (planGenerating || planExtending || plan.status === 'completed') && styles.disabled,
                  ]}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: planGenerating || planExtending || plan.status === 'completed' }}
                  {...testProps('learning-regenerate')}
                >
                  <Text style={[theme.typography.bodySmall, { color: theme.colors.text }]}>
                    {planGenerating ? t('today.regenerating') : t('today.regenerate')}
                  </Text>
                </TouchableOpacity>
              </>
            ) : planGenerating || autoWillRun ? (
              // Building it. Not a button: the learner is being told what is happening, not
              // asked to make it happen.
              <Text
                style={[theme.typography.bodySmall, { color: theme.colors.textSecondary }]}
                accessibilityLiveRegion="polite"
                {...testProps('learning-generating')}
              >
                {t('today.generating')}
              </Text>
            ) : !planBlockedReason ? (
              // Only reachable once automation has had its turn and produced no plan — a failed
              // save, or a goal already regenerated today. The button is the way back.
              <TouchableOpacity
                disabled={!goal}
                onPress={regenerate}
                style={[
                  styles.primaryBtn,
                  { backgroundColor: theme.colors.primary },
                  !goal && styles.disabled,
                ]}
                accessibilityRole="button"
                accessibilityState={{ disabled: !goal }}
                {...testProps('learning-generate')}
              >
                <Text style={[theme.typography.bodySmall, { color: theme.colors.textInverse }]}>
                  {t('today.generate')}
                </Text>
              </TouchableOpacity>
            ) : null}
              </>
            )}

            {/* Recent attempts — the review surface, and the only place a paid request can be
                grounded in a specific miss rather than in the card alone.

                No timestamp beyond the local date: `toLocaleString` is `Intl`, which these
                screens do not use (an ICU-less Hermes build has no `Intl` at all), and the
                list is already newest-first, so the day is the only part that adds anything. */}
            {attemptsLoading && goalAttempts.length === 0 ? (
              <ActivityIndicator {...testProps('learning-attempts-loading')} />
            ) : recentAttempts.length > 0 ? (
              <View style={styles.attemptSection} {...testProps('learning-attempt-history', true)}>
                {/* Counts the rows ON SCREEN, not everything loaded — the store fetches 50 and
                    this shows ten, so counting the former would print "(40)" above ten rows.
                    `{{count, number}}` with a real number — the Intl-free formatter registered
                    in src/i18n does the grouping. */}
                <Text style={[theme.typography.bodySmall, { color: theme.colors.text }]}>
                  {t('history.title', { count: recentAttempts.length })}
                </Text>

                {/* The price, before the tap. `enrichmentQuote === null` means the wallet
                    could not be read — then NO number is shown at all, because "$0.00" for
                    something that charges is the one error a learner cannot recover from. */}
                {canRemediate && enrichmentQuote !== null && (
                  <Text
                    style={[theme.typography.caption, { color: theme.colors.textTertiary }]}
                    {...testProps('learning-attempt-quote')}
                  >
                    {t('enrichment.quote', {
                      price: formatUsdMicro(enrichmentQuote.estPriceMicro),
                      balance: formatUsdMicro(enrichmentQuote.balanceMicro),
                    })}
                  </Text>
                )}

                {recentAttempts.map((attempt, index) => {
                  const cardId = attempt.card_id
                  const card = cardId ? planCards[cardId] : undefined
                  // Only today's plan cards are loaded, so an older attempt has no label to
                  // show — hence the fallback, rather than a blank row.
                  const label = cardPromptLabel(card?.field_values, card?.template_id, planTemplateFields)
                  // A miss or a partial recall only. Offering to explain something the learner
                  // just said they knew would be selling an answer with no question, and a
                  // never-scored attempt is not evidence of a miss either.
                  const remediable = attemptNeedsRemediation(attempt)
                  // Read back from the stored response, not inferred from the plan item: an
                  // older attempt's item may be gone, and only the row itself knows whether it
                  // holds an answer.
                  const typedAnswer = attemptTypedAnswer(attempt)
                  // One request at a time, globally — the store short-circuits a second one, so
                  // every row's actions go inert together instead of looking tappable.
                  const busy = enrichmentPendingCardId !== null
                  return (
                    <View
                      key={attempt.id}
                      style={[styles.attemptRow, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}
                      {...testProps(`learning-attempt-${index}`, true)}
                    >
                      <View style={styles.attemptHead}>
                        <Text
                          style={[theme.typography.caption, { color: theme.colors.text, flex: 1 }]}
                          numberOfLines={1}
                        >
                          {label || t('history.itemFallback', { type: attempt.activity_type })}
                        </Text>
                        <Text style={[theme.typography.caption, { color: theme.colors.textTertiary }]}>
                          {t(scoreKey(attempt.normalized_score))}
                        </Text>
                      </View>
                      <Text style={[theme.typography.caption, { color: theme.colors.textTertiary }]}>
                        {utcToLocalDateKey(attempt.created_at)}
                      </Text>
                      {/* What the learner wrote, when they wrote anything — the honesty check:
                          a later paid `compare` is grounded in exactly this string, so it has
                          to be visible before anyone pays for an answer about it. */}
                      {typedAnswer && (
                        <Text
                          style={[theme.typography.caption, { color: theme.colors.textSecondary }]}
                          numberOfLines={2}
                          {...testProps(`learning-attempt-answer-${index}`)}
                        >
                          {t('history.youWrote', { text: typedAnswer })}
                        </Text>
                      )}

                      {remediable && cardId && goalId && (
                        requestingAttemptId === attempt.id ? (
                          <Text
                            style={[theme.typography.caption, { color: theme.colors.textTertiary }]}
                            {...testProps(`learning-attempt-pending-${index}`)}
                          >
                            {t('enrichment.requesting')}
                          </Text>
                        ) : (
                          <>
                            <View style={styles.attemptActions}>
                              {REMEDIATION_ACTIONS.filter((entry) => entry.offeredFor(attempt)).map((entry) => (
                                <TouchableOpacity
                                  key={entry.id}
                                  disabled={busy}
                                  onPress={() => {
                                    setRequestingAttemptId(attempt.id)
                                    void requestEnrichment({
                                      action: entry.action,
                                      goalId,
                                      cardId,
                                      // What makes the answer about THIS miss, not the card.
                                      attemptId: attempt.id,
                                      uiLang: i18n.language,
                                    }).finally(() => setRequestingAttemptId(null))
                                  }}
                                  style={[styles.touchRow, busy && styles.disabled]}
                                  hitSlop={HIT_SLOP}
                                  accessibilityRole="button"
                                  accessibilityState={{ disabled: busy }}
                                  {...testProps(`learning-attempt-${entry.id}-${index}`)}
                                >
                                  <Text style={[theme.typography.caption, { color: theme.colors.primary }]}>
                                    {t(entry.key)}
                                  </Text>
                                </TouchableOpacity>
                              ))}
                            </View>
                            <Text style={[theme.typography.caption, { color: theme.colors.textTertiary }]}>
                              {t('enrichment.groundedHint')}
                            </Text>
                          </>
                        )
                      )}
                    </View>
                  )
                })}
              </View>
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
  headerLink: { minHeight: 32, paddingHorizontal: 6, justifyContent: 'center' },
  // ── the day's summary and its way in ──────────────────────────────────────
  summaryRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 },
  progressTrack: { height: 6, borderRadius: 999, marginTop: 8, overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: 999 },
  deckRowSplit: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    gap: 8, marginTop: 8,
  },
  deckRowText: { flex: 1, minWidth: 0 },
  // 44pt is the iOS HIG minimum and 48dp Material's; a 12px caption inside 6px of padding
  // was 28, which is a mis-tap on a moving train.
  deckStartBtn: {
    paddingHorizontal: 14, minHeight: MIN_TOUCH, borderRadius: 8, borderWidth: 1,
    justifyContent: 'center', alignItems: 'center',
  },
  // The day strip. Chips scroll horizontally so a week fits on the narrowest phone.
  dayStrip: { flexDirection: 'row', gap: 6, paddingVertical: 2 },
  dayChip: {
    paddingHorizontal: 14, minHeight: MIN_TOUCH, borderRadius: 999, borderWidth: 1,
    justifyContent: 'center', alignItems: 'center',
  },
  primaryBtn: { marginTop: 10, minHeight: MIN_TOUCH, paddingVertical: 12, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  secondaryBtn: { marginTop: 4, minHeight: MIN_TOUCH, paddingVertical: 12, borderRadius: 12, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  touchRow: { minHeight: MIN_TOUCH, justifyContent: 'center', paddingHorizontal: 4 },
  // The attempt list. `alignItems: 'center'` lives on the ROW (a flex row), never on the
  // ScrollView's contentContainer — there it truncates long labels instead of centring them.
  attemptSection: { gap: 6, marginTop: 6 },
  attemptRow: { padding: 10, borderRadius: 10, borderWidth: 1, gap: 2 },
  attemptHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  attemptActions: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  disabled: { opacity: 0.5 },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.45)' },
  sheet: {
    position: 'absolute', left: 12, right: 12,
    padding: 12, borderRadius: 16, borderWidth: 1,
  },
  sheetActions: { flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', gap: 12, marginTop: 6 },
})
