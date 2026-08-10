import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  View, Text, TouchableOpacity, ScrollView, StyleSheet, ActivityIndicator,
  RefreshControl, AppState, Alert,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useNavigation, useRoute, type NavigationProp, type RouteProp } from '@react-navigation/native'
import { useTranslation } from 'react-i18next'
import { Screen, ScreenHeader } from '../components/ui'
import { useTheme } from '../theme'
import { testProps } from '../utils/testProps'
import { useLearningStore } from '@reeeeecall/shared/stores/learning-store'
import { useDeckStore } from '@reeeeecall/shared/stores/deck-store'
import type { PlanSelection } from '@reeeeecall/shared/stores/study-store'
import { currentPlanContext } from '@reeeeecall/shared/lib/learning-plan-date'
import { planComposition } from '@reeeeecall/shared/lib/plan-composition'
import { studyRecap } from '@reeeeecall/shared/lib/study-recap'
import { goalKnowledgeSummary } from '@reeeeecall/shared/lib/goal-knowledge-summary'
import { goalCompletion } from '@reeeeecall/shared/lib/goal-completion'
import {
  parseNewCardsPerDay, DEFAULT_NEW_CARDS_PER_DAY,
} from '@reeeeecall/shared/learning/application/cadence'
import { utcToLocalDateKey } from '@reeeeecall/shared/lib/date-utils'
import { useQuizStore } from '@reeeeecall/shared/stores/quiz-store'
import { useStudy } from '../hooks/useStudy'
import type { AIStackParamList } from '../navigation/types'

/**
 * Today's plan — mobile parity with the web `/learning` screen.
 *
 * The same shared store drives both, so the rules that matter are already enforced there
 * and are NOT re-implemented here:
 *   * plan generation happens on an explicit press, never in an effect (`save_daily_plan`
 *     is capped at 50 writes per user per day);
 *   * studying belongs to the study screen, where one rating both reschedules the card and
 *     completes the plan item (`apply_plan_study_rating`).
 *
 * ## What this screen no longer carries, on either platform
 *
 * A per-card list of the day — thirty rows repeating one phrase, nothing to tap, and showing
 * estimates the planner wrote at dawn. Replaced by one line: reviews versus cards never seen.
 *
 * A seven-day forecast strip. It ran the real planner with `now` moved forward, which was
 * correct and useless: nothing is studied in the simulation, so the pool never shrank and the
 * daily budget filled identically every time. A learner 18 reviews behind read the same number
 * seven times.
 *
 * Paid AI remediation (설명 / 힌트 / 비교) and its preview sheet. Removed as a product decision,
 * not a rendering one. The `ai-generate` function and its metering are untouched server-side.
 *
 * The one thing mobile must do differently is the plan date: `currentPlanContext` computes
 * it from the device's local calendar and falls back to a UTC-offset label when the Hermes
 * build has no ICU, instead of importing `Intl` (see shared/lib/learning-plan-date).
 *
 * And because a phone screen is usually resumed rather than opened, the plan date is kept
 * live instead of being frozen at mount — see `planDate` below.
 */

/**
 * 오늘의 확인 — the first thing in this app that asks whether the learner was RIGHT.
 *
 * Everything the plan records today is the learner grading themselves: every activity is
 * `recall`/`self_rate`, so the plan's numbers describe confidence, not knowledge. This adds
 * the missing measurement without adding a cost to studying — the question is the card's own
 * prompt and the reference is its own declared answer field, so nothing is generated, and an
 * answer that matches is graded free by string comparison. Only a genuinely ambiguous answer
 * reaches the paid grader.
 *
 * Renders nothing when there is nothing to check. A disabled button here would advertise a
 * feature the learner cannot reach and cannot fix from this screen.
 */
