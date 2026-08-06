import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useParams } from 'react-router-dom'
import { Play, Check } from 'lucide-react'
import {
  useLearningStore,
  type LearningGoalWithDecks, type AttemptRow, type RemediationAction, type GoalKnowledge,
} from '../../stores/learning-store'
import { currentPlanContext } from '../../lib/learning-plan-date'
import { cardPromptLabel } from '@reeeeecall/shared/lib/card-prompt'
import {
  attemptNeedsRemediation, attemptTypedAnswer,
} from '@reeeeecall/shared/lib/learning-attempt-selection'
import { formatUsdMicro } from '@reeeeecall/shared/lib/ai/server-client'
import { planComposition } from '@reeeeecall/shared/lib/plan-composition'
import { goalKnowledgeSummary } from '@reeeeecall/shared/lib/goal-knowledge-summary'
import { useDeckStore } from '../../stores/deck-store'
import { ListSkeleton } from '../../components/common/Skeleton'
import { EnrichmentModal } from './EnrichmentModal'

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
 * ## The days after today
 *
 * A forecast, never a stored plan. Saving one would spend a `save_daily_plan` write on a ranking
 * computed from today's SRS state, and anything studied in between would invalidate it while it
 * sat in the database looking authoritative. So the future days run the planner and keep only
 * the shape, and say on screen that that is what they are.
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


/** Rows shown in the attempt list. The store loads 50; everything on screen counts these. */
const ATTEMPT_ROWS = 10

/** How far ahead the day strip looks. A week is as far as a forecast stays worth reading. */
const FORECAST_DAYS = 6

const DAY_MS = 86_400_000

/**
 * The two remediation actions the SERVER serves.
 *
 * `compare` is offered only where the learner actually wrote something, because the server
 * refuses an ungrounded compare and a button that spends a request to earn a refusal is worse
 * than no button at all.
 */
const REMEDIATION_ACTIONS: ReadonlyArray<{
  action: RemediationAction
  labelKey: string
  offeredFor: (attempt: AttemptRow) => boolean
}> = [
  { action: 'explain', labelKey: 'enrichment.action.explain', offeredFor: () => true },
  { action: 'hint', labelKey: 'enrichment.action.hint', offeredFor: () => true },
  {
    action: 'compare',
    labelKey: 'enrichment.action.compare',
    offeredFor: (attempt) => attemptTypedAnswer(attempt) !== null,
  },
]

