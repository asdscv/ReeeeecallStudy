import { useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useParams } from 'react-router-dom'
import { Play, Check } from 'lucide-react'
import {
  useLearningStore,
  type LearningGoalWithDecks, type GoalKnowledge,
} from '../../stores/learning-store'
import { currentPlanContext } from '../../lib/learning-plan-date'
import { planComposition } from '@reeeeecall/shared/lib/plan-composition'
import { studyRecap } from '@reeeeecall/shared/lib/study-recap'
import { utcToLocalDateKey } from '@reeeeecall/shared/lib/date-utils'
import { goalKnowledgeSummary } from '@reeeeecall/shared/lib/goal-knowledge-summary'
import { goalCompletion } from '@reeeeecall/shared/lib/goal-completion'
import {
  parseNewCardsPerDay, DEFAULT_NEW_CARDS_PER_DAY,
} from '@reeeeecall/shared/learning/application/cadence'
import { useDeckStore } from '../../stores/deck-store'
import { ListSkeleton } from '../../components/common/Skeleton'

/**
 * One goal's plan — today, and the days after it.
 *
 * ## What this screen stopped being
 *
 * It used to BE the study session: every card in the day's plan rendered as a row with a
 * textarea and three self-rating buttons, all of it on one scrolling page. That surface looked
 * like studying and was not — the small print under the buttons said so out loud
 * ("복습 일정은 바뀌지 않습니다"), because `record_answer_attempt` logs an attempt and
 * reschedules nothing. A learner who did their whole plan there moved no card's due date, and
 * tomorrow's plan came back identical. The per-row 학습 link went somewhere better — the real
 * study session — but it opened the WHOLE deck and knew nothing about the plan, so the two
 * surfaces double-counted each other.
 *
 * Now the plan is a plan: it says what today is, and hands the studying to the study session
 * the rest of the app already uses (`/decks/:deckId/study?goalId=…&planDate=…`). One rating
 * there both reschedules the card and completes the plan item — `apply_plan_study_rating`,
 * one transaction — so doing the plan is doing the studying.
 *
 * ## Why a session per deck
 *
 * `finalize_study_session` takes one `p_deck_id` and refuses a session whose rating events span
 * decks, so a plan covering three decks is three sessions. The deck list below is that fact made
 * visible rather than hidden behind a single button that would silently study only one of them.
 *
 * ## Why there is no forecast for the days after today
 *
 * There was one: a strip of seven date chips, each running the real planner with `now` moved
 * forward. Correct, and empty. The forecast had to assume nothing is studied between now and
 * then, so the candidate pool never shrank and the daily budget filled the same way every time
 * — a learner 18 reviews behind read "28장" seven times in a row. Seven chips that all say one
 * thing look like information and are not.
 *
 * Making it real would mean simulating the SRS forward through ratings nobody has given yet,
 * which trades one unfounded assumption for a subtler one. So the screen shows the day it can
 * actually speak for.
 *
 * ## Why there is no per-card list
 *
 * There was one: every item in the day, with its planner reason, its recall estimate and its
 * minute cost. It cost thirty rows of scroll to reach the buttons under it and gave nothing
 * back. Every row read the same ("잊기 직전 · 29% · 약 0.5분"), so the reasoning meant to build
 * trust turned into wallpaper; nothing on it was actionable, since the studying happens in the
 * study session; and the numbers were the snapshot the planner wrote at dawn, so a learner
 * returning mid-day read stale estimates for the cards they had not reached yet.
 *
 * What that list was actually asked was "what am I in for?", and that answer fits on one line —
 * the split between cards coming back and cards never seen. It sits in the summary card above,
 * next to the count it qualifies.
 */


/** Deck names printed before the count takes over. Three fits one line on a narrow phone. */
const DECK_NAMES_SHOWN = 3

/**
 * How the day went.
 *
 * Two removals got it here. It was "최근 시도": one row per attempt, each a card prompt with a
 * rating word and a timestamp — a column of vocabulary that answered no question, in the one
 * place a learner has actually finished something. That collapsed into three numbers, leaving
 * only the missed cards listed, because those were the rows that carried the paid AI actions.
 *
 * Then the AI actions went too, and with them the only reason to name a card here. A list of
 * words you got wrong, with nothing to do about them, is the thing this section was already
 * fixed once for. What is left is the answer to "how did I do?" and nothing else.
 */
