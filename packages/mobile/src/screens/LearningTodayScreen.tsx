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
import { caughtUp } from '@reeeeecall/shared/lib/caught-up'
import {
  parseNewCardsPerDay, DEFAULT_NEW_CARDS_PER_DAY,
} from '@reeeeecall/shared/learning/application/cadence'
import { utcToLocalDateKey } from '@reeeeecall/shared/lib/date-utils'
import { useQuizStore, type DailyCheckCount } from '@reeeeecall/shared/stores/quiz-store'
import type { PlanWeek, DayState } from '@reeeeecall/shared/learning/application/plan-week'
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
  const [counts, setCounts] = useState<DailyCheckCount | null>(null)
  const [busy, setBusy] = useState(false)
  const timezone = currentPlanContext().timezone

  useEffect(() => {
    // Same guard as the coach: an effect that throws produces an unhandled rejection, and a
    // partially-mocked store has no such action.
    if (typeof countDailyCheck !== 'function') return
    let cancelled = false
    // Today first — the server widens only when today has nothing. Without this the card was
    // invisible until the learner had already studied, which is when they are leaving.
    void countDailyCheck(timezone, CHECK_LOOKBACK_DAYS)
      .then((value) => { if (!cancelled) setCounts(value) })
      .catch(() => { if (!cancelled) setCounts(null) })
    return () => { cancelled = true }
  }, [countDailyCheck, timezone, goalId])

  if (!counts) return null

  // Studied plenty, none of it resolvable. On a real deck this is the COMMON way the check
  // fails: a template with two `primary` back fields cannot say which one is the answer, so
  // every card of it is refused — and on the deck this was measured against, one of those two
  // is the learner's own wrong expression. Refusing is right; refusing invisibly is what made
  // the card look like it did not exist.
  //
  // No link: the template editor is web-only, so mobile names the fix rather than pretending
  // to offer it. A dead button would be worse than a sentence.
  if (counts.checkable === 0) {
    const blocker = counts.blocked?.[0]
    if (!blocker || counts.studiedToday === 0) return null
    return (
      <View style={[styles.card, {
        backgroundColor: theme.colors.surface, borderColor: theme.colors.border, marginTop: 12,
      }]} {...testProps('check-blocked')}>
        <Text style={[theme.typography.label, { color: theme.colors.text }]}>
          {t('check.blockedTitle')}
        </Text>
        <Text style={[theme.typography.caption, { color: theme.colors.textSecondary, marginTop: 2 }]}>
          {t('check.blockedBody', { name: blocker.name, count: blocker.cards })}
        </Text>
        <Text style={[theme.typography.caption, { color: theme.colors.textTertiary, marginTop: 6 }]}>
          {t('check.blockedWeb')}
        </Text>
      </View>
    )
  }

  const start = async () => {
    setBusy(true)
    try {
      // The SAME window the count was taken with, or the server refuses a check this card
      // has already offered.
      const setId = await buildDailyCheck({ goalId, timezone, lookback: CHECK_LOOKBACK_DAYS })
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
      {/* Named for the window it actually drew from. Being told these are today's cards on
          a day you did not study is the kind of small lie that costs a feature its
          credibility the first time a learner notices. */}
      <Text style={[theme.typography.label, { color: theme.colors.text }]}>
        {counts.windowDays > 1
          ? t('check.recentTitle', { count: counts.checkable })
          : t('check.title', { count: counts.checkable })}
      </Text>
      <Text style={[theme.typography.caption, { color: theme.colors.textSecondary, marginTop: 2 }]}>
        {counts.windowDays > 1 ? t('check.recentBody') : t('check.body')}
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
    </View>
  )
}


