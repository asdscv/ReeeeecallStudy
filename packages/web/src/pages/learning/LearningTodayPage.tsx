import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate, useParams } from 'react-router-dom'
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
import { caughtUp } from '@reeeeecall/shared/lib/caught-up'
import {
  latestAttemptForCard, attemptNeedsRemediation,
} from '@reeeeecall/shared/lib/learning-attempt-selection'
import {
  parseNewCardsPerDay, DEFAULT_NEW_CARDS_PER_DAY,
} from '@reeeeecall/shared/learning/application/cadence'
import { useQuizStore, type DailyCheckCount } from '@reeeeecall/shared/stores/quiz-store'
import type { PlanWeek, DayState } from '@reeeeecall/shared/learning/application/plan-week'
import { useDeckStore } from '../../stores/deck-store'
import { ListSkeleton } from '../../components/common/Skeleton'
import { AiRefusalNotice } from '../../components/ai/AiRefusalNotice'

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
 * How far back 오늘의 확인 may reach when today has nothing.
 *
 * Today always wins — the server only widens when today is empty. A week is the window the
 * rest of this screen already talks in, so a learner is never offered a card from a stretch
 * they have stopped thinking of as recent.
 */
const CHECK_LOOKBACK_DAYS = 7

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
        {/* The count, and nothing else.
            This read "12장 · 0분 · 카드당 평균 1초" on a real account. The 0분 and the 1초 are
            the same defect twice: the duration is whole-card dwell — it starts when the card
            appears and ends when the learner taps a rating, so it includes reading the answer
            and is zero on every attempt written without one. A "카드당 평균 1초" tells a
            learner they are rushing when what it measured was how fast they tap a button that
            was already showing them the answer. */}
        <p className="text-sm text-foreground">
          {t('history.recapCount', { count: recap.count })}
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

  /**
   * One number, and it says what window it is over.
   *
   * This line read "정답률 78% · 보통 1초 · 플랜 49% 이행" and a learner asked, verbatim,
   * "플랜 49% 이행은 뭐야? 유저가 알기가 너무 힘들다". They were right on every count:
   *
   *   - the three numbers spanned TWO windows (30 days for accuracy, 14 for adherence) and
   *     neither was printed, while "알았음 6 · 몰랐음 6" — 50%, today — sat two inches above;
   *   - 보통 1초 was the median dwell on a card INCLUDING reading the answer, which is a
   *     measurement of how fast you tap, not of how fast you recall;
   *   - 플랜 이행 named no window, no numerator and no denominator, and there was nothing a
   *     learner could do on seeing it that they would not have done anyway.
   *
   * Adherence has not been deleted — it still stretches the completion estimate, where it is
   * now labelled — and the week strip above shows the same thing as seven days a learner can
   * count. Typical time is gone outright: nothing on this screen can act on it.
   */
  const stats = accuracy === null
    ? t('insights.notScoredYet')
    : t('insights.accuracyValue', {
      pct: accuracy,
      scored: insights.scoredCount,
      known: Math.round((insights.accuracy ?? 0) * insights.scoredCount),
    })

  return (
    <section className="pt-2" aria-label={t('insights.title')}>
      <h2 className="text-sm font-medium text-foreground">{t('insights.title')}</h2>

      <div className="mt-2 rounded-xl border border-border bg-card p-3" data-testid="insights-stats">
        <p className="text-sm text-foreground">{stats}</p>
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

          {/* The one paid AI action in the learning plan, and the one place it is grounded.
              A weak card is a card the learner has attempted twice or more and missed most of
              the time — so there IS a real attempt to explain, which is what the server
              refuses to proceed without. */}
          <WeakCardExplain goalId={goalId} cardIds={weakByDeck.flatMap((g) => g.cardIds)} />
        </div>
      )}
    </section>
  )
}