function AttemptHistory({ goalId, planDate }: { goalId: string; planDate: string }) {
  const { t } = useTranslation('learning')
  const { attempts, attemptsLoading, fetchAttempts } = useLearningStore()

  useEffect(() => { void fetchAttempts(goalId) }, [goalId, fetchAttempts])

  // Filtered by goal, NOT rendered straight from the store: `fetchAttempts` never clears
  // `attempts` — it only flips `attemptsLoading` — so after a goal switch the previous goal's
  // rows stay counted until the new read lands, and the recap would describe the wrong goal.
  const goalAttempts = useMemo(
    () => attempts.filter((attempt) => attempt.goal_id === goalId),
    [attempts, goalId],
  )

  /**
   * The day the screen is showing, not "the last 50 rows".
   *
   * The store reads 50 attempts for the goal with no date bound, so without this a learner
   * returning after a week would read last week's work under a heading about now.
   */
  const todaysAttempts = useMemo(
    () => goalAttempts.filter((attempt) => utcToLocalDateKey(attempt.created_at) === planDate),
    [goalAttempts, planDate],
  )
  const recap = useMemo(() => studyRecap(todaysAttempts), [todaysAttempts])

  // Nothing studied today is not an error and not an empty state — it is a day that has not
  // started, and the card above already says so.
  if (attemptsLoading && todaysAttempts.length === 0) return null
  if (recap.count === 0) return null

  // Each band omitted when empty: "몰랐음 0" is a sentence about nothing, and a learner who got
  // everything right should read one word, not a row of zeroes.
  const bands = [
    recap.known > 0 ? t('history.band.known', { count: recap.known }) : null,
    recap.partial > 0 ? t('history.band.partial', { count: recap.partial }) : null,
    recap.missed > 0 ? t('history.band.missed', { count: recap.missed }) : null,
  ].filter(Boolean).join(' · ')

  return (
    <section className="pt-2">
      <h2 className="text-sm font-medium text-foreground">{t('history.title')}</h2>
      <div className="mt-2 rounded-xl border border-border bg-card p-3" data-testid="study-recap">
        <p className="text-sm text-foreground">
          {t('history.recap', {
            count: recap.count,
            minutes: Math.round(recap.totalMs / 60000),
            seconds: Math.round(recap.avgMs / 1000),
          })}
        </p>
        {bands && <p className="mt-1 text-xs text-content-tertiary">{bands}</p>}
      </div>
    </section>
  )
}


/**
 * What is working and what is not — over the last 30 days, not today.
 *
 * The engine behind this (`summarizeLearning`, shared/lib/learning-insights.ts) has existed the
 * whole time, along with `fetchInsights` and the copy in all 16 locale files. Nothing rendered
 * it, so the app could compute a learner's accuracy, their typical answer time, their plan
 * adherence and the cards they keep failing — and showed them none of it.
 *
 * The weak cards are a COUNT and a BUTTON, never a list. A column of cards you got wrong, with
 * nothing to do about it, is the exact shape this screen has already been cleaned of twice. The
 * button starts a session over precisely those cards, which the ordinary SRS queue would never
 * serve because a card you keep failing is usually not due.
 *
 * One button per deck: `finalize_study_session` takes one `p_deck_id` and refuses a session
 * whose rating events span decks, so weak cards from two decks are two sessions.
 */
