import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { useLearningStore, type LearningGoalWithDecks } from '../../stores/learning-store'
import { currentPlanContext } from '../../lib/learning-plan-date'
import { ListSkeleton } from '../../components/common/Skeleton'

/**
 * Today's plan for one goal.
 *
 * Plan generation is EXPLICIT — a button, never an effect. `save_daily_plan` is capped
 * at 50 writes per user per day, so a generate-on-render path would spend a real quota
 * and then start failing for the rest of the day. Reading is automatic; writing is not.
 */

/** Planner reason codes (daily-plan-v1) → the phrase shown on the row. */
const REASON_KEY: Record<string, string> = {
  due: 'today.reason.due',
  recent_failure: 'today.reason.recentFailure',
  slow_response: 'today.reason.slowResponse',
  goal_relevance: 'today.reason.goalRelevance',
  importance: 'today.reason.importance',
  balanced: 'today.reason.balanced',
}

function PlanItemRow({ position, cardText, deckId, reasonLabel, minutes, done }: {
  position: number
  cardText: string
  deckId: string | null
  reasonLabel: string
  minutes: number | null
  done: boolean
}) {
  const { t } = useTranslation('learning')
  return (
    <li className="flex items-center justify-between gap-3 p-3 bg-card rounded-lg border border-border">
      <div className="min-w-0 flex items-center gap-3">
        <span className="text-xs text-content-tertiary w-5 shrink-0">{position + 1}</span>
        <div className="min-w-0">
          <p className={`text-sm truncate ${done ? 'text-content-tertiary line-through' : 'text-foreground'}`}>
            {cardText || t('today.item.untitled')}
          </p>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="text-xs text-content-tertiary">{reasonLabel}</span>
            {minutes !== null && (
              <span className="text-xs text-content-tertiary">
                {t('today.item.minutes', { count: minutes })}
              </span>
            )}
          </div>
        </div>
      </div>
      {deckId && (
        <Link
          to={`/decks/${deckId}/study/setup`}
          className="text-xs text-primary hover:underline shrink-0"
        >
          {t('today.item.study')}
        </Link>
      )}
    </li>
  )
}

export function LearningTodayPage() {
  const { t } = useTranslation('learning')
  const {
    goals, goalsLoading, fetchGoals,
    plan, planItems, planCards, planLoading, planGenerating, planError, planBlockedReason,
    fetchPlan, generatePlan,
  } = useLearningStore()

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
        <Link to="/learning/goals" className="text-xs text-primary hover:underline">
          {t('today.manageGoals')}
        </Link>
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

      {planLoading ? (
        <ListSkeleton />
      ) : plan ? (
        <>
          <ul className="space-y-2">
            {planItems.map((item) => {
              const card = item.card_id ? planCards[item.card_id] : undefined
              const firstField = card ? Object.values(card.field_values)[0] ?? '' : ''
              return (
                <PlanItemRow
                  key={item.id}
                  position={item.position}
                  cardText={firstField}
                  deckId={card?.deck_id ?? null}
                  reasonLabel={t(REASON_KEY[item.reason_code] ?? 'today.reason.balanced')}
                  minutes={item.estimated_minutes}
                  done={item.status === 'done'}
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