/**
 * "왜 자꾸 틀리는지" — the learning plan's one paid model call.
 *
 * Everything else on this screen is computed on the device: the plan is a deterministic ranker,
 * the week strip is a SQL digest, the coach is an ordered rule chain over eight integers, and
 * 오늘의 확인 asks the card's own question. The owner asked, fairly, 뭐가 AI란 말이야. This is
 * the answer — and the whole server half of it has been deployed the entire time with no caller:
 * the edge function's `kind: 'remediation'` branch reserves against the wallet, loads the
 * grounding, prompts, validates, persists, and releases the hold when the model fails.
 *
 * Grounded, or refused. `learning-attempt-selection.ts` picks the attempt — the most recent one
 * on the card — and only offers the button when that attempt was actually a MISS
 * (`normalized_score < 0.75`). Selling an explanation of something the learner just said they
 * knew would be selling a premise that does not exist, and `explain` on a success has nothing
 * to work with beyond the card itself.
 */
function WeakCardExplain({ goalId, cardIds }: { goalId: string; cardIds: readonly string[] }) {
  const { t, i18n } = useTranslation('learning')
  const {
    attempts, requestRemediation, dismissRemediation,
    loadRemediation, showOwnedRemediation, remediationOwned,
    remediation, remediationBusyAttemptId, remediationError,
  } = useLearningStore()

  /**
   * The weakest card that has an attempt worth explaining.
   *
   * One button, not one per card. A column of paid buttons is a shop; the learner asked which
   * card they keep missing, and the list above already answers that.
   */
  const target = useMemo(() => {
    const found = cardIds
      .map((cardId) => ({ cardId, attempt: latestAttemptForCard(attempts, cardId) }))
      .find((candidate) => attemptNeedsRemediation(candidate.attempt))
    return found?.attempt ? { cardId: found.cardId, attempt: found.attempt } : null
  }, [attempts, cardIds])

  const targetAttemptId = target?.attempt.id ?? null

  /**
   * Was this already bought?
   *
   * A free read of `user_enrichments`, whose owner-read policy has existed since the table did
   * and which nothing had ever used. Without it the answer lived only in memory, so a reload —
   * or 닫기, a button that says "close" — left the paid button as the only way back to a
   * paragraph the learner had already been charged for.
   */
  useEffect(() => {
    if (!targetAttemptId || typeof loadRemediation !== 'function') return
    void loadRemediation({ attemptId: targetAttemptId, action: 'explain' })
  }, [targetAttemptId, loadRemediation])

  if (!target || !targetAttemptId) return null

  const shown = remediation?.attemptId === targetAttemptId ? remediation : null
  const owned = remediationOwned?.[targetAttemptId] ?? null
  const busy = remediationBusyAttemptId === targetAttemptId

  return (
    <div className="mt-2 rounded-lg border border-brand/30 bg-brand/5 p-3" data-testid="weak-explain">
      {shown ? (
        <>
          <p className="text-sm text-foreground">{shown.summary}</p>
          {shown.blocks.map((block, i) => (
            typeof block.content === 'string' && block.content.trim() !== '' ? (
              <p key={i} className="mt-1.5 text-xs text-content-tertiary">{block.content}</p>
            ) : null
          ))}
          {/* The model's own reservations, when it had any. Dropping them would present a
              hedged answer as a confident one. */}
          {shown.warnings.map((warning, i) => (
            <p key={`w${i}`} className="mt-1.5 text-[11px] text-amber-600">{warning}</p>
          ))}
          <button
            type="button"
            onClick={dismissRemediation}
            className="mt-3 cursor-pointer text-xs text-brand underline underline-offset-2"
          >
            {t('explain.dismiss')}
          </button>
        </>
      ) : owned ? (
        /* Bought, and closed. Reopening is free and must not look like the paid button —
           offering "왜 자꾸 틀리는지 설명 받기" with its 크레딧 note over something already
           paid for is how a learner buys the same paragraph twice. */
        <button
          type="button"
          onClick={() => { showOwnedRemediation(targetAttemptId) }}
          className="w-full cursor-pointer rounded-lg border border-brand/40 px-3 py-2 text-sm font-medium text-brand transition-colors hover:bg-brand/10"
          data-testid="weak-explain-reopen"
        >
          {t('explain.reopen')}
        </button>
      ) : (
        <>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              void requestRemediation({
                action: 'explain',
                goalId,
                attemptId: targetAttemptId,
                cardId: target.cardId,
                uiLang: i18n.language,
              })
            }}
            className="w-full cursor-pointer rounded-lg bg-brand px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-hover disabled:opacity-50"
            data-testid="weak-explain-ask"
          >
            {busy ? t('explain.asking') : t('explain.ask')}
          </button>
          <p className="mt-2 text-[11px] text-content-tertiary">{t('explain.note')}</p>
        </>
      )}
      {/* One rendering for every paid refusal in the app. This block used to be a ternary
          over two codes plus a hand-added <Link to="/settings"> and a six-line comment
          explaining why the learning plan was the only screen that needed one — which was
          itself the argument for putting the route on the classification instead. */}
      <AiRefusalNotice
        code={remediationError?.code}
        actionId="remediation"
        className="mt-2"
      />
    </div>
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
function GoalProgress({ knowledge, newCardsPerDay, done }: {
  knowledge: GoalKnowledge | null
  /** The goal's intake cap. Without it an unseen card has no honest start date. */
  newCardsPerDay: number
  /** The goal is already STAMPED completed. A record, not a live reading of the ratio. */
  done: boolean
}) {
  const { t } = useTranslation('learning')
  if (!knowledge || knowledge.total === 0) return null

  const summary = goalKnowledgeSummary(knowledge)
  const completion = goalCompletion(knowledge, { newCardsPerDay })
  // Progress toward the finish line this card names, so the bar cannot disagree with the
  // sentence beneath it.
  const maturePercent = completion.required > 0
    ? Math.min(100, Math.round((completion.mature / completion.required) * 100))
    : 0

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
  // The detail line no longer swaps with the headline. It used to print a bare "배운 29장"
  // whenever the headline was about a backlog — a count with no denominator, one line under a
  // different count with a different one. Every number on this card is now a named part of
  // `total`, and nothing on it changes population depending on the state.

  


/**
   * The line under it carries what the headline did not, and never a zero.
   *
   * When behind, "배운 N장" — the reassurance the headline just took away. Otherwise the split
   * the headline's `attempted` is made of. `아직 안 배움` is the number that ties this card to
   * the plan card below it: those cards ARE tomorrow's, and usually today's, work.
   */
  const detail = summary.notStarted ? '' : [
    // Each half omitted when it is empty. "복습 주기 안 0장" is a sentence about nothing, and
    // it appears for real: a learner who has just answered every card has them all in learning
    // steps, so `known` is 0 while `attempted` is the whole deck. Seen on a live account while
    // verifying this very card.
    summary.withinWindow > 0
      ? t('progress.detailWithinWindow', { count: summary.withinWindow }) : null,
    summary.unstudied > 0 ? t('progress.unstudied', { count: summary.unstudied }) : null,
  ].filter(Boolean).join(' · ')

  return (
    <section className="rounded-xl border border-border bg-card p-4" aria-label={t('progress.title')}>
      <p className="text-sm text-foreground" data-testid="progress-headline">{headline}</p>
      {/* The bar and the line under it are now the SAME statement: 정착한 카드 / 필요한 수.
          It used to draw `attempted / total` — cards opened at least once — which fills the
          moment every card has been seen. A learner saw a 100% bar directly above "복습이 12장
          밀렸어요" and "완료까지 약 25일", because those three lines answered three different
          questions and only one of them was named. */}
      <div
        className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-valuenow={maturePercent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={t('progress.title')}
      >
        <div className="h-full bg-brand" style={{ width: `${maturePercent}%` }} />
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
          {/* The population is named in the same sentence as the target. "24장 중 14장 정착"
              one line under "배운 29장" made the deck look like it had shrunk from 29 to 24 —
              24 is not a set of cards, it is 80% of 29 rounded up. */}
          {t('completion.progress', {
            mature: completion.mature,
            required: completion.required,
            total: summary.total,
          })}
          {/* No date when there is no honest one: uncapped intake has no "start them all at
              once" day count, and a goal too small to reach the ratio has nothing to project.
              A wrong date is acted on; a missing one is not.

              Two numbers, because the single one was unreadable. "완료까지 약 25일" was
              `12 / 0.49` — twelve being what the cards themselves need, and 0.49 being the
              learner's plan adherence, which appeared nowhere near it. Saying both makes the
              gap the learner's to close instead of a number only the code understands. */}
          {completion.daysToComplete !== null && (
            <> · {t('completion.etaIfDaily', {
              count: completion.daysToComplete,
              remaining: completion.remaining,
            })}</>
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
    extendPlan, planExtending, planExtension, generateAheadPlan,
    knowledge, fetchGoalKnowledge, completeGoalIfEarned,
    planErrorFrom,
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

  /**
   * Which kind of "nothing due" this is — see `caught-up.ts`.
   *
   * Read against a FRESH instant rather than `ctx.now`: the empty state is looked at after a
   * session, and "5분 뒤" measured from when the page was opened is the wrong five minutes.
   */
  const caughtUpState = useMemo(
    () => caughtUp(
      selectedGoalId ? knowledge[selectedGoalId]?.nextDueAt ?? null : null,
      new Date().toISOString(),
    ),
    [knowledge, selectedGoalId],
  )

  /** A wall-clock time the learner can compare to their own clock. `Intl` is fine on web. */
  const formatWhen = (iso: string | null) => {
    if (!iso) return ''
    const at = new Date(iso)
    return at.toLocaleString(undefined, {
      month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit',
    })
  }
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

  /**
   * The day's totals come from the PLAN, not from the per-deck grouping.
   *
   * `deckGroups` drops any item whose card it cannot resolve (`if (!deckId) continue` above) —
   * a card deleted after the plan was written, or a `planCards` read that has not landed. Summing
   * it meant a plan of twelve untouched items could report `pending: 0` and put "오늘 끝!" over
   * its own "12개 중 0개 완료". That is the same defect as everything else on this screen: a
   * headline and a number underneath it counted from two different populations.
   *
   * `total_items` and `completed_items` are maintained by the server on every rating, so they
   * cannot shrink because a client-side lookup missed.
   */
  const doneTotal = plan?.completed_items ?? 0
  const pendingTotal = Math.max(0, (plan?.total_items ?? 0) - doneTotal)
  /** Work the plan claims but no deck can be reached for — see above. Normally zero. */
  const unreachable = Math.max(
    0, pendingTotal - deckGroups.reduce((sum, group) => sum + group.pending, 0))

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

  /**
   * The sentence has to be about what actually failed.
   *
   * The default used to be "플랜을 만들지 못했습니다. 다시 시도해 주세요." for every failure on
   * this screen, because six store actions wrote one `planError`. A learner photographed that
   * banner sitting directly above a plan of 29 items that had just been extended successfully:
   * the plan HAD been built, something else had failed, and the message named the one thing
   * that had not gone wrong.
   *
   * The actions that are not about the plan no longer write here at all. The ones that remain
   * say which they were, and only the generic code falls back to a per-action sentence.
   */
  const errorMessageKey = (code: string, from: typeof planErrorFrom): string => {
    switch (code) {
      case 'LIMIT_EXCEEDED': return 'today.error.limitExceeded'
      case 'CONFLICT': return 'today.error.completedPlan'
      case 'NOT_FOUND': return 'today.error.goalGone'
      case 'INVALID_INPUT': return 'today.error.invalidInput'
      case 'AUTH_REQUIRED': return 'today.error.authRequired'
      case 'FORBIDDEN': return 'today.error.forbidden'
      default:
        return from === 'extend' ? 'today.error.extendFailed'
          : from === 'record' ? 'today.error.recordFailed'
            : from === 'read' ? 'today.error.readFailed'
              : 'today.error.unknown'
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
        done={goal?.status === 'completed'}
      />

      {planError && (
        <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          {t(errorMessageKey(planError.code, planErrorFrom))}
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
        /* "오늘 이 덱들에서 복습할 카드가 없습니다" read as a failure — the learner's cards had
           gone somewhere. The truth in the photographed state was the opposite: they had just
           finished, and twelve cards were coming back inside ten minutes. Nothing due is three
           situations, and only the last of them is bad news. */
        <div className="rounded-xl border border-border bg-card p-4 text-center">
          <p className="text-sm font-medium text-foreground">{t('today.empty.allCaughtUp')}</p>
          <p className="mt-1 text-xs text-content-tertiary">
            {caughtUpState.kind === 'soon'
              ? t('today.empty.backSoon', { count: caughtUpState.minutes ?? 1 })
              : caughtUpState.kind === 'later'
                ? t('today.empty.nextReview', { when: formatWhen(caughtUpState.atISO) })
                : t('today.empty.nothingScheduled')}
          </p>
          {/* The day daily study was impossible from.
              `더 하기` lives inside the plan branch, and on a day with nothing due there IS no
              plan — so a goal set to seven days a week offered nothing at all on most days.
              This is the way in: it builds today out of cards whose turn has not come, on a
              press, and the line under it says that is what it did. */}
          {caughtUpState.kind !== 'empty' && goal && (
            <>
              <button
                type="button"
                onClick={() => { void generateAheadPlan(goal, ctx) }}
                disabled={planGenerating}
                className="mt-3 w-full cursor-pointer rounded-lg border border-border bg-card px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent disabled:opacity-50"
                data-testid="study-ahead"
              >
                {planGenerating ? t('today.generating') : t('today.studyAhead')}
              </button>
              <p className="mt-2 text-[11px] text-content-tertiary">{t('today.studyAheadNote')}</p>
            </>
          )}
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
            ) : pendingTotal > 0 ? (
              /* The plan says there is work and no deck can be reached for it. Saying "다
                 했어요" here is the lie the totals used to tell; naming it is the only honest
                 move, because there is nothing on this screen the learner can press. */
              <p className="mt-4 rounded-xl bg-muted px-4 py-3 text-center text-sm text-muted-foreground">
                {t('today.itemsUnavailable', { count: unreachable || pendingTotal })}
              </p>
            ) : (
              /* "내일 또 만나요" is wrong whenever the cards come back sooner than that — and
                 after a session they usually do, because anything rated 몰랐음 returns in one
                 to ten minutes. Photographed saying it with the next review seven minutes
                 away. Same reading as the empty state; see `caught-up.ts`. */
              <p className="mt-4 rounded-xl bg-success/10 px-4 py-3 text-center text-sm font-medium text-success">
                {caughtUpState.kind === 'soon'
                  ? t('today.backSoonNote', { count: caughtUpState.minutes ?? 1 })
                  : t('today.allDoneNote')}
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
                      {/* Studying early has a real cost — the interval is set from THIS
                          answer, not from the one the scheduler was waiting for — so it is
                          offered and then said out loud, never done silently. */}
                      {planExtension.aheadOfSchedule
                        && ` ${t('today.extendAhead', { count: planExtension.appended })}`}
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
      ) : planErrorFrom === 'read' ? (
        /* The READ failed, so we do not know whether a plan exists — `fetchPlan`'s catch says
           so explicitly by leaving `planAbsentFor` null. This branch used to fall through to
           the generate button, which is not a retry: it BUILDS a plan, replacing whatever was
           already there and taking `completed_items` back to zero. A learner who finished nine
           of twelve cards and hit a flaky network was one tap from losing the record of it.
           A read that failed is answered by reading again. */
        <button
          type="button"
          onClick={() => { if (goal) void fetchPlan(goal.id, ctx.planDate) }}
          disabled={!goal || planLoading}
          className="w-full cursor-pointer rounded-lg border border-border px-3 py-2 text-sm font-medium transition-colors hover:bg-muted disabled:opacity-50"
          data-testid="learning-plan-retry"
        >
          {t('today.retry')}
        </button>
      ) : (
        // Only reachable once automation has had its turn and produced nothing — a failed save,
        // or a goal the learner has already regenerated today. The button is the way back.
        <button
          type="button"
          onClick={() => { if (goal) void generatePlan(goal, ctx) }}
          disabled={!goal}
          className="w-full cursor-pointer rounded-lg bg-brand px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-hover disabled:opacity-50"
          data-testid="learning-generate"
        >
          {t('today.generate')}
        </button>
      )}

      <PlanWeekSection goalId={selectedGoalId} timezone={ctx.timezone} />

      <DailyCheck goalId={selectedGoalId} timezone={ctx.timezone} />

      <AttemptHistory goalId={selectedGoalId} planDate={ctx.planDate} />
      <LearningDiagnostics goalId={selectedGoalId} />
    </div>
  )
}

/**
 * 오늘의 확인 — the first thing in this app that asks whether the learner was RIGHT.
 *
 * Everything the plan has ever recorded is the learner grading themselves: every activity
 * is `recall`/`self_rate`, and the planner's own `practice`/`produce` budget has no
 * candidates to fill it. So the plan's numbers describe how confident someone felt, and
 * any coach built on them is reasoning about confidence rather than knowledge.
 *
 * This is deliberately small. It appears only when there is something to check, it never
 * blocks finishing the day, and it costs nothing to open: the question is the card's own
 * prompt and the reference is its own declared answer field, so no model is called to make
 * it. The learner is charged later, and only for answers a string comparison could not
 * settle — a day they knew is free.
 */
function DailyCheck({ goalId, timezone }: { goalId: string; timezone: string }) {
  const { t, i18n } = useTranslation('learning')
  const navigate = useNavigate()
  const { countDailyCheck, buildDailyCheck, startRun } = useQuizStore()
  const [counts, setCounts] = useState<DailyCheckCount | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    // Same guard as the coach: an effect that throws produces an unhandled rejection, and a
    // partially-mocked store has no such action.
    if (typeof countDailyCheck !== 'function') return
    let cancelled = false
    // Today first — the server only widens when today has nothing. Without this the section
    // was invisible until the learner had already studied, which is when they are leaving.
    void countDailyCheck(timezone, CHECK_LOOKBACK_DAYS)
      .then((value) => { if (!cancelled) setCounts(value) })
      .catch(() => { if (!cancelled) setCounts(null) })
    return () => { cancelled = true }
  }, [countDailyCheck, timezone, goalId])

  if (!counts) return null

  // Studied plenty, none of it resolvable. On a real deck this is the COMMON way the check
  // fails, not an edge: a template with two `primary` back fields cannot say which one is the
  // answer, so every card of it is refused — and on the deck this was measured against, one
  // of those two fields is the learner's own wrong expression. Refusing is right. Refusing
  // invisibly is what made the section look like it did not exist.
  //
  // So it says so, and links to the one setting that fixes it.
  if (counts.checkable === 0) {
    const blocker = counts.blocked?.[0]
    if (!blocker || counts.studiedToday === 0) return null
    return (
      <section className="rounded-xl border border-border bg-card p-4" data-testid="check-blocked">
        <p className="text-sm font-medium text-foreground">{t('check.blockedTitle')}</p>
        <p className="mt-0.5 text-xs text-content-tertiary">
          {t('check.blockedBody', { name: blocker.name, count: blocker.cards })}
        </p>
        <Link
          to={`/templates/${blocker.template_id}/edit`}
          className="mt-3 inline-flex rounded-lg border border-border px-3 py-2 text-sm font-medium text-foreground no-underline transition-colors hover:bg-accent"
        >
          {t('check.blockedAction')}
        </Link>
      </section>
    )
  }

  const start = async () => {
    setBusy(true)
    try {
      // The SAME window the count was taken with, or the server refuses a check this
      // screen has already offered.
      const setId = await buildDailyCheck({
        goalId, timezone, lookback: CHECK_LOOKBACK_DAYS,
        // The check is built with one tap and no options, so this is the only place
        // the learner's language can come from. Without it every check was Korean.
        locale: i18n.language.split('-')[0],
      })
      const runId = await startRun(setId)
      navigate(`/quiz/${runId}/run`)
    } catch {
      setBusy(false)
    }
  }

  return (
    <section className="rounded-xl border border-brand/30 bg-brand/5 p-4">
      {/* Named for the window it actually drew from. Being told these are today's cards on
          a day you did not study is the kind of small lie that costs a feature its
          credibility the first time a learner notices. */}
      <p className="text-sm font-medium text-foreground">
        {counts.windowDays > 1
          ? t('check.recentTitle', { count: counts.checkable })
          : t('check.title', { count: counts.checkable })}
      </p>
      <p className="mt-0.5 text-xs text-content-tertiary">
        {counts.windowDays > 1 ? t('check.recentBody') : t('check.body')}
      </p>
      <button
        type="button"
        onClick={() => void start()}
        disabled={busy}
        className="mt-3 w-full cursor-pointer rounded-lg bg-brand px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-hover disabled:opacity-50"
      >
        {busy ? t('check.starting') : t('check.start')}
      </button>
    </section>
  )
}


/**
 * 이번 주 — the section that is allowed to be boring.
 *
 * The plan screen had five sections and every one of them could render nothing. Each guard
 * was individually right: none of those sections has anything TRUE to say in the state it
 * hides in. Together they meant the screen was one card and a button for a learner who had
 * not studied yet today — which is every learner at the moment they open the app to decide
 * whether to study. That is the 그대로네? in the report.
 *
 * So this one never hides. The last seven days happened; saying so needs no model, no
 * minimum history and no judgement, and a learner on their first day has a week with one day
 * in it, which is a legitimate thing to show them.
 *
 * The coach lives INSIDE it now rather than beside it. 주간 플랜 코치 is deterministic and
 * free (see `plan-coach.ts`) but it is silent by design — it holds for a short week and
 * holds again whenever nothing is wrong, which is most weeks. As its own section that made
 * it a section-shaped hole; as a row under a strip that is always there, its silence just
 * means the week needs no comment.
 *
 * `그대로 둘게요` is not a cancel. It is dismissal, recorded, and it survives every
 * regeneration — a suggestion the learner has already answered must not come back next week
 * as if they had not.
 */
function PlanWeekSection({ goalId, timezone }: { goalId: string; timezone: string }) {
  const { t } = useTranslation('learning')
  const {
    recommendations, fetchRecommendations, regeneratePlanCoach, applyPlanCoach,
    resolveRecommendation, planWeek, planWeekGoalId,
  } = useLearningStore()
  const [busy, setBusy] = useState(false)

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

  // Defensive: a partially-mocked store (and the very first render, before the fetch
  // resolves) has no list yet.
  const suggestion = (recommendations ?? []).find(
    (r) => r.goal_id === goalId && r.status === 'pending' && r.card_id === null,
  )
  // `hold` is a real answer — it means nothing is wrong — and it is stored so the producer's
  // output can be compared later. It is not something to put on a learner's screen.
  const advice = suggestion && suggestion.action_type !== 'hold' ? suggestion : null
  const value = (advice?.payload as { value?: number | null } | null)?.value ?? null

  // The guard is on the DATA, not on whether it is interesting: an older server (or a
  // rollback of 209) sends no `by_day`, and an empty strip would read as a week in which the
  // learner did nothing.
  const week = planWeekGoalId === goalId ? planWeek : null
  if (!week) return null

  return (
    <section className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-medium text-foreground">{t('week.title')}</h2>
        <p className="shrink-0 text-xs text-content-tertiary">
          {t('week.activeDays', { count: week.activeDays })}
        </p>
      </div>

      <PlanWeekStrip week={week} />

      <p className="mt-2 text-xs text-content-tertiary" data-testid="plan-week-summary">
        {week.streak > 0
          ? t('week.streak', { count: week.streak })
          // Measured on the live account: 1 active day, streak 0. "이번 주는 아직 기록이
          // 없어요" beside "1일 학습" is the screen contradicting itself in two lines.
          : week.activeDays > 0
            ? t('week.streakBroken')
            : t('week.streakNone')}
        {/* Only alongside a real plan. A percentage of nothing is not 0%, it is a question
            nobody asked, and it reads as a grade for a test the learner never sat. */}
        {week.completion !== null
          && ` · ${t('week.completion', { pct: Math.round(week.completion * 100) })}`}
      </p>

      {advice && (
        <div className="mt-3 border-t border-border pt-3" data-testid="plan-coach-advice">
          <p className="text-sm font-medium text-foreground">
            {t(`coach.${advice.action_type}.title`, { value, defaultValue: '' })}
          </p>
          <p className="mt-0.5 text-xs text-content-tertiary">
            {t(`coach.${advice.action_type}.body`, { defaultValue: '' })}
          </p>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => { setBusy(true); void applyPlanCoach(advice.id).finally(() => setBusy(false)) }}
              className="flex-1 cursor-pointer rounded-lg bg-brand px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-hover disabled:opacity-50"
            >
              {t('coach.apply')}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => { setBusy(true); void resolveRecommendation(advice.id, 'dismissed').finally(() => setBusy(false)) }}
              className="cursor-pointer rounded-lg border border-border px-3 py-2 text-sm text-foreground hover:border-brand/40 disabled:opacity-50"
            >
              {t('coach.keep')}
            </button>
          </div>
        </div>
      )}
    </section>
  )
}

/**
 * Seven cells, one per day, oldest first.
 *
 * Colour is not the only channel: each cell carries its own state in `title`/`aria-label`,
 * because "which of these greys means I studied" is not a question a learner should have to
 * answer, and for a colour-blind one it is not answerable at all.
 *
 * The weekday letters come from the locale files rather than `Intl`, which Hermes does not
 * carry on mobile — the same component ships to both.
 */
function PlanWeekStrip({ week }: { week: PlanWeek }) {
  const { t } = useTranslation('learning')

  const fill: Record<DayState, string> = {
    done:      'bg-brand text-white border-brand',
    partial:   'bg-brand/25 text-foreground border-brand/40',
    extra:     'bg-success/20 text-foreground border-success/40',
    untouched: 'bg-transparent text-content-tertiary border-border',
    none:      'bg-muted/40 text-content-tertiary border-transparent',
  }

  return (
    <div className="mt-3 grid grid-cols-7 gap-1.5" data-testid="plan-week-strip">
      {week.days.map((day, i) => (
        <div
          key={day.date}
          className="flex flex-col items-center gap-1"
          data-testid={`plan-week-day-${day.state}`}
        >
          <span className="text-[10px] text-content-tertiary">
            {t(`week.dow.${day.weekday}`)}
          </span>
          <span
            title={`${day.date} · ${t(`week.legend.${day.state}`)}`}
            aria-label={`${day.date} · ${t(`week.legend.${day.state}`)}`}
            // Capped, not stretched: on a wide screen a `w-full` cell becomes a long pill and
            // the strip stops reading as seven days.
            className={`flex h-9 w-full max-w-[3rem] items-center justify-center rounded-md border text-[11px] tabular-nums ${fill[day.state]} ${
              i === week.days.length - 1 ? 'ring-1 ring-brand/40 ring-offset-1 ring-offset-card' : ''
            }`}
          >
            {/* The number is what was DONE. A cell that shows the plan's size on a day
                nobody opened would put the largest number on the emptiest day. */}
            {day.done > 0 ? day.done : day.studied > 0 ? day.studied : ''}
          </span>
        </div>
      ))}
    </div>
  )
}