function LearningDiagnostics({ goalId }: { goalId: string }) {
  const { t } = useTranslation('learning')
  const { insights, weakCardDecks, insightsLoading, insightsGoalId, fetchInsights } = useLearningStore()
  const { decks } = useDeckStore()

  useEffect(() => { void fetchInsights(goalId) }, [goalId, fetchInsights])

  /**
   * Weak cards grouped by the deck that holds them, worst first.
   *
   * Read from the store's own answer, NOT recomputed: `insightsGoalId` is what stops the
   * previous goal's weak cards being offered under this goal's heading for one round trip.
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

  // Nothing studied is not an empty state to decorate — there is simply nothing to diagnose.
  if (insightsLoading && !insights) return null
  if (!insights || insightsGoalId !== goalId || insights.attemptCount === 0) return null

  const deckName = (deckId: string) =>
    decks.find((deck) => deck.id === deckId)?.name ?? t('insights.cardFallback')

  // Percent, not a ratio, and only when something was actually scored. `accuracy` is null when
  // no attempt carried a score, which is a different statement from 0%.
  const pct = (value: number | null) => (value === null ? null : Math.round(value * 100))
  const accuracy = pct(insights.accuracy)
  const adherence = pct(insights.overallAdherence)

  const stats = [
    accuracy === null
      ? t('insights.notScoredYet')
      : t('insights.accuracyValue', { pct: accuracy }),
    insights.medianDurationMs === null
      ? null
      : t('insights.typicalValue', { seconds: Math.round(insights.medianDurationMs / 100) / 10 }),
    adherence === null ? null : t('insights.adherenceValue', { pct: adherence }),
  ].filter(Boolean).join(' · ')

  return (
    <section className="pt-2" aria-label={t('insights.title')}>
      <h2 className="text-sm font-medium text-foreground">{t('insights.title')}</h2>

      <div className="mt-2 rounded-xl border border-border bg-card p-3" data-testid="insights-stats">
        <p className="text-sm text-foreground">{stats}</p>
        <p className="mt-1 text-[11px] text-content-tertiary">{t('insights.scopeNote')}</p>
      </div>

      {weakByDeck.length > 0 && (
        <div className="mt-2 space-y-2" data-testid="insights-weak">
          {/* The count lives on the row, which is the thing you press. Saying it twice is the
              noise this screen keeps being cleaned of. */}
          <p className="text-xs text-muted-foreground">{t('insights.weakTitle')}</p>
          {weakByDeck.map((group) => (
            <Link
              key={group.deckId}
              to={`/decks/${group.deckId}/study?mode=srs&cards=${group.cardIds.join(',')}`}
              className="flex w-full items-center justify-between gap-3 rounded-lg border border-border bg-card px-3 py-2.5 text-sm text-foreground no-underline transition-colors hover:bg-accent"
            >
              <span className="min-w-0 truncate">
                {weakByDeck.length > 1 ? deckName(group.deckId) : t('insights.weakStudy')}
              </span>
              <span className="shrink-0 text-xs text-brand">
                {t('insights.weakCount', { count: group.cardIds.length })}
              </span>
            </Link>
          ))}
          <p className="text-[11px] text-content-tertiary">{t('insights.weakHint')}</p>
        </div>
      )}
    </section>
  )
}

/**
 * Where a goal stands.
 *
 * The headline names the measurement instead of renaming it: `known` is "still inside its review
 * window", not "확실히 안다". It used to read "29장 중 1장 기억" over a goal where 18 reviews were
 * overdue and 10 cards had never been opened — a sentence that sounds like near-total amnesia and
 * means nothing of the kind. The line under it carries what to do about it.
 */