/**
 * 이번 주 — the card that is allowed to be boring.
 *
 * Every other section of this screen may render nothing, and each of those guards is right
 * on its own: none of them has anything TRUE to say in the state it hides in. Together they
 * meant the screen was one card and a button for a learner who had not studied yet today —
 * which is every learner at the moment they open the app to decide whether to study.
 *
 * So this one never hides. The last seven days happened; saying so needs no model, no
 * minimum history and no judgement.
 *
 * 주간 플랜 코치 lives inside it now rather than beside it. The coach is deterministic and
 * free (`plan-coach.ts`) but silent by design — it holds for a short week and holds again
 * whenever nothing is wrong, which is most weeks. As its own card that was a card-shaped
 * hole; as a row under a strip that is always there, its silence just means the week needs
 * no comment. And on mobile this is still the only way to change a goal's settings at all.
 *
 * `그대로 둘게요` is dismissal, recorded — a suggestion the learner has answered must not
 * return next week as if they had not.
 */
function PlanWeekCard({ goalId }: { goalId: string }) {
  const { t } = useTranslation('learning')
  const theme = useTheme()
  const {
    recommendations, fetchRecommendations, regeneratePlanCoach, applyPlanCoach,
    resolveRecommendation, planWeek, planWeekGoalId,
  } = useLearningStore()
  const [busy, setBusy] = useState(false)
  const timezone = currentPlanContext().timezone

  useEffect(() => {
    // Guarded because this runs inside an effect, where a throw becomes an UNHANDLED
    // rejection rather than a render error: a partially-mocked store (as in the page tests)
    // has no such actions, and 47 of those turned a green suite into a red CI job while
    // every assertion still passed.
    if (typeof fetchRecommendations !== 'function' || typeof regeneratePlanCoach !== 'function') {
      return
    }
    let cancelled = false
    void (async () => {
      try {
        await fetchRecommendations(goalId)
        if (!cancelled) await regeneratePlanCoach(goalId, timezone)
      } catch {
        // A coach that cannot be produced is not worth an error on the learner's screen.
      }
    })()
    return () => { cancelled = true }
  }, [goalId, timezone, fetchRecommendations, regeneratePlanCoach])

  const suggestion = (recommendations ?? []).find(
    (r) => r.goal_id === goalId && r.status === 'pending' && r.card_id === null,
  )
  // `hold` means nothing is wrong. It is stored so producers can be compared, never shown.
  const advice = suggestion && suggestion.action_type !== 'hold' ? suggestion : null
  const value = (advice?.payload as { value?: number | null } | null)?.value ?? null

  // The guard is on the DATA, not on whether it is interesting: an older server (or a
  // rollback of 209) sends no `by_day`, and an empty strip would read as a week in which the
  // learner did nothing.
  const week = planWeekGoalId === goalId ? planWeek : null
  if (!week) return null

  return (
    <View style={[styles.card, {
      backgroundColor: theme.colors.surface, borderColor: theme.colors.border, marginTop: 12,
    }]} {...testProps('plan-week')}>
      <View style={styles.weekHead}>
        <Text style={[theme.typography.label, { color: theme.colors.text }]}>
          {t('week.title')}
        </Text>
        <Text style={[theme.typography.caption, { color: theme.colors.textSecondary }]}>
          {t('week.activeDays', { count: week.activeDays })}
        </Text>
      </View>

      <PlanWeekStrip week={week} />

      <Text style={[theme.typography.caption, { color: theme.colors.textSecondary, marginTop: 8 }]}>
        {week.streak > 0
          ? t('week.streak', { count: week.streak })
          // Measured on the live account: 1 active day, streak 0. "이번 주는 아직 기록이
          // 없어요" beside "1일 학습" is the screen contradicting itself in two lines.
          : week.activeDays > 0 ? t('week.streakBroken') : t('week.streakNone')}
        {/* Only alongside a real plan. A percentage of nothing is not 0%, it is a question
            nobody asked, and it reads as a grade for a test the learner never sat. */}
        {week.completion !== null
          && ` · ${t('week.completion', { pct: Math.round(week.completion * 100) })}`}
      </Text>

      {advice && (
        <View style={[styles.coachDivider, { borderTopColor: theme.colors.border }]}>
          <Text style={[theme.typography.label, { color: theme.colors.text }]}>
            {t(`coach.${advice.action_type}.title`, { value, defaultValue: '' })}
          </Text>
          <Text style={[theme.typography.caption, { color: theme.colors.textSecondary, marginTop: 2 }]}>
            {t(`coach.${advice.action_type}.body`, { defaultValue: '' })}
          </Text>
          <View style={styles.coachRow}>
            <TouchableOpacity
              onPress={() => { setBusy(true); void applyPlanCoach(advice.id).finally(() => setBusy(false)) }}
              disabled={busy}
              style={[styles.coachApply, { backgroundColor: theme.colors.primary }, busy && styles.disabled]}
              accessibilityRole="button"
              {...testProps('plan-coach-apply')}
            >
              <Text style={[theme.typography.label, { color: '#fff' }]}>{t('coach.apply')}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => { setBusy(true); void resolveRecommendation(advice.id, 'dismissed').finally(() => setBusy(false)) }}
              disabled={busy}
              style={[styles.coachKeep, { borderColor: theme.colors.border }, busy && styles.disabled]}
              accessibilityRole="button"
              {...testProps('plan-coach-keep')}
            >
              <Text style={[theme.typography.label, { color: theme.colors.text }]}>{t('coach.keep')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
    </View>
  )
}

/**
 * Seven cells, one per day, oldest first.
 *
 * Colour is not the only channel: every cell carries its state in its accessibility label,
 * because "which of these greys means I studied" is not a question a learner should have to
 * answer, and for a colour-blind one it is not answerable at all.
 *
 * The weekday letters come from the locale files, not from `Intl` — Hermes ships without
 * ICU, so `toLocaleDateString` would return the same English on every device.
 */
function PlanWeekStrip({ week }: { week: PlanWeek }) {
  const { t } = useTranslation('learning')
  const theme = useTheme()

  const fill = (state: DayState): { backgroundColor: string; borderColor: string } => {
    switch (state) {
      case 'done':      return { backgroundColor: theme.colors.primary, borderColor: theme.colors.primary }
      case 'partial':   return { backgroundColor: theme.colors.primary + '40', borderColor: theme.colors.primary + '66' }
      case 'extra':     return { backgroundColor: theme.colors.success + '33', borderColor: theme.colors.success + '66' }
      case 'untouched': return { backgroundColor: 'transparent', borderColor: theme.colors.border }
      // A day where nothing happened is the QUIETEST cell, not the loudest. This was
      // `surfaceElevated`, which on the light theme is white — against a grey card that made
      // four empty days the brightest thing in the strip, louder than the day that had a plan
      // and was skipped. Photographed on an iPhone; it does not show up in a typecheck.
      default:          return { backgroundColor: 'transparent', borderColor: 'transparent' }
    }
  }

  return (
    <View style={styles.weekStrip}>
      {week.days.map((day, i) => (
        <View key={day.date} style={styles.weekCol}>
          <Text style={[theme.typography.caption, { color: theme.colors.textTertiary, fontSize: 10 }]}>
            {t(`week.dow.${day.weekday}`)}
          </Text>
          <View
            accessible
            accessibilityLabel={`${day.date} · ${t(`week.legend.${day.state}`)}`}
            style={[
              styles.weekCell,
              fill(day.state),
              i === week.days.length - 1 && { borderWidth: 2, borderColor: theme.colors.primary },
            ]}
          >
            {/* The number is what was DONE. A cell showing the plan's SIZE on a day nobody
                opened would put the largest number on the emptiest day. */}
            <Text style={[theme.typography.caption, {
              fontSize: 10,
              color: day.state === 'done' ? '#fff' : theme.colors.textSecondary,
            }]}>
              {day.done > 0 ? String(day.done) : day.studied > 0 ? String(day.studied) : ''}
            </Text>
          </View>
        </View>
      ))}
    </View>
  )
}

/** Deck names printed before the count takes over. Three fits one line on a narrow phone. */
const DECK_NAMES_SHOWN = 3

/**
 * How far back 오늘의 확인 may reach when today has nothing.
 *
 * Today always wins — the server widens only when today is empty. A week is the window the
 * rest of this screen already talks in, so a learner is never offered a card from a stretch
 * they have stopped thinking of as recent.
 */
const CHECK_LOOKBACK_DAYS = 7

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
  /**
   * One number, and it says what window it is over. See the web note for why the other two
   * went: "정답률 78% · 보통 1초 · 플랜 49% 이행" spanned two unprinted windows, and the
   * middle number measured how fast the learner tapped after the answer was already showing.
   */
  const insightStats = useMemo(() => {
    if (!insights) return ''
    const accuracy = insights.accuracy === null ? null : Math.round(insights.accuracy * 100)
    return accuracy === null
      ? t('insights.notScoredYet')
      : t('insights.accuracyValue', {
        pct: accuracy,
        scored: insights.scoredCount,
        known: Math.round((insights.accuracy ?? 0) * insights.scoredCount),
      })
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
    // `total` travels with it so the completion sentence can name the population its target is
    // 80% OF. Printing "목표 24장" beside "배운 29장" made the deck look like it shrank.
    return { ...goalCompletion(k, {
      newCardsPerDay: parseNewCardsPerDay(goal?.settings) ?? DEFAULT_NEW_CARDS_PER_DAY,
    }), total: k.total }
  }, [goalId, knowledge, goal])
  /** Already STAMPED. A record of having earned it, not a live reading of the ratio. */
  const goalDone = goal?.status === 'completed'

  /**
   * Which kind of "nothing due" this is — see `caught-up.ts`. Read against a FRESH instant:
   * the empty state is looked at after a session, and "5분 뒤" measured from when the screen
   * was opened is the wrong five minutes.
   */
  const caughtUpState = useMemo(
    () => caughtUp(goalId ? knowledge[goalId]?.nextDueAt ?? null : null, new Date().toISOString()),
    [goalId, knowledge],
  )

  /**
   * A wall-clock time the learner can compare to their own clock.
   *
   * Hand-formatted, NOT `toLocaleString`: Hermes ships without ICU, so every locale option is
   * ignored and every device would render the same English regardless of the app's language.
   */
  const formatWhen = useCallback((iso: string | null) => {
    if (!iso) return ''
    const at = new Date(iso)
    const pad = (n: number) => String(n).padStart(2, '0')
    return `${at.getMonth() + 1}/${at.getDate()} ${pad(at.getHours())}:${pad(at.getMinutes())}`
  }, [])

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

  /**
   * The day's totals come from the PLAN, not from the per-deck grouping.
   *
   * `deckGroups` drops any item whose card it cannot resolve, so summing it meant a plan of
   * twelve untouched items could report zero pending and put "오늘 끝!" over its own
   * "12개 중 0개 완료". `total_items`/`completed_items` are maintained server-side on every
   * rating and cannot shrink because a client-side lookup missed.
   */
  const doneTotal = plan?.completed_items ?? 0
  const pendingTotal = Math.max(0, (plan?.total_items ?? 0) - doneTotal)
  /** Work the plan claims but no deck can be reached for. Normally zero. */
  const unreachableTotal = Math.max(
    0, pendingTotal - deckGroups.reduce((sum, group) => sum + group.pending, 0))
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
  // The detail line no longer swaps populations with the headline. It used to print a bare
  // "배운 29장" whenever the headline was about a backlog — a count with no denominator, one
  // line under a different count with a different one.
  const progressDetail = goalSummary.notStarted ? '' : [
    // Each half omitted when empty — see the web note. "복습 주기 안 0장" is a real state:
    // every card just answered means every card is in a learning step.
    goalSummary.withinWindow > 0
      ? t('progress.detailWithinWindow', { count: goalSummary.withinWindow }) : null,
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
                      total: goalCompletionState.total,
                    })}
                    {/* One number, and the sentence says what it assumes. It used to be
                        `12 / adherence` — a ladder constant divided by a percentage shown in a
                        different section under a different name. */}
                    {goalCompletionState.daysToComplete !== null
                      ? ' · ' + t('completion.etaIfDaily', {
                        count: goalCompletionState.daysToComplete,
                        remaining: goalCompletionState.remaining,
                      })
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
            {/* "복습할 카드가 없습니다" read as a failure — the learner's cards had gone
                somewhere. The truth in the reported state was the opposite: they had just
                finished, and twelve cards were coming back inside ten minutes. */}
            {planBlockedReason === 'no_candidates' && (
              <View>
                <Text style={[theme.typography.bodySmall, { color: theme.colors.text }]}>
                  {t('today.empty.allCaughtUp')}
                </Text>
                <Text style={[theme.typography.caption, {
                  color: theme.colors.textSecondary, marginTop: 2,
                }]}>
                  {caughtUpState.kind === 'soon'
                    ? t('today.empty.backSoon', { count: caughtUpState.minutes ?? 1 })
                    : caughtUpState.kind === 'later'
                      ? t('today.empty.nextReview', { when: formatWhen(caughtUpState.atISO) })
                      : t('today.empty.nothingScheduled')}
                </Text>
              </View>
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
                  ) : pendingTotal > 0 ? (
                    /* The plan says there is work and no deck can be reached for it. "다
                       했어요" here is the lie the totals used to tell. */
                    <Text style={[theme.typography.bodySmall, {
                      color: theme.colors.textSecondary, marginTop: 12, textAlign: 'center',
                    }]} {...testProps('learning-items-unavailable')}>
                      {t('today.itemsUnavailable', { count: unreachableTotal || pendingTotal })}
                    </Text>
                  ) : (
                    /* "내일 또 만나요" is wrong whenever the cards come back sooner — and after
                       a session they usually do. See the web note. */
                    <Text style={[theme.typography.bodySmall, {
                      color: theme.colors.success, marginTop: 12, textAlign: 'center',
                    }]} {...testProps('learning-all-done')}>
                      {caughtUpState.kind === 'soon'
                        ? t('today.backSoonNote', { count: caughtUpState.minutes ?? 1 })
                        : t('today.allDoneNote')}
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
                        + (planExtension.aheadOfSchedule
                          // Studying early has a real cost; it is never done silently.
                          ? ' ' + t('today.extendAhead', { count: planExtension.appended })
                          : '')
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

            {/* AFTER the plan, not before it. These sat above the today card, which put "이번
                주" and 오늘의 확인 ahead of 학습 시작 — the one thing the learner opened the
                screen to press. Photographed on an iPhone; the tree alone does not show it.

                Siblings of the goal header, not children: nested inside, each rendered as a
                bordered card inside a card, reading as a detail OF the goal rather than as its
                own section. */}
            {goal && <PlanWeekCard goalId={goal.id} />}
            {goal && <DailyCheckCard goalId={goal.id} />}

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
                    {/* The count, and nothing else — see the web note. "12장 · 0분 · 카드당
                        평균 1초" measured whole-card dwell including reading the answer, and
                        was zero on every attempt written without a duration. */}
                    {t('history.recapCount', { count: recap.count })}
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
  weekHead:     { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  weekStrip:    { flexDirection: 'row', gap: 6, marginTop: 10 },
  weekCol:      { flex: 1, alignItems: 'center', gap: 4 },
  weekCell:     { height: 32, width: '100%', borderRadius: 8, borderWidth: 1,
                  alignItems: 'center', justifyContent: 'center' },
  coachDivider: { marginTop: 12, paddingTop: 12, borderTopWidth: 1 },
  coachRow: { flexDirection: 'row', gap: 8, marginTop: 10 },
  coachApply: { flex: 1, paddingVertical: 10, borderRadius: 10, alignItems: 'center' },
  coachKeep: { paddingVertical: 10, paddingHorizontal: 14, borderRadius: 10, borderWidth: 1, alignItems: 'center' },
})