/** Recent attempts for the selected goal — where paid remediation is offered. */
function AttemptHistory({ goalId }: { goalId: string }) {
  const { t, i18n } = useTranslation('learning')
  const {
    attempts, attemptsLoading, planCards, planTemplateFields, fetchAttempts,
    requestEnrichment, enrichmentPendingCardId, enrichmentQuote, loadEnrichmentQuote,
  } = useLearningStore()

  useEffect(() => { void fetchAttempts(goalId) }, [goalId, fetchAttempts])

  // Filtered by goal, NOT rendered straight from the store. `fetchAttempts` never clears
  // `attempts` — it only flips `attemptsLoading` — so after a goal switch the previous goal's
  // rows stay painted until the new read lands. Those rows carry real card and attempt ids, so
  // clicking one would spend credits explaining a card from the goal the learner just left.
  const goalAttempts = useMemo(
    () => attempts.filter((attempt) => attempt.goal_id === goalId),
    [attempts, goalId],
  )
  const visibleAttempts = useMemo(() => goalAttempts.slice(0, ATTEMPT_ROWS), [goalAttempts])

  /**
   * Paid remediation is offered only where there is a premise for it: a miss or a partial
   * recall, on a row that actually names a card. An attempt the learner just said they KNEW
   * has nothing to remediate, and charging for one would be selling an answer to a question
   * the learner did not ask.
   */
  const canRemediate = (attempt: AttemptRow): boolean =>
    attemptNeedsRemediation(attempt) && Boolean(attempt.card_id)
  const offersRemediation = visibleAttempts.some(canRemediate)

  // Read the wallet only once a row that can be acted on exists, and RE-read it when a request
  // finishes, because that request just debited the balance this line is quoting.
  useEffect(() => {
    if (!offersRemediation || enrichmentPendingCardId !== null) return
    void loadEnrichmentQuote()
  }, [offersRemediation, enrichmentPendingCardId, loadEnrichmentQuote])

  // The store's in-flight guard is GLOBAL, so a second click anywhere is silently dropped.
  // Disable every button while one request is running rather than let a row look clickable.
  const requestBusy = enrichmentPendingCardId !== null

  // Which ROW is waiting, not which card: someone who missed the same card twice has two rows
  // sharing one card_id, and keying on the card would make both claim to be the pending one.
  const [requestingAttemptId, setRequestingAttemptId] = useState<string | null>(null)

  if (attemptsLoading && goalAttempts.length === 0) return null
  if (goalAttempts.length === 0) return null

  const scoreKey = (score: number | null): string => {
    if (score === null) return 'history.score.unknown'
    if (score >= 0.75) return 'today.rate.known'
    if (score >= 0.25) return 'today.rate.partial'
    return 'today.rate.again'
  }

  return (
    <section className="pt-2">
      <h2 className="text-sm font-medium text-foreground">
        {t('history.title', { count: visibleAttempts.length })}
      </h2>
      {/* What the charge buys, as VISIBLE text rather than a `title` tooltip — a tooltip never
          reaches a keyboard or touch user. */}
      {offersRemediation && (
        <p className="mt-0.5 text-[11px] text-content-tertiary">
          {t('enrichment.groundedHint')}
          {/* The price is stated before the click, never in an error afterwards. A quote that
              could not be read renders NOTHING — `$0.00` would be a lie in the direction that
              costs the learner money. */}
          {enrichmentQuote && (
            <> · {t('enrichment.quote', {
              price: formatUsdMicro(enrichmentQuote.estPriceMicro),
              balance: formatUsdMicro(enrichmentQuote.balanceMicro),
            })}</>
          )}
        </p>
      )}
      <ul className="mt-2 divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
        {visibleAttempts.map((attempt) => {
          const card = attempt.card_id ? planCards[attempt.card_id] : undefined
          const label = cardPromptLabel(card?.field_values, card?.template_id, planTemplateFields)
          const remediable = canRemediate(attempt)
          const pending = requestingAttemptId === attempt.id
          const rowName = label || t('history.itemFallback', { type: attempt.activity_type })
          const typedAnswer = attemptTypedAnswer(attempt)
          return (
            <li key={attempt.id} className="flex items-center justify-between gap-3 px-3 py-2">
              <span className="min-w-0">
                <span className="block truncate text-xs text-foreground">{rowName}</span>
                {typedAnswer && (
                  <span className="block truncate text-[11px] text-content-tertiary">
                    {t('history.youWrote', { text: typedAnswer })}
                  </span>
                )}
              </span>
              <span className="flex shrink-0 items-center gap-2">
                <span className="text-xs text-content-tertiary">{t(scoreKey(attempt.normalized_score))}</span>
                <span className="text-[11px] text-content-tertiary">
                  {new Date(attempt.created_at).toLocaleString()}
                </span>
                {pending && (
                  <span className="text-xs text-content-tertiary">{t('enrichment.requesting')}</span>
                )}
                {remediable && REMEDIATION_ACTIONS.filter(({ offeredFor }) => offeredFor(attempt)).map(({ action, labelKey }) => (
                  <button
                    key={action}
                    type="button"
                    disabled={requestBusy}
                    onClick={() => {
                      setRequestingAttemptId(attempt.id)
                      void requestEnrichment({
                        action,
                        goalId,
                        cardId: attempt.card_id as string,
                        attemptId: attempt.id,
                        uiLang: i18n.language,
                      }).finally(() => setRequestingAttemptId(null))
                    }}
                    // Every row offers the same labels, so the text alone would give up to 20
                    // buttons two accessible names between them.
                    aria-label={`${t(labelKey)} — ${rowName}`}
                    className="cursor-pointer text-xs text-brand hover:underline disabled:opacity-50"
                  >
                    {t(labelKey)}
                  </button>
                ))}
              </span>
            </li>
          )
        })}
      </ul>
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
function GoalProgress({ knowledge }: { knowledge: GoalKnowledge | null }) {
  const { t } = useTranslation('learning')
  if (!knowledge || knowledge.total === 0) return null

  const summary = goalKnowledgeSummary(knowledge)
  // Each half is dropped when empty rather than printed as a zero: "복습 밀림 0장" is a sentence
  // about nothing, and a learner who is fully caught up should see that, not a row of noughts.
  const detail = [
    summary.overdue > 0 ? t('progress.overdue', { count: summary.overdue }) : null,
    summary.unstudied > 0 ? t('progress.unstudied', { count: summary.unstudied }) : null,
  ].filter(Boolean).join(' · ')

  return (
    <section className="rounded-xl border border-border bg-card p-4" aria-label={t('progress.title')}>
      <p className="text-sm text-foreground">
        {summary.notStarted
          ? t('progress.notStarted', { total: knowledge.total })
          : t('progress.withinWindow', {
            attempted: summary.attempted, known: summary.withinWindow,
          })}
      </p>
      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div className="h-full bg-brand" style={{ width: `${summary.percent}%` }} role="presentation" />
      </div>
      {detail && (
        <p className="mt-1.5 text-[11px] text-content-tertiary" data-testid="progress-detail">
          {detail}
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
    planForecast, planForecastLoading, forecastPlan,
    enrichment, enrichmentError,
    knowledge, fetchGoalKnowledge,
  } = useLearningStore()
  const { decks, fetchDecks } = useDeckStore()

  // The goal comes from the URL, not a dropdown. `/learning` lists the plans and each one
  // links here, so the learning screens no longer each ask "which goal?" separately.
  const { goalId: routeGoalId } = useParams<{ goalId: string }>()
  // One context per mount: the plan date must not drift mid-session, and the planner's
  // `now` is part of its input fingerprint.
  const ctx = useMemo(() => currentPlanContext(), [])
  /** 0 = today. Anything above it is a forecast, never a saved plan. */
  const [dayOffset, setDayOffset] = useState(0)

  useEffect(() => { void fetchGoals() }, [fetchGoals])
  useEffect(() => { void fetchDecks() }, [fetchDecks])

  const plannableGoals = useMemo(
    () => goals.filter((goal) => goal.status === 'active'),
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
    if (selectedGoalId) void fetchGoalKnowledge(selectedGoalId, judgedAt)
  }, [selectedGoalId, judgedAt, fetchGoalKnowledge])

  /** The day the strip is pointing at. `dayOffset === 0` is the real, saved plan. */
  const viewedDate = useMemo(
    () => new Date(Date.parse(`${ctx.planDate}T00:00:00Z`) + dayOffset * DAY_MS)
      .toISOString().slice(0, 10),
    [ctx.planDate, dayOffset],
  )

  // Forecast on demand, once per date. It runs the real planner, so it is not free — but every
  // quota and destructive cost lives in the SAVE, which this deliberately never does.
  useEffect(() => {
    if (dayOffset === 0 || !goal) return
    void forecastPlan(goal, {
      ...ctx,
      planDate: viewedDate,
      now: new Date(Date.parse(ctx.now) + dayOffset * DAY_MS).toISOString(),
    })
  }, [dayOffset, goal, ctx, viewedDate, forecastPlan])

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

  const dayLabel = (offset: number) => {
    if (offset === 0) return t('today.days.today')
    if (offset === 1) return t('today.days.tomorrow')
    return t('today.days.inDays', { count: offset })
  }

  const forecast = planForecast[viewedDate]

  return (
    <div className="mx-auto max-w-2xl space-y-4 p-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="truncate text-lg font-medium text-foreground">{goal?.title ?? t('today.title')}</h1>
        <Link to="/learning" className="shrink-0 text-xs text-brand hover:underline">
          {t('today.backToPlans')}
        </Link>
      </div>

      {/* Where this goal stands overall — unchanged by which day the strip is showing. */}
      <GoalProgress knowledge={knowledge[selectedGoalId] ?? null} />

      {/* ── Day strip ─────────────────────────────────────────────────────────
          Today is the plan; the rest are forecasts. They are the same control on
          purpose — "what is coming" is one question — but the panel below always
          says which of the two the learner is looking at. */}
      <div
        role="tablist"
        aria-label={t('today.days.label')}
        className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1"
      >
        {Array.from({ length: FORECAST_DAYS + 1 }, (_, offset) => {
          const selected = offset === dayOffset
          return (
            <button
              key={offset}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => setDayOffset(offset)}
              className={`shrink-0 cursor-pointer rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                selected
                  ? 'border-brand bg-brand text-white'
                  : 'border-border bg-card text-muted-foreground hover:bg-accent'
              }`}
            >
              {dayLabel(offset)}
            </button>
          )
        })}
      </div>

      {planError && dayOffset === 0 && (
        <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          {t(errorMessageKey(planError.code))}
        </div>
      )}

      {dayOffset > 0 ? (
        /* ── A day that has not happened ─────────────────────────────────── */
        <section className="rounded-xl border border-border bg-card p-4" aria-label={t('today.forecast.title')}>
          <h2 className="text-sm font-medium text-foreground">{t('today.forecast.title')}</h2>
          {planForecastLoading === viewedDate ? (
            <p className="mt-2 text-sm text-muted-foreground" aria-live="polite">
              {t('today.forecast.loading')}
            </p>
          ) : forecast ? (
            <>
              <p className="mt-2 text-2xl font-semibold tabular-nums text-foreground">
                {t('today.forecast.cards', { count: forecast.totalItems })}
              </p>
              <p className="mt-0.5 text-sm text-muted-foreground">
                {t('today.forecast.minutes', { count: Math.max(1, Math.round(forecast.estimatedMinutes)) })}
                {' · '}
                {t('today.forecast.breakdown', {
                  newCards: forecast.newCards, reviewCards: forecast.reviewCards,
                })}
              </p>
            </>
          ) : (
            <p className="mt-2 text-sm text-muted-foreground">{t('today.forecast.empty')}</p>
          )}
          {/* Said every time, not once: the number above is only as good as the assumption
              that nothing is studied between now and then, which is exactly the assumption a
              learner reading a plan is about to break. */}
          <p className="mt-2 text-[11px] text-content-tertiary">{t('today.forecast.note')}</p>
        </section>
      ) : planBlockedReason === 'no_decks' && goal ? (
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

          {/* "더 하기" comes first and is the primary of the two: rebuilding DELETES every item
              and zeroes the day's progress, so the additive option has to be easier to reach. */}
          <div className="flex flex-col gap-2">
            <button
              type="button"
              onClick={() => { if (goal) void extendPlan(goal, ctx) }}
              disabled={planExtending || planGenerating || !goal}
              className="w-full cursor-pointer rounded-lg border border-border bg-card px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent disabled:opacity-50"
            >
              {planExtending ? t('today.extending') : t('today.extend')}
            </button>

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

            <button
              type="button"
              onClick={() => { if (goal) void generatePlan(goal, ctx) }}
              disabled={planGenerating || planExtending || plan.status === 'completed'}
              className="w-full cursor-pointer rounded-lg px-3 py-2 text-xs text-muted-foreground transition-colors hover:bg-accent disabled:opacity-50"
            >
              {planGenerating ? t('today.regenerating') : t('today.regenerate')}
            </button>
            {plan.status === 'completed' && (
              <p className="text-center text-xs text-content-tertiary">{t('today.completedNote')}</p>
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

      {enrichmentError && (
        <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          {t(`enrichment.error.${enrichmentError}`)}
        </div>
      )}
      {enrichment && <EnrichmentModal preview={enrichment} />}

      {/* Kept on today only: the remediation offer is grounded in an attempt, and a day that
          has not happened has none. */}
      {dayOffset === 0 && <AttemptHistory goalId={selectedGoalId} />}
    </div>
  )
}