function GoalProgress({ knowledge, newCardsPerDay, adherence, done }: {
  knowledge: GoalKnowledge | null
  /** The goal's intake cap. Without it an unseen card has no honest start date. */
  newCardsPerDay: number
  /** Share of planned items actually completed, or null before there is any history. */
  adherence: number | null
  /** The goal is already STAMPED completed. A record, not a live reading of the ratio. */
  done: boolean
}) {
  const { t } = useTranslation('learning')
  if (!knowledge || knowledge.total === 0) return null

  const summary = goalKnowledgeSummary(knowledge)
  const completion = goalCompletion(knowledge, { newCardsPerDay, adherence })

  /**
   * The headline changes with the state, because the useful sentence does.
   *
   * A fixed "배운 N장 중 M장이 복습 주기 안에 있어요" degenerates the moment nothing is overdue:
   * it becomes "17장 중 17장", which is true, vacuous, and sits above a plan card offering 12
   * cards it never mentions. Behind on reviews is the one state with something to do today, so
   * that leads; otherwise the sentence names where the goal stands, against its own total.
   */
  const headline = summary.notStarted
    ? t('progress.notStarted', { total: summary.total })
    : summary.behind
      ? t('progress.behind', { count: summary.overdue })
      : t('progress.studied', { total: summary.total, attempted: summary.attempted })

  /**
   * The line under it carries what the headline did not, and never a zero.
   *
   * When behind, "배운 N장" — the reassurance the headline just took away. Otherwise the split
   * the headline's `attempted` is made of. `아직 안 배움` is the number that ties this card to
   * the plan card below it: those cards ARE tomorrow's, and usually today's, work.
   */
  const detail = summary.notStarted ? '' : [
    summary.behind
      ? t('progress.detailStudied', { count: summary.attempted })
      : t('progress.detailWithinWindow', { count: summary.withinWindow }),
    summary.unstudied > 0 ? t('progress.unstudied', { count: summary.unstudied }) : null,
  ].filter(Boolean).join(' · ')

  return (
    <section className="rounded-xl border border-border bg-card p-4" aria-label={t('progress.title')}>
      <p className="text-sm text-foreground" data-testid="progress-headline">{headline}</p>
      {/* `attempted / total`. It may only fill when there is no card left to reach — the old
          `known / attempted` hit 100% as soon as nothing was overdue, so a goal with 12 cards
          never opened drew a complete bar. */}
      <div
        className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-valuenow={summary.percent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={t('progress.title')}
      >
        <div className="h-full bg-brand" style={{ width: `${summary.percent}%` }} />
      </div>
      {detail && (
        <p className="mt-1.5 text-[11px] text-content-tertiary" data-testid="progress-detail">
          {detail}
        </p>
      )}

      {/* ── Where the finish line is ──────────────────────────────────────
          A goal used to have none: the status value, the transition and the `target` column
          all existed and nothing ever decided. Under SRS nothing decides itself either —
          intervals grow and reviews never stop — so this is the product saying when it is
          willing to call the work done. */}
      {done ? (
        <p className="mt-2 text-xs font-medium text-success" data-testid="goal-complete">
          {t('completion.done')}
        </p>
      ) : (
        <p className="mt-2 text-[11px] text-content-tertiary" data-testid="goal-completion">
          {t('completion.progress', {
            mature: completion.mature, required: completion.required,
          })}
          {/* No date when there is no honest one: uncapped intake has no "start them all at
              once" day count, and a goal too small to reach the ratio has nothing to project.
              A wrong date is acted on; a missing one is not. */}
          {completion.daysToComplete !== null && (
            <> · {t('completion.eta', { count: completion.daysToComplete })}</>
          )}
        </p>
      )}
    </section>
  )
}

export function LearningTodayPage() {
  const { t } = useTranslation('learning')
  const {
    goals, goalsLoading, fetchGoals,
    plan, planItems, planCards, planLoading, planGenerating, planError,
    planBlockedReason,
    fetchPlan, generatePlan, autoGeneratePlan, planAbsentFor, autoPlanAttempted,
    extendPlan, planExtending, planExtension,
    knowledge, fetchGoalKnowledge, completeGoalIfEarned,
    insights, insightsGoalId,
  } = useLearningStore()
  const { decks, fetchDecks } = useDeckStore()

  // The goal comes from the URL, not a dropdown. `/learning` lists the plans and each one
  // links here, so the learning screens no longer each ask "which goal?" separately.
  const { goalId: routeGoalId } = useParams<{ goalId: string }>()
  // One context per mount: the plan date must not drift mid-session, and the planner's
  // `now` is part of its input fingerprint.
  const ctx = useMemo(() => currentPlanContext(), [])

  useEffect(() => { void fetchGoals() }, [fetchGoals])
  useEffect(() => { void fetchDecks() }, [fetchDecks])

  const plannableGoals = useMemo(
    // 'completed' belongs here too. Finishing a goal is a MILESTONE, not a stop: the cards
    // keep coming due and `save_daily_plan` rejects only archived goals. Filtering it out
    // would make a goal vanish from this screen at the exact moment it was achieved.
    () => goals.filter((goal) => goal.status === 'active' || goal.status === 'completed'),
    [goals],
  )

  // An id in the URL that is not a plannable goal (archived, deleted, or someone else's) falls
  // back to nothing rather than silently showing a different goal's plan under that URL.
  const selectedGoalId = plannableGoals.some((candidate) => candidate.id === routeGoalId)
    ? routeGoalId ?? null
    : null

  useEffect(() => {
    if (selectedGoalId) void fetchPlan(selectedGoalId, ctx.planDate)
  }, [selectedGoalId, ctx.planDate, fetchPlan])

  const goal: LearningGoalWithDecks | undefined =
    plannableGoals.find((candidate) => candidate.id === selectedGoalId)

  /**
   * Build today's plan on open, once the read has come back empty.
   *
   * `autoGeneratePlan` acts only on `planAbsentFor`, a fact only a SUCCESSFUL read sets, and
   * attempts once per goal per day — so it cannot spend the 50-writes-a-day cap on the initial
   * or failed-read states, which also present as `plan === null`.
   */
  useEffect(() => {
    if (goal) void autoGeneratePlan(goal, ctx)
  }, [goal, ctx, autoGeneratePlan, planAbsentFor])

  /** The same four conditions `autoGeneratePlan` checks, so the manual button does not flash. */
  const autoWillRun = !!goal
    && planAbsentFor === `${goal.id}|${ctx.planDate}`
    && !autoPlanAttempted[`${goal.id}|${ctx.planDate}`]
    && !!goal.decks?.length

  // Judged at NOW, not the target date. At the deadline this reported "0 of 120 known" for an
  // account that had studied 55 cards, because the projection assumes you stop today.
  const judgedAt = ctx.now
  useEffect(() => {
    if (!selectedGoalId) return
    void fetchGoalKnowledge(selectedGoalId, judgedAt)
    // Ask whether the goal has earned its stamp, in the same breath as reading its progress.
    // The ratio can only move when a card's interval does, and this screen is where the
    // learner lands after studying — so the milestone is caught without polling anything.
    // The server judges; a refusal is swallowed and the next visit asks again.
    void completeGoalIfEarned(selectedGoalId)
  }, [selectedGoalId, judgedAt, fetchGoalKnowledge, completeGoalIfEarned])

  /**
   * The day's work, split by deck, because a study session cannot span decks.
   *
   * Ordered by the plan's own positions so the deck the planner put first is the one the
   * primary button starts.
   */
  const deckGroups = useMemo(() => {
    const byDeck = new Map<string, { deckId: string; pending: number; done: number; first: number }>()
    for (const item of planItems) {
      const deckId = item.card_id ? planCards[item.card_id]?.deck_id : undefined
      if (!deckId) continue
      const entry = byDeck.get(deckId)
        ?? { deckId, pending: 0, done: 0, first: item.position }
      if (item.status === 'completed') entry.done += 1
      else entry.pending += 1
      entry.first = Math.min(entry.first, item.position)
      byDeck.set(deckId, entry)
    }
    return [...byDeck.values()].sort((a, b) => a.first - b.first)
  }, [planItems, planCards])

  const deckName = (deckId: string) =>
    decks.find((deck) => deck.id === deckId)?.name ?? t('today.item.untitled')

  /**
   * The goal's decks, named.
   *
   * Resolved against the deck store rather than stored on the goal: a renamed deck should read
   * as its new name here, and a deck the learner can no longer see should simply not appear
   * rather than render an id. `goal.decks` is the goal's own link table, so this is the set the
   * PLANNER draws from — not merely the decks that happened to appear in today's plan, which
   * would hide a deck that contributed nothing today.
   */
  const deckNames = useMemo(() => {
    if (!goal) return []
    return goal.decks
      .map((link) => decks.find((deck) => deck.id === link.deck_id)?.name)
      .filter((name): name is string => !!name)
  }, [goal, decks])

  /**
   * At most three names, then a count. Dozens of decks is a real case and the alternative is a
   * paragraph of deck names sitting above the number the learner opened the screen for.
   */
  const deckSummary = useMemo(() => {
    if (deckNames.length === 0) return ''
    if (deckNames.length <= DECK_NAMES_SHOWN) return deckNames.join(', ')
    return t('today.deckListMore', {
      names: deckNames.slice(0, DECK_NAMES_SHOWN).join(', '),
      count: deckNames.length - DECK_NAMES_SHOWN,
    })
  }, [deckNames, t])

  const studyHref = (deckId: string) =>
    `/decks/${deckId}/study?mode=srs&goalId=${selectedGoalId}&planDate=${ctx.planDate}`

  const nextDeck = deckGroups.find((group) => group.pending > 0) ?? null
  const pendingTotal = deckGroups.reduce((sum, group) => sum + group.pending, 0)
  const doneTotal = deckGroups.reduce((sum, group) => sum + group.done, 0)

  /** What is LEFT today. Shared with mobile so the two screens cannot disagree about it. */
  const composition = useMemo(() => planComposition(planItems), [planItems])

  if (goalsLoading && goals.length === 0) return <ListSkeleton />

  if (!selectedGoalId) {
    return (
      <div className="mx-auto max-w-2xl p-4">
        <h1 className="text-lg font-medium text-foreground">{t('today.title')}</h1>
        <div className="mt-4 rounded-xl border border-border bg-card p-6 text-center">
          <p className="text-sm text-muted-foreground">{t('today.empty.noGoal')}</p>
          <Link
            to="/learning"
            className="mt-3 inline-block rounded-lg bg-brand px-3 py-1.5 text-sm font-medium text-white no-underline"
          >
            {t('today.backToPlans')}
          </Link>
        </div>
      </div>
    )
  }

  const errorMessageKey = (code: string): string => {
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
    <div className="mx-auto max-w-2xl space-y-4 p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="truncate text-lg font-medium text-foreground">{goal?.title ?? t('today.title')}</h1>
          {/* Which decks this plan draws from. A goal can hold dozens, so the line names a few
              and counts the rest rather than wrapping to four lines above the day's numbers. */}
          {deckSummary && (
            <p className="mt-0.5 truncate text-xs text-content-tertiary" title={deckNames.join(', ')}>
              {deckSummary}
            </p>
          )}
        </div>
        <Link to="/learning" className="shrink-0 text-xs text-brand hover:underline">
          {t('today.backToPlans')}
        </Link>
      </div>

      {/* Where this goal stands overall. */}
      <GoalProgress
        knowledge={knowledge[selectedGoalId] ?? null}
        newCardsPerDay={parseNewCardsPerDay(goal?.settings) ?? DEFAULT_NEW_CARDS_PER_DAY}
        adherence={insightsGoalId === selectedGoalId ? insights?.overallAdherence ?? null : null}
        done={goal?.status === 'completed'}
      />

      {planError && (
        <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          {t(errorMessageKey(planError.code))}
        </div>
      )}

      {planBlockedReason === 'no_decks' && goal ? (
        <div className="rounded-xl border border-border bg-card p-4 text-center">
          <p className="text-sm text-muted-foreground">{t('today.empty.noDecks')}</p>
          <Link to="/learning" className="mt-3 inline-block text-sm text-brand hover:underline">
            {t('today.empty.attachDecks')}
          </Link>
        </div>
      ) : planBlockedReason === 'no_candidates' ? (
        <div className="rounded-xl border border-border bg-card p-4 text-center">
          <p className="text-sm text-muted-foreground">{t('today.empty.nothingDue')}</p>
        </div>
      ) : planLoading ? (
        <ListSkeleton />
      ) : plan ? (
        <>
          {/* ── Today, and the way into it ──────────────────────────────── */}
          <section className="rounded-xl border border-border bg-card p-4">
            <div className="flex items-baseline justify-between gap-3">
              <p className="text-2xl font-semibold tabular-nums text-foreground">
                {pendingTotal > 0
                  ? t('today.remaining', { count: pendingTotal })
                  : t('today.allDone')}
              </p>
              <p className="shrink-0 text-xs text-content-tertiary">
                {t('today.progress', { done: doneTotal, total: plan.total_items })}
              </p>
            </div>
            <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full bg-brand transition-[width]"
                style={{ width: `${plan.total_items > 0 ? Math.round((doneTotal / plan.total_items) * 100) : 0}%` }}
                role="presentation"
              />
            </div>

            {/* All of what the per-card list used to say, in one line. A half with nothing in it
                is left out rather than printed as "0" — "복습 19장" alone already says the day has
                no new cards, and a zero invites the reader to wonder what went wrong. */}
            {(composition.review > 0 || composition.fresh > 0) && (
              <p className="mt-2 text-xs text-content-tertiary" data-testid="today-composition">
                {[
                  composition.review > 0 ? t('today.composition.review', { count: composition.review }) : null,
                  composition.fresh > 0 ? t('today.composition.fresh', { count: composition.fresh }) : null,
                ].filter(Boolean).join(' · ')}
              </p>
            )}

            {nextDeck ? (
              <>
                <Link
                  to={studyHref(nextDeck.deckId)}
                  className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-brand px-4 py-3 text-sm font-semibold text-white no-underline transition-colors hover:bg-brand-hover"
                >
                  <Play className="h-4 w-4" fill="currentColor" />
                  {doneTotal > 0 ? t('today.continueStudy') : t('today.startStudy')}
                </Link>
                {/* The rating in there does both halves at once. Said here because the old
                    screen's own small print told learners the opposite about its buttons. */}
                <p className="mt-2 text-center text-[11px] text-content-tertiary">
                  {t('today.studyNote')}
                </p>
              </>
            ) : (
              <p className="mt-4 rounded-xl bg-success/10 px-4 py-3 text-center text-sm font-medium text-success">
                {t('today.allDoneNote')}
              </p>
            )}
          </section>

          {/* Per deck, because a study session cannot span decks — one button that silently
              studied only the first would be worse than saying so. Hidden when there is only
              one deck, where the primary button already IS the whole plan. */}
          {deckGroups.length > 1 && (
            <section className="overflow-hidden rounded-xl border border-border bg-card">
              <h2 className="border-b border-border px-3 py-2 text-xs font-medium text-muted-foreground">
                {t('today.byDeck')}
              </h2>
              <ul className="divide-y divide-border">
                {deckGroups.map((group) => (
                  <li key={group.deckId} className="flex items-center justify-between gap-3 px-3 py-2.5">
                    <span className="min-w-0">
                      <span className="block truncate text-sm text-foreground">{deckName(group.deckId)}</span>
                      <span className="block text-xs text-content-tertiary">
                        {group.pending > 0
                          ? t('today.remaining', { count: group.pending })
                          : t('today.deckDone')}
                      </span>
                    </span>
                    {group.pending > 0 ? (
                      <Link
                        to={studyHref(group.deckId)}
                        className="shrink-0 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground no-underline transition-colors hover:bg-accent"
                      >
                        {t('today.item.study')}
                      </Link>
                    ) : (
                      <Check className="h-4 w-4 shrink-0 text-success" aria-label={t('today.deckDone')} />
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* "더 하기" appears only once the day is actually finished.
              Offering it beside "28장 남음" invited a learner to grow a list they had not
              started — and every card added today comes back tomorrow, so the button's real
              cost lands on a day they have not seen yet. It is an "I want more", not an
              "instead of". */}
          <div className="flex flex-col gap-2">
            {pendingTotal === 0 && (
              <button
                type="button"
                onClick={() => { if (goal) void extendPlan(goal, ctx) }}
                disabled={planExtending || planGenerating || !goal}
                className="w-full cursor-pointer rounded-lg border border-border bg-card px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent disabled:opacity-50"
              >
                {planExtending ? t('today.extending') : t('today.extend')}
              </button>
            )}

            {planExtension && (
              <p className="text-center text-xs text-content-tertiary" aria-live="polite">
                {planExtension.appended === 0
                  ? t('today.extendNothing')
                  : (
                    <>
                      {t('today.extendAdded', { count: planExtension.appended })}
                      {/* The cost, said out loud. Every card started today comes back tomorrow,
                          and a button that grows tomorrow's list in silence is how a learner
                          ends up abandoning a goal they were doing well at. */}
                      {planExtension.reviewsTomorrow > 0
                        && ` ${t('today.extendTomorrow', { count: planExtension.reviewsTomorrow })}`}
                    </>
                  )}
              </p>
            )}

          </div>
        </>
      ) : planGenerating || autoWillRun ? (
        // Building it. No button: the learner is not being asked for anything, they are being
        // told what is happening.
        <p className="py-3 text-center text-sm text-muted-foreground" aria-live="polite">
          {t('today.generating')}
        </p>
      ) : (
        // Only reachable once automation has had its turn and produced nothing — a failed save,
        // or a goal the learner has already regenerated today. The button is the way back.
        <button
          type="button"
          onClick={() => { if (goal) void generatePlan(goal, ctx) }}
          disabled={!goal}
          className="w-full cursor-pointer rounded-lg bg-brand px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-hover disabled:opacity-50"
        >
          {t('today.generate')}
        </button>
      )}

      <AttemptHistory goalId={selectedGoalId} planDate={ctx.planDate} />
      <LearningDiagnostics goalId={selectedGoalId} />
    </div>
  )
}