function DailyCheckCard({ goalId }: { goalId: string }) {
  const { t } = useTranslation('learning')
  const theme = useTheme()
  const navigation = useNavigation<NavigationProp<AIStackParamList>>()
  const { countDailyCheck, buildDailyCheck, startRun } = useQuizStore()
  const [counts, setCounts] = useState<{ studiedToday: number; checkable: number } | null>(null)
  const [busy, setBusy] = useState(false)
  const timezone = currentPlanContext().timezone

  useEffect(() => {
    let cancelled = false
    void countDailyCheck(timezone)
      .then((value) => { if (!cancelled) setCounts(value) })
      .catch(() => { if (!cancelled) setCounts(null) })
    return () => { cancelled = true }
  }, [countDailyCheck, timezone, goalId])

  if (!counts || counts.checkable === 0) return null

  const start = async () => {
    setBusy(true)
    try {
      const setId = await buildDailyCheck({ goalId, timezone })
      const runId = await startRun(setId)
      // The check runs in the quiz stack — same runner, same screens. `getParent` is how a
      // screen in one drawer stack hands off to another without importing its navigator.
      // The check runs in the quiz stack — same runner, same screens. `getParent` is how a
      // screen in one drawer stack hands off to another without importing its navigator.
      // Cast once at the boundary: the drawer's param list is not visible from here, and
      // spelling it out would mean importing the navigator this screen deliberately does not.
      const parent = navigation.getParent() as unknown as
        { navigate: (name: string, params?: unknown) => void } | undefined
      parent?.navigate('QuizTab', { screen: 'QuizRun', params: { runId } })
    } catch {
      setBusy(false)
    }
  }

  return (
    <View style={[styles.card, {
      backgroundColor: theme.colors.surfaceElevated,
      borderColor: theme.colors.primary,
      marginTop: 12,
    }]}>
      <Text style={[theme.typography.label, { color: theme.colors.text }]}>
        {t('check.title', { count: counts.checkable })}
      </Text>
      <Text style={[theme.typography.caption, { color: theme.colors.textSecondary, marginTop: 2 }]}>
        {t('check.body')}
      </Text>
      <TouchableOpacity
        onPress={() => void start()}
        disabled={busy}
        style={[styles.checkButton, { backgroundColor: theme.colors.primary }, busy && styles.disabled]}
        accessibilityRole="button"
        {...testProps('daily-check-start')}
      >
        <Text style={[theme.typography.label, { color: '#fff' }]}>
          {busy ? t('check.starting') : t('check.start')}
        </Text>
      </TouchableOpacity>
      {/* The price rule, said before they start rather than after they are billed. */}
      <Text style={[theme.typography.caption, {
        color: theme.colors.textTertiary, marginTop: 6, textAlign: 'center',
      }]}>
        {t('check.free')}
      </Text>
    </View>
  )
}


/**
 * 주간 플랜 코치 — the one setting worth changing this week, if any.
 *
 * Every knob on a goal is write-once in practice, and on mobile there is no goal editor at
 * all — so a plan that was too ambitious on day one has, until now, had no way to become
 * less so from a phone. This is that way.
 *
 * The suggestion is deterministic and free (`plan-coach.ts`); the number is derived and
 * clamped by the chooser and travels in the stored row, so this renders it rather than
 * re-deriving it. `그대로 둘게요` is dismissal, recorded — a suggestion the learner has
 * answered must not return next week as if they had not.
 */
