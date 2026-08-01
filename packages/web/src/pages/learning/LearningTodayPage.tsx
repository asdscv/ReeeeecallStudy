import { useEffect, useId, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import {
  useLearningStore,
  type LearningGoalWithDecks, type AttemptRow, type RemediationAction,
} from '../../stores/learning-store'
import { currentPlanContext } from '../../lib/learning-plan-date'
import { cardPromptLabel } from '@reeeeecall/shared/lib/card-prompt'
import {
  attemptNeedsRemediation, attemptTypedAnswer, latestAttemptForCard,
} from '@reeeeecall/shared/lib/learning-attempt-selection'
import { TYPED_ANSWER_MAX_CHARS } from '@reeeeecall/shared/lib/learning-candidates'
import { formatUsdMicro } from '@reeeeecall/shared/lib/ai/server-client'
import { recallPercent } from '@reeeeecall/shared/lib/learning-recall-display'
import { ListSkeleton } from '../../components/common/Skeleton'
import { EnrichmentModal } from './EnrichmentModal'

/**
 * Today's plan for one goal.
 *
 * Plan generation is EXPLICIT — a button, never an effect. `save_daily_plan` is capped
 * at 50 writes per user per day, so a generate-on-render path would spend a real quota
 * and then start failing for the rest of the day. Reading is automatic; writing is not.
 */

/** Planner reason codes (daily-plan-v2) → the phrase shown on the row. */
const REASON_KEY: Record<string, string> = {
  due: 'today.reason.due',
  memory_risk: 'today.reason.memoryRisk',
  recent_failure: 'today.reason.recentFailure',
  slow_response: 'today.reason.slowResponse',
  goal_relevance: 'today.reason.goalRelevance',
  importance: 'today.reason.importance',
  balanced: 'today.reason.balanced',
}

/** Rows shown in the attempt list. The store loads 50; everything on screen counts these. */
const ATTEMPT_ROWS = 10

/**
 * The two remediation actions the SERVER serves.
 *
 * `compare` and `evaluate` are absent because `SERVED_ACTIONS` in the edge function refuses
 * them (Stage 0 of the compare/evaluate plan) — not, any longer, because there is nothing to
 * compare: a typed item now stores `{ self_rated, text }`. What is still missing is the
 * server-side reference answer and the refuse-don't-degrade path, so adding an entry here would
 * charge the wallet for a request the function rejects.
 *
 * The labels say what the model produces ("AI explanation" / "Study hint"), never that it read
 * an answer, because these two are grounded in the score and the card.
 */
const REMEDIATION_ACTIONS: ReadonlyArray<{ action: RemediationAction; labelKey: string }> = [
  { action: 'explain', labelKey: 'enrichment.action.explain' },
  { action: 'hint', labelKey: 'enrichment.action.hint' },
]

/** Self-rating choices for a legacy recall item (evaluator_type = self_rate). */
const SELF_RATINGS: ReadonlyArray<{ score: number; key: string }> = [
  { score: 0, key: 'today.rate.again' },
  { score: 0.5, key: 'today.rate.partial' },
  { score: 1, key: 'today.rate.known' },
]

function PlanItemRow({ position, cardText, deckId, reasonLabel, minutes, done, typed, onRate, recording, onExplain, explaining, busy, recallPercent }: {
  position: number
  cardText: string
  deckId: string | null
  reasonLabel: string
  minutes: number | null
  done: boolean
  /**
   * This item asks for a written answer — `response_type === 'text'`, decided at plan time by
   * the card's template. False keeps the row exactly as it was before typed answers existed.
   */
  typed: boolean
  onRate: (score: number, text: string) => void
  recording: boolean
  onExplain: (() => void) | null
  /**
   * Estimated chance the learner still recalls this card, whole percent, or null.
   *
   * Null when the card has no forgetting curve yet. The row then says nothing rather than
   * "0%" — a new card is not a forgotten one, and the difference is the whole point of the
   * null discipline in the memory model.
   */
  recallPercent: number | null
  /** This row's card is the one being fetched — drives the label. */
  explaining: boolean
  /** ANY request is in flight — drives the disabled state, because the store drops seconds. */
  busy: boolean
}) {
  const { t } = useTranslation('learning')
  /**
   * The answer in progress, held on the ROW.
   *
   * Local because it is not shared state and not worth a store round trip — and because the row
   * unmounts when the plan is re-read after the attempt is recorded, which clears it for free.
   */
  const [answer, setAnswer] = useState('')
  // Generated, not derived from `position`: two rows must never share an id, and `position` is
  // reused across plans.
  const answerFieldId = useId()
  return (
    <li className="p-3 bg-card rounded-lg border border-border">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0 flex items-center gap-3">
          <span className="text-xs text-content-tertiary w-5 shrink-0">{position + 1}</span>
          <div className="min-w-0">
            <p className={`text-sm truncate ${done ? 'text-content-tertiary line-through' : 'text-foreground'}`}>
              {cardText || t('today.item.untitled')}
            </p>
            <div className="flex items-center gap-2 mt-0.5">
              <span className="text-xs text-content-tertiary">{reasonLabel}</span>
              {/* The number the reason is derived from. Shown so "at risk of forgetting" is a
                  measurement the learner can judge rather than an assertion they must trust. */}
              {recallPercent !== null && (
                <span className="text-xs text-content-tertiary">
                  {t('today.recallChance', { percent: recallPercent })}
                </span>
              )}
              {minutes !== null && (
                <span className="text-xs text-content-tertiary">
                  {t('today.item.minutes', { count: minutes })}
                </span>
              )}
            </div>
          </div>
        </div>
        <span className="flex items-center gap-3 shrink-0">
          {onExplain && (
            /* Paid: the server reserves against the wallet before the model call and charges
               the real token cost after, so the label has to say it costs credits BEFORE the
               click — not in an error afterwards. */
            <button
              type="button"
              disabled={busy}
              onClick={onExplain}
              title={t('enrichment.costHint')}
              className="text-xs text-primary hover:underline cursor-pointer disabled:opacity-50"
            >
              {explaining ? t('enrichment.requesting') : t('enrichment.explainCta')}
            </button>
          )}
          {deckId && (
            <Link
              to={`/decks/${deckId}/study/setup`}
              className="text-xs text-primary hover:underline"
            >
              {t('today.item.study')}
            </Link>
          )}
        </span>
      </div>

      {/* Self-rating records the attempt. It does NOT reschedule the card: SRS scheduling
          stays with the study screen's rating (apply_study_rating), and mixing the two would
          mean one action quietly moving two different things. */}
      {done ? (
        <p className="mt-2 text-xs text-success">{t('today.item.recorded')}</p>
      ) : (
        <>
          {/* Typed recall — production instead of recognition. Deliberately paired with the
              SAME three rating buttons rather than replacing them: nothing grades the text, so
              the learner is still the evaluator, and the buttons are what submits. */}
          {typed && (
            <div className="mt-2">
              <label htmlFor={answerFieldId} className="block text-xs text-content-tertiary">
                {t('today.answer.label')}
              </label>
              <textarea
                id={answerFieldId}
                value={answer}
                onChange={(e) => setAnswer(e.target.value)}
                disabled={recording}
                rows={2}
                // Enforced HERE, where the learner can see the input stop, rather than as the
                // server's 64 KiB rejection — which shares its error code with the plan-save
                // cap and would surface as a message about rebuilding plans.
                maxLength={TYPED_ANSWER_MAX_CHARS}
                placeholder={t('today.answer.placeholder')}
                className="mt-1 w-full px-2 py-1.5 text-sm bg-muted border border-border rounded-md text-foreground disabled:opacity-50"
              />
              {/* Says what the text is and is not: stored with the attempt, never graded. A
                  learner who believes it is being marked would read their own self-rating as a
                  second opinion on it. */}
              <p className="mt-0.5 text-[11px] text-content-tertiary">{t('today.answer.note')}</p>
            </div>
          )}
          <div className="mt-2 flex items-center gap-2">
            {SELF_RATINGS.map((rating) => (
              <button
                key={rating.key}
                type="button"
                disabled={recording}
                onClick={() => onRate(rating.score, answer)}
                className="px-2 py-1 text-xs border border-border rounded-md cursor-pointer disabled:opacity-50"
              >
                {t(rating.key)}
              </button>
            ))}
            <span className="text-[11px] text-content-tertiary">{t('today.rate.hint')}</span>
          </div>
        </>
      )}
    </li>
  )
}

/** Recent attempts for the selected goal — the review surface for Phase 2. */
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
  // The store loads 50; the list shows 10. Everything below counts the VISIBLE rows, so the
  // heading, the price line and the wallet read all describe what is actually on screen.
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

  // Read the wallet only once a row that can be acted on exists — a learner who is never
  // offered remediation should never trigger a wallet call — and RE-read it when a request
  // finishes, because that request just debited the balance this line is quoting. Keyed on
  // `enrichmentPendingCardId` returning to null, which is exactly "a request just settled".
  useEffect(() => {
    if (!offersRemediation || enrichmentPendingCardId !== null) return
    void loadEnrichmentQuote()
  }, [offersRemediation, enrichmentPendingCardId, loadEnrichmentQuote])

  // The store's in-flight guard is GLOBAL (`if (get().enrichmentPendingCardId) return false`),
  // so a second click anywhere is silently dropped. Disable every button while one request is
  // running rather than let a row look clickable and do nothing.
  const requestBusy = enrichmentPendingCardId !== null

  // Which ROW is waiting, not which card. The store only tracks the pending CARD, and the
  // learner this feature is for — someone who missed the same card twice — has two rows
  // sharing one card_id. Keying the indicator on the card would make both of them claim to
  // be the request in flight.
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
    <div className="pt-2">
      <h2 className="text-sm font-medium text-foreground">
        {t('history.title', { count: visibleAttempts.length })}
      </h2>
      {/* What the charge buys, as VISIBLE text rather than a `title` tooltip — a tooltip never
          reaches a keyboard or touch user, and it is the sentence that tells the learner the
          answer is about one attempt rather than the card in general. */}
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
      <ul className="mt-2 space-y-1">
        {visibleAttempts.map((attempt) => {
          const card = attempt.card_id ? planCards[attempt.card_id] : undefined
          const label = cardPromptLabel(card?.field_values, card?.template_id, planTemplateFields)
          const remediable = canRemediate(attempt)
          const pending = requestingAttemptId === attempt.id
          const rowName = label || t('history.itemFallback', { type: attempt.activity_type })
          // What the learner actually wrote, when they wrote anything. Shown because it is the
          // honesty check on the whole feature: a later paid `compare` is grounded in exactly
          // this string, so the learner has to be able to see it before paying for an answer
          // about it.
          const typedAnswer = attemptTypedAnswer(attempt)
          return (
            <li key={attempt.id} className="flex items-center justify-between gap-3 px-3 py-2 bg-card rounded-lg border border-border">
              <span className="min-w-0">
                <span className="block text-xs text-foreground truncate">{rowName}</span>
                {typedAnswer && (
                  <span className="block text-[11px] text-content-tertiary truncate">
                    {t('history.youWrote', { text: typedAnswer })}
                  </span>
                )}
              </span>
              <span className="flex items-center gap-2 shrink-0">
                <span className="text-xs text-content-tertiary">{t(scoreKey(attempt.normalized_score))}</span>
                <span className="text-[11px] text-content-tertiary">
                  {new Date(attempt.created_at).toLocaleString()}
                </span>
                {/* The progress note sits on the row rather than on a button: the store knows
                    only that A request is running, not which of the two actions it was. */}
                {pending && (
                  <span className="text-xs text-content-tertiary">{t('enrichment.requesting')}</span>
                )}
                {remediable && REMEDIATION_ACTIONS.map(({ action, labelKey }) => (
                  <button
                    key={action}
                    type="button"
                    disabled={requestBusy}
                    onClick={() => {
                      setRequestingAttemptId(attempt.id)
                      void requestEnrichment({
                        action,
                        goalId,
                        // Non-null by `canRemediate`; the id is what makes the answer about
                        // THIS failure instead of the card in general.
                        cardId: attempt.card_id as string,
                        attemptId: attempt.id,
                        uiLang: i18n.language,
                      }).finally(() => setRequestingAttemptId(null))
                    }}
                    // Every row offers the same two labels, so the text alone would give up to
                    // 20 buttons two accessible names between them. The name has to say which
                    // item is being paid for.
                    aria-label={`${t(labelKey)} — ${rowName}`}
                    className="text-xs text-primary hover:underline cursor-pointer disabled:opacity-50"
                  >
                    {t(labelKey)}
                  </button>
                ))}
              </span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

export function LearningTodayPage() {
  const { t } = useTranslation('learning')
  const {
    goals, goalsLoading, fetchGoals,
    plan, planItems, planCards, planTemplateFields, planLoading, planGenerating, planError,
    planBlockedReason,
    recordingItemId, fetchPlan, generatePlan, recordAttempt,
    attempts, fetchAttempts,
    enrichment, enrichmentPendingCardId, enrichmentError, requestEnrichment,
  } = useLearningStore()
  const { i18n } = useTranslation('learning')

  // The chosen goal is an OVERRIDE, not mirrored state: deriving the default from the
  // loaded goals avoids a set-state-in-effect (the repo forbids driving state from
  // effects, and it would also render once with no goal before correcting itself).
  const [goalOverrideId, setGoalOverrideId] = useState<string | null>(null)
  // One context per mount: the plan date must not drift mid-session, and the planner's
  // `now` is part of its input fingerprint.
  const ctx = useMemo(() => currentPlanContext(), [])

  useEffect(() => { void fetchGoals() }, [fetchGoals])

  const plannableGoals = useMemo(
    () => goals.filter((goal) => goal.status === 'active'),
    [goals],
  )

  const selectedGoalId = plannableGoals.some((goal) => goal.id === goalOverrideId)
    ? goalOverrideId
    : plannableGoals[0]?.id ?? null

  useEffect(() => {
    if (selectedGoalId) void fetchPlan(selectedGoalId, ctx.planDate)
  }, [selectedGoalId, ctx.planDate, fetchPlan])

  const goal: LearningGoalWithDecks | undefined =
    plannableGoals.find((candidate) => candidate.id === selectedGoalId)

  /**
   * The same goal filter `AttemptHistory` applies, for the same reason — and it has to be
   * here too, not only there. `fetchAttempts` never clears `attempts`, so after a goal switch
   * the previous goal's rows survive one round trip. A card that belongs to both goals' decks
   * would then let the plan row ground a paid request in the OTHER goal's attempt, and the
   * server cannot catch it: `persist_ai_remediation`'s pair check only asks that the attempt
   * and the enrichment name the same CARD (mig 178), which that attempt does. The result is a
   * stored `attempt_id` that misdescribes the answer — worse than none, because provenance
   * reads as verified.
   */
  const goalAttempts = useMemo(
    () => attempts.filter((attempt) => attempt.goal_id === selectedGoalId),
    [attempts, selectedGoalId],
  )

  if (goalsLoading && goals.length === 0) return <ListSkeleton />

  if (plannableGoals.length === 0) {
    return (
      <div className="max-w-2xl mx-auto p-4">
        <h1 className="text-lg font-medium text-foreground">{t('today.title')}</h1>
        <div className="mt-4 p-6 bg-card rounded-xl border border-border text-center">
          <p className="text-sm text-muted-foreground">{t('today.empty.noGoal')}</p>
          <Link
            to="/learning/goals"
            className="inline-block mt-3 px-3 py-1.5 text-sm bg-primary text-primary-foreground rounded-lg"
          >
            {t('today.empty.createGoal')}
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
    <div className="max-w-2xl mx-auto p-4 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-lg font-medium text-foreground">{t('today.title')}</h1>
        <span className="flex items-center gap-3">
          <Link to="/learning/insights" className="text-xs text-primary hover:underline">
            {t('today.insightsLink')}
          </Link>
          <Link to="/learning/goals" className="text-xs text-primary hover:underline">
            {t('today.manageGoals')}
          </Link>
        </span>
      </div>

      {plannableGoals.length > 1 && (
        <select
          value={selectedGoalId ?? ''}
          onChange={(e) => setGoalOverrideId(e.target.value)}
          className="w-full px-3 py-2 text-sm bg-muted border border-border rounded-lg cursor-pointer"
          aria-label={t('today.selectGoal')}
        >
          {plannableGoals.map((option) => (
            <option key={option.id} value={option.id}>{option.title}</option>
          ))}
        </select>
      )}

      {goal && (
        <div className="p-4 bg-card rounded-xl border border-border">
          <p className="text-sm font-medium text-foreground">{goal.title}</p>
          <p className="text-xs text-content-tertiary mt-1">
            {t('today.budget', { count: goal.daily_minutes })}
            {plan && ` · ${t('today.progress', { done: plan.completed_items, total: plan.total_items })}`}
          </p>
        </div>
      )}

      {planError && (
        <div role="alert" className="p-3 bg-destructive/10 border border-destructive/30 rounded-lg text-sm text-destructive">
          {t(errorMessageKey(planError.code))}
        </div>
      )}

      {planBlockedReason === 'no_decks' && goal && (
        <div className="p-4 bg-card rounded-xl border border-border text-center">
          <p className="text-sm text-muted-foreground">{t('today.empty.noDecks')}</p>
          <Link to="/learning/goals" className="inline-block mt-3 text-sm text-primary hover:underline">
            {t('today.empty.attachDecks')}
          </Link>
        </div>
      )}

      {planBlockedReason === 'no_candidates' && (
        <div className="p-4 bg-card rounded-xl border border-border text-center">
          <p className="text-sm text-muted-foreground">{t('today.empty.nothingDue')}</p>
        </div>
      )}

      {enrichmentError && (
        <div role="alert" className="p-3 bg-destructive/10 border border-destructive/30 rounded-lg text-sm text-destructive">
          {t(`enrichment.error.${enrichmentError}`)}
        </div>
      )}

      {enrichment && <EnrichmentModal preview={enrichment} />}

      {selectedGoalId && <AttemptHistory goalId={selectedGoalId} />}

      {planLoading ? (
        <ListSkeleton />
      ) : plan ? (
        <>
          <ul className="space-y-2">
            {planItems.map((item) => {
              const card = item.card_id ? planCards[item.card_id] : undefined
              const firstField = cardPromptLabel(card?.field_values, card?.template_id, planTemplateFields)
              return (
                <PlanItemRow
                  key={item.id}
                  position={item.position}
                  cardText={firstField}
                  deckId={card?.deck_id ?? null}
                  reasonLabel={t(REASON_KEY[item.reason_code] ?? 'today.reason.balanced')}
                  // Strictly what the planner recorded when it chose this row. Deliberately NOT
                  // recomputed from the card here: on a subscribed deck `cards.interval_days`
                  // is the PUBLISHER's, which is the defect #389 fixed — a fallback would walk
                  // straight back into it. A plan saved before this feature shows no number,
                  // which is the honest answer.
                  recallPercent={recallPercent(item.payload?.recall_probability)}
                  minutes={item.estimated_minutes}
                  done={item.status === 'completed'}
                  // The plan row's own snapshot decides this — the same column
                  // `record_answer_attempt` compares against, so the input can never appear on
                  // an item the RPC would then reject for sending text.
                  typed={item.response_type === 'text'}
                  recording={recordingItemId === item.id}
                  explaining={enrichmentPendingCardId === item.card_id}
                  // Disabled on the GLOBAL flag, not just this card: the store drops any second
                  // request while one is running, so a full-opacity button on another row would
                  // look clickable and silently do nothing.
                  busy={enrichmentPendingCardId !== null}
                  onExplain={item.card_id && selectedGoalId ? () => {
                    void requestEnrichment({
                      action: 'explain',
                      goalId: selectedGoalId,
                      cardId: item.card_id as string,
                      // Grounded once the item HAS an attempt (design §6) — same rule mobile
                      // uses, so the two platforms cannot buy different answers for the same
                      // card. Undefined when there is none, and the store omits the key.
                      attemptId: latestAttemptForCard(goalAttempts, item.card_id)?.id,
                      uiLang: i18n.language,
                    })
                  } : null}
                  onRate={(score, text) => {
                    if (!selectedGoalId) return
                    // One id per attempt, generated at click time — TOGETHER with the text.
                    // `p_response` is part of the RPC's idempotency comparison, so an id minted
                    // before the answer was final would make a retry with edited text a P0007.
                    // Refresh the attempt list too: `recordAttempt` re-reads only the plan, so
                    // without this the miss the learner JUST recorded — the one this whole
                    // feature exists to explain — never appears in the list below.
                    void recordAttempt({
                      planItem: item,
                      goalId: selectedGoalId,
                      score,
                      text,
                      clientAttemptId: crypto.randomUUID(),
                    }, ctx.planDate).then((ok) => {
                      if (ok && selectedGoalId) void fetchAttempts(selectedGoalId)
                    })
                  }}
                />
              )
            })}
          </ul>
          <button
            type="button"
            onClick={() => { if (goal) void generatePlan(goal, ctx) }}
            disabled={planGenerating || plan.status === 'completed'}
            className="w-full px-3 py-2 text-sm border border-border rounded-lg cursor-pointer disabled:opacity-50"
          >
            {planGenerating ? t('today.regenerating') : t('today.regenerate')}
          </button>
          {plan.status === 'completed' && (
            <p className="text-xs text-content-tertiary text-center">{t('today.completedNote')}</p>
          )}
        </>
      ) : (
        !planBlockedReason && (
          <button
            type="button"
            onClick={() => { if (goal) void generatePlan(goal, ctx) }}
            disabled={planGenerating || !goal}
            className="w-full px-3 py-2 text-sm bg-primary text-primary-foreground rounded-lg cursor-pointer disabled:opacity-50"
          >
            {planGenerating ? t('today.generating') : t('today.generate')}
          </button>
        )
      )}
    </div>
  )
}