function PlanCoachCard({ goalId }: { goalId: string }) {
  const { t } = useTranslation('learning')
  const theme = useTheme()
  const {
    recommendations, fetchRecommendations, regeneratePlanCoach, applyPlanCoach,
    resolveRecommendation,
  } = useLearningStore()
  const [busy, setBusy] = useState(false)
  const timezone = currentPlanContext().timezone

  useEffect(() => {
    let cancelled = false
    void (async () => {
      await fetchRecommendations(goalId)
      if (!cancelled) await regeneratePlanCoach(goalId, timezone)
    })()
    return () => { cancelled = true }
  }, [goalId, timezone, fetchRecommendations, regeneratePlanCoach])

  const suggestion = (recommendations ?? []).find(
    (r) => r.goal_id === goalId && r.status === 'pending' && r.card_id === null,
  )
  // `hold` means nothing is wrong. It is stored so producers can be compared, never shown.
  if (!suggestion || suggestion.action_type === 'hold') return null

  const value = (suggestion.payload as { value?: number | null } | null)?.value ?? null

  return (
    <View style={[styles.card, {
      backgroundColor: theme.colors.surface, borderColor: theme.colors.border, marginTop: 12,
    }]}>
      <Text style={[theme.typography.label, { color: theme.colors.text }]}>
        {t(`coach.${suggestion.action_type}.title`, { value, defaultValue: '' })}
      </Text>
      <Text style={[theme.typography.caption, { color: theme.colors.textSecondary, marginTop: 2 }]}>
        {t(`coach.${suggestion.action_type}.body`, { defaultValue: '' })}
      </Text>
      <View style={styles.coachRow}>
        <TouchableOpacity
          onPress={() => { setBusy(true); void applyPlanCoach(suggestion.id).finally(() => setBusy(false)) }}
          disabled={busy}
          style={[styles.coachApply, { backgroundColor: theme.colors.primary }, busy && styles.disabled]}
          accessibilityRole="button"
          {...testProps('plan-coach-apply')}
        >
          <Text style={[theme.typography.label, { color: '#fff' }]}>{t('coach.apply')}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => { setBusy(true); void resolveRecommendation(suggestion.id, 'dismissed').finally(() => setBusy(false)) }}
          disabled={busy}
          style={[styles.coachKeep, { borderColor: theme.colors.border }, busy && styles.disabled]}
          accessibilityRole="button"
          {...testProps('plan-coach-keep')}
        >
          <Text style={[theme.typography.label, { color: theme.colors.text }]}>{t('coach.keep')}</Text>
        </TouchableOpacity>
      </View>
    </View>
  )
}

/** Deck names printed before the count takes over. Three fits one line on a narrow phone. */
const DECK_NAMES_SHOWN = 3

const MIN_TOUCH = 44
const HIT_SLOP = { top: 8, bottom: 8, left: 8, right: 8 } as const

export function LearningTodayScreen() {
  const { t, i18n } = useTranslation('learning')
  const { t: tCommon } = useTranslation('common')
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const navigation = useNavigation<NavigationProp<AIStackParamList>>()
  const route = useRoute<RouteProp<AIStackParamList, 'LearningToday'>>()
  const {
    goals, goalsLoading, fetchGoals,
    plan, planItems, planCards, planLoading, planGenerating, planError,
    planBlockedReason,
    fetchPlan, generatePlan, autoGeneratePlan, planAbsentFor, autoPlanAttempted,
    extendPlan, planExtending, planExtension,
    attempts, attemptsLoading, fetchAttempts,
    knowledge, fetchGoalKnowledge,
    insights, weakCardDecks, insightsGoalId, fetchInsights,
    completeGoalIfEarned,
  } = useLearningStore()
  const { startPlanSession, startCardSession } = useStudy()
  const { decks, fetchDecks } = useDeckStore()

  const [refreshing, setRefreshing] = useState(false)
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

  // 'completed' belongs here too. Finishing a goal is a MILESTONE, not a stop: the cards keep
  // coming due and `save_daily_plan` rejects only archived goals. Filtering it out would make a
  // goal vanish from this screen at the exact moment it was achieved.
  const active = useMemo(
    () => goals.filter((g) => g.status === 'active' || g.status === 'completed'),
    [goals],
  )
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
    if (!goalId) return
    void fetchGoalKnowledge(goalId, judgedAt)
    // Same breath as reading the progress: the ratio can only move when a card's interval
    // does, and this screen is where the learner lands after studying. The server judges.
    void completeGoalIfEarned(goalId)
  }, [goalId, judgedAt, fetchGoalKnowledge, completeGoalIfEarned])

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
  /**
   * The day this screen is showing, not "the last 50 rows".
   *
   * The store reads 50 attempts for the goal with no date bound and the old list took the first
   * ten, so a learner returning after a week read last week's words under a heading about now.
   */
  const todaysAttempts = useMemo(
    () => goalAttempts.filter((attempt) => utcToLocalDateKey(attempt.created_at) === planDate),
    [goalAttempts, planDate],
  )
  /** How much, how long, how it went — shared with web so the two cannot disagree. */
  const recap = useMemo(() => studyRecap(todaysAttempts), [todaysAttempts])
  useEffect(() => { if (goalId) void fetchInsights(goalId) }, [goalId, fetchInsights])

  /**
   * Weak cards grouped by the deck holding them. A session takes ONE deck
   * (`finalize_study_session` refuses events spanning decks), and `summarizeLearning` works
   * from attempt rows which carry no deck — hence `weakCardDecks` from the store.
   */
  const weakByDeck = useMemo(() => {
    if (!insights || insightsGoalId !== goalId) return []
    const byDeck = new Map<string, string[]>()
    for (const card of insights.weakCards) {
      const deckId = weakCardDecks[card.cardId]
      if (!deckId) continue
      const bucket = byDeck.get(deckId)
      if (bucket) bucket.push(card.cardId)
      else byDeck.set(deckId, [card.cardId])
    }
    return [...byDeck.entries()].map(([deckId, cardIds]) => ({ deckId, cardIds }))
  }, [insights, weakCardDecks, insightsGoalId, goalId])

  // `accuracy` is null when nothing carried a score, which is a different claim from 0%.
  const insightStats = useMemo(() => {
    if (!insights) return ''
    const pct = (v: number | null) => (v === null ? null : Math.round(v * 100))
    const accuracy = pct(insights.accuracy)
    const adherence = pct(insights.overallAdherence)
    return [
      accuracy === null ? t('insights.notScoredYet') : t('insights.accuracyValue', { pct: accuracy }),
      insights.medianDurationMs === null
        ? null
        : t('insights.typicalValue', { seconds: Math.round(insights.medianDurationMs / 100) / 10 }),
      adherence === null ? null : t('insights.adherenceValue', { pct: adherence }),
    ].filter(Boolean).join(' · ')
  }, [insights, t])

  const studyWeak = useCallback(async (group: { deckId: string; cardIds: string[] }) => {
    setStarting(true)
    try {
      await startCardSession(group.deckId, group.cardIds)
      // Cross-stack, same shape `startDeck` uses: `StudySession` lives in the Study tab's
      // stack while this screen lives in Settings.
      const tabNav = navigation.getParent() as unknown as
        { navigate: (name: string, params?: unknown) => void } | undefined
      tabNav?.navigate('StudyTab', { screen: 'StudySession' })
    } catch {
      Alert.alert(t('today.error.unknown'))
    } finally {
      setStarting(false)
    }
  }, [startCardSession, navigation, t])

  /**
   * The goal's decks, named — resolved against the deck store so a rename shows through and a
   * deck the learner can no longer see simply drops out. `goal.decks` is the goal's own link
   * table, i.e. what the PLANNER draws from, not merely what appeared in today's plan.
   */
  const deckSummary = useMemo(() => {
    if (!goal) return ''
    const names = goal.decks
      .map((link) => decks.find((deck) => deck.id === link.deck_id)?.name)
      .filter((name): name is string => !!name)
    if (names.length === 0) return ''
    if (names.length <= DECK_NAMES_SHOWN) return names.join(', ')
    return t('today.deckListMore', {
      names: names.slice(0, DECK_NAMES_SHOWN).join(', '),
      count: names.length - DECK_NAMES_SHOWN,
    })
  }, [goal, decks, t])

  /**
   * Where this goal stands against the completion rule. `null` when there is nothing to say —
   * no goal loaded, or a goal holding no cards, which is never "complete" (0/0 is not 100%).
   */
  const goalCompletionState = useMemo(() => {
    const k = goalId ? knowledge[goalId] : null
    if (!k || k.total === 0) return null
    return goalCompletion(k, {
      newCardsPerDay: parseNewCardsPerDay(goal?.settings) ?? DEFAULT_NEW_CARDS_PER_DAY,
      adherence: insightsGoalId === goalId ? insights?.overallAdherence ?? null : null,
    })
  }, [goalId, knowledge, goal, insights, insightsGoalId])
  /** Already STAMPED. A record of having earned it, not a live reading of the ratio. */
  const goalDone = goal?.status === 'completed'

  const recapBands = [
    recap.known > 0 ? t('history.band.known', { count: recap.known }) : null,
    recap.partial > 0 ? t('history.band.partial', { count: recap.partial }) : null,
    recap.missed > 0 ? t('history.band.missed', { count: recap.missed }) : null,
  ].filter(Boolean).join(' · ')
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
  const progressDetail = goalSummary.notStarted ? '' : [
    goalSummary.behind
      ? t('progress.detailStudied', { count: goalSummary.attempted })
      : t('progress.detailWithinWindow', { count: goalSummary.withinWindow }),
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
                    ? t('progress.notStarted', { total: goalSummary.total })
                    : goalSummary.behind
                      ? t('progress.behind', { count: goalSummary.overdue })
                      : t('progress.studied', {
                        total: goalSummary.total, attempted: goalSummary.attempted,
                      })}
                </Text>
                {/* Where the finish line is. A goal had none until mig 192: the status value,
                    the transition and the `target` column all existed and nothing ever decided.
                    Under SRS nothing decides itself either — intervals grow and reviews never
                    stop — so this is the product saying when it calls the work done. */}
                {goalDone ? (
                  <Text
                    style={[theme.typography.caption, { color: theme.colors.success, marginTop: 4 }]}
                    {...testProps('learning-goal-complete')}
                  >
                    {t('completion.done')}
                  </Text>
                ) : goalCompletionState !== null && (
                  <Text
                    style={[theme.typography.caption, { color: theme.colors.textTertiary, marginTop: 4 }]}
                    {...testProps('learning-goal-completion')}
                  >
                    {t('completion.progress', {
                      mature: goalCompletionState.mature,
                      required: goalCompletionState.required,
                    })}
                    {goalCompletionState.daysToComplete !== null
                      ? ' · ' + t('completion.eta', { count: goalCompletionState.daysToComplete })
                      : ''}
                  </Text>
                )}
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
                {/* Which decks this plan draws from. A goal can hold dozens, so three names
                    and a count rather than a paragraph above the day's numbers. */}
                {deckSummary !== '' && (
                  <Text
                    style={[theme.typography.caption, { color: theme.colors.textTertiary, marginTop: 2 }]}
                    numberOfLines={1}
                    {...testProps('learning-deck-summary')}
                  >
                    {deckSummary}
                  </Text>
                )}
                <Text style={[theme.typography.caption, { color: theme.colors.textTertiary, marginTop: 2 }]}>
                  {t('today.budget', { count: goal.daily_minutes })}
                  {plan ? ` · ${t('today.progress', { done: plan.completed_items, total: plan.total_items })}` : ''}
                </Text>
              </View>
            )}

            {/* A SIBLING of the goal header, not a child of it. Nested inside, it rendered as
                a bordered card inside a card — which read as a detail OF the goal rather than
                as its own action, and did not match the web layout where it sits beside the
                plan. Seen on the simulator; the tree alone does not show it. */}
            {goal && <PlanCoachCard goalId={goal.id} />}
            {goal && <DailyCheckCard goalId={goal.id} />}

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

                {/* "더 하기" appears only once the day is actually finished. Offering it next
                    to "28장 남음" invited a learner to grow a list they had not started, and
                    every card added today comes back tomorrow — so the button's real cost lands
                    on a day they have not seen yet. It is an "I want more", not an "instead". */}
                {pendingTotal === 0 && (
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
                )}

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

            {/* Recent attempts — the review surface, and the only place a paid request can be
                grounded in a specific miss rather than in the card alone.

                No timestamp beyond the local date: `toLocaleString` is `Intl`, which these
                screens do not use (an ICU-less Hermes build has no `Intl` at all), and the
                list is already newest-first, so the day is the only part that adds anything. */}
            {attemptsLoading && todaysAttempts.length === 0 ? (
              <ActivityIndicator {...testProps('learning-attempts-loading')} />
            ) : recap.count > 0 ? (
              <View style={styles.attemptSection} {...testProps('learning-attempt-history', true)}>
                <Text style={[theme.typography.bodySmall, { color: theme.colors.text }]}>
                  {t('history.title')}
                </Text>

                {/* How the session went, in the three numbers the list of words never gave.
                    `{{count, number}}` with a real number — the Intl-free formatter registered
                    in src/i18n does the grouping. */}
                <View
                  style={[styles.card, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}
                  {...testProps('learning-study-recap', true)}
                >
                  <Text style={[theme.typography.bodySmall, { color: theme.colors.text }]}>
                    {t('history.recap', {
                      count: recap.count,
                      minutes: Math.round(recap.totalMs / 60000),
                      seconds: Math.round(recap.avgMs / 1000),
                    })}
                  </Text>
                  {/* A band with nothing in it is left out — "몰랐음 0" is a sentence about
                      nothing, and a perfect session should read as three words. */}
                  {recapBands !== '' && (
                    <Text style={[theme.typography.caption, { color: theme.colors.textTertiary, marginTop: 4 }]}>
                      {recapBands}
                    </Text>
                  )}
                </View>

              </View>
            ) : null}

            {/* ── What is working and what is not, over 30 days ─────────────────
                The engine (`summarizeLearning`) and the copy in all 16 locale files existed
                the whole time with nothing rendering them. Weak cards are a COUNT and a
                BUTTON, never a list: a column of cards you got wrong with nothing to do about
                it is the shape this screen has already been cleaned of twice. One button per
                deck, because `finalize_study_session` refuses a session spanning decks. */}
            {insights && insightsGoalId === goalId && insights.attemptCount > 0 && (
              <View style={styles.attemptSection} {...testProps('learning-insights', true)}>
                <Text style={[theme.typography.bodySmall, { color: theme.colors.text }]}>
                  {t('insights.title')}
                </Text>
                <View style={[styles.card, {
                  backgroundColor: theme.colors.surface, borderColor: theme.colors.border,
                }]}>
                  <Text style={[theme.typography.bodySmall, { color: theme.colors.text }]}>
                    {insightStats}
                  </Text>
                  <Text style={[theme.typography.caption, {
                    color: theme.colors.textTertiary, marginTop: 4,
                  }]}>
                    {t('insights.scopeNote')}
                  </Text>
                </View>

                {weakByDeck.map((group, index) => (
                  <TouchableOpacity
                    key={group.deckId}
                    disabled={starting}
                    onPress={() => void studyWeak(group)}
                    style={[
                      styles.card,
                      { backgroundColor: theme.colors.surface, borderColor: theme.colors.border },
                      starting && styles.disabled,
                    ]}
                    accessibilityRole="button"
                    accessibilityState={{ disabled: starting }}
                    {...testProps('learning-weak-study-' + index)}
                  >
                    <Text style={[theme.typography.bodySmall, { color: theme.colors.primary }]}>
                      {weakByDeck.length > 1 ? deckName(group.deckId) : t('insights.weakStudy')}
                      {' · '}
                      {t('insights.weakCount', { count: group.cardIds.length })}
                    </Text>
                    <Text style={[theme.typography.caption, {
                      color: theme.colors.textTertiary, marginTop: 2,
                    }]}>
                      {t('insights.weakHint')}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}
          </>
        )}
      </ScrollView>

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
  primaryBtn: { marginTop: 10, minHeight: MIN_TOUCH, paddingVertical: 12, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  touchRow: { minHeight: MIN_TOUCH, justifyContent: 'center', paddingHorizontal: 4 },
  attemptSection: { gap: 6, marginTop: 6 },
  attemptHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  disabled: { opacity: 0.5 },
  checkButton: { marginTop: 10, paddingVertical: 10, borderRadius: 10, alignItems: 'center' },
  coachRow: { flexDirection: 'row', gap: 8, marginTop: 10 },
  coachApply: { flex: 1, paddingVertical: 10, borderRadius: 10, alignItems: 'center' },
  coachKeep: { paddingVertical: 10, paddingHorizontal: 14, borderRadius: 10, borderWidth: 1, alignItems: 'center' },
})
