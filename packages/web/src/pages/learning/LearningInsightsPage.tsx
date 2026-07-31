import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { useLearningStore } from '../../stores/learning-store'
import { cardPromptLabel } from '@reeeeecall/shared/lib/card-prompt'
import { ListSkeleton } from '../../components/common/Skeleton'

/**
 * Learning diagnostics for one goal.
 *
 * Everything here is derived from the engine's own records (`answer_attempts`,
 * `daily_plans`). It deliberately does not restate the legacy SRS analytics that already
 * live on /history — two summaries of the same question with slightly different arithmetic
 * is worse than one.
 *
 * "No data" is rendered as no data, never as zero. 0% accuracy is a real, harsh statement;
 * a learner who has not answered anything yet must not be shown it.
 */
function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="p-3 bg-card rounded-xl border border-border">
      <p className="text-xs text-content-tertiary">{label}</p>
      <p className="mt-1 text-lg text-foreground">{value}</p>
      {hint && <p className="mt-0.5 text-[11px] text-content-tertiary">{hint}</p>}
    </div>
  )
}

/**
 * Diagnostics failures reuse the plan screen's strings: the code set is the same, and a
 * second copy of "you are not signed in" would only be a second thing to keep in sync.
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

export function LearningInsightsPage() {
  const { t } = useTranslation('learning')
  const { t: tCommon } = useTranslation('common')
  const {
    goals, goalsLoading, fetchGoals, insights, insightsGoalId, insightsError,
    fetchInsights, planCards, planTemplateFields,
    recommendations, recommendationBusyId, fetchRecommendations, regenerateRecommendations,
    resolveRecommendation,
  } = useLearningStore()
  // The store takes one recommendation write at a time, so a row-scoped disable left the
  // other rows looking clickable while they silently did nothing.
  const busy = recommendationBusyId !== null
  const [goalOverrideId, setGoalOverrideId] = useState<string | null>(null)

  useEffect(() => { void fetchGoals() }, [fetchGoals])

  const active = useMemo(() => goals.filter((g) => g.status === 'active'), [goals])
  const selectedGoalId = active.some((g) => g.id === goalOverrideId)
    ? goalOverrideId
    : active[0]?.id ?? null

  useEffect(() => {
    if (selectedGoalId) void fetchInsights(selectedGoalId)
  }, [selectedGoalId, fetchInsights])

  useEffect(() => {
    if (selectedGoalId) void fetchRecommendations(selectedGoalId)
  }, [selectedGoalId, fetchRecommendations])

  if (goalsLoading && goals.length === 0) return <ListSkeleton />

  if (active.length === 0) {
    return (
      <div className="max-w-2xl mx-auto p-4">
        <h1 className="text-lg font-medium text-foreground">{t('insights.title')}</h1>
        <div className="mt-4 p-6 bg-card rounded-xl border border-border text-center">
          <p className="text-sm text-muted-foreground">{t('today.empty.noGoal')}</p>
          <Link to="/learning/goals" className="inline-block mt-3 text-sm text-primary hover:underline">
            {t('today.empty.createGoal')}
          </Link>
        </div>
      </div>
    )
  }

  const pct = (value: number | null): string =>
    value === null ? t('insights.noData') : `${Math.round(value * 100)}%`
  const seconds = (ms: number | null): string =>
    ms === null ? t('insights.noData') : t('insights.seconds', { count: Math.round(ms / 100) / 10 })

  return (
    <div className="max-w-2xl mx-auto p-4 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-lg font-medium text-foreground">{t('insights.title')}</h1>
        <Link to="/learning" className="text-xs text-primary hover:underline">{t('goals.todayLink')}</Link>
      </div>

      {active.length > 1 && (
        <select
          value={selectedGoalId ?? ''}
          onChange={(e) => setGoalOverrideId(e.target.value)}
          className="w-full px-3 py-2 text-sm bg-muted border border-border rounded-lg cursor-pointer"
          aria-label={t('today.selectGoal')}
        >
          {active.map((goal) => <option key={goal.id} value={goal.id}>{goal.title}</option>)}
        </select>
      )}

      {/* A failed load used to render nothing at all — no message, no way to retry. */}
      {insightsError && (
        <div
          className="p-3 rounded-lg border border-danger/40 bg-card"
          role="alert"
          data-testid="learning-insights-error"
        >
          <p className="text-sm text-danger">{t(insightsErrorKey(insightsError.code))}</p>
          <button
            type="button"
            onClick={() => { if (selectedGoalId) { void fetchInsights(selectedGoalId) } }}
            className="mt-1 text-sm text-primary hover:underline cursor-pointer"
          >
            {tCommon('actions.retry')}
          </button>
        </div>
      )}

      {/* The numbers belong to `insightsGoalId`. Rendering them under another goal's label
          would be a worse lie than a skeleton — this screen's whole contract is that a
          number it shows is true of the goal it is shown under. */}
      {!insights || insightsGoalId !== selectedGoalId ? (
        insightsError ? null : <ListSkeleton />
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Stat label={t('insights.attempts')} value={String(insights.attemptCount)} />
            <Stat
              label={t('insights.accuracy')}
              value={pct(insights.accuracy)}
              hint={insights.scoredCount === 0 ? t('insights.notScoredYet') : undefined}
            />
            <Stat label={t('insights.typicalTime')} value={seconds(insights.medianDurationMs)} />
            <Stat label={t('insights.adherence')} value={pct(insights.overallAdherence)} />
          </div>

          <div>
            <h2 className="text-sm font-medium text-foreground">{t('insights.weakTitle')}</h2>
            <p className="text-[11px] text-content-tertiary mt-0.5">{t('insights.weakHint')}</p>
            {insights.weakCards.length === 0 ? (
              <p className="mt-2 text-sm text-muted-foreground">{t('insights.weakEmpty')}</p>
            ) : (
              <ul className="mt-2 space-y-1">
                {insights.weakCards.map((card) => {
                  const ref = planCards[card.cardId]
                  const label = cardPromptLabel(ref?.field_values, ref?.template_id, planTemplateFields)
                  return (
                    <li key={card.cardId} className="flex items-center justify-between gap-3 px-3 py-2 bg-card rounded-lg border border-border">
                      <span className="text-xs text-foreground truncate">
                        {label || t('insights.cardFallback')}
                      </span>
                      <span className="flex items-center gap-2 shrink-0">
                        <span className="text-xs text-content-tertiary">{pct(card.meanScore)}</span>
                        <span className="text-[11px] text-content-tertiary">
                          {t('insights.attemptCount', { count: card.attempts })}
                        </span>
                        {ref && (
                          <Link to={`/decks/${ref.deck_id}/study/setup`} className="text-xs text-primary hover:underline">
                            {t('today.item.study')}
                          </Link>
                        )}
                      </span>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>

          <div>
            <h2 className="text-sm font-medium text-foreground">{t('insights.adherenceTitle')}</h2>
            {insights.adherence.length === 0 ? (
              <p className="mt-2 text-sm text-muted-foreground">{t('insights.adherenceEmpty')}</p>
            ) : (
              <ul className="mt-2 space-y-1">
                {insights.adherence.map((day) => (
                  <li key={day.planDate} className="flex items-center justify-between gap-3 px-3 py-2 bg-card rounded-lg border border-border">
                    <span className="text-xs text-foreground">{day.planDate}</span>
                    <span className="text-xs text-content-tertiary">
                      {day.ratio === null
                        ? t('insights.noPlanItems')
                        : t('insights.dayRatio', {
                          done: day.completedItems, total: day.totalItems, pct: Math.round(day.ratio * 100),
                        })}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* ── Recommendations (mig 174) ──
              Producing is explicit: it replaces the PENDING set, so a background regenerate
              would silently churn what the learner is looking at. Accepting raises the
              card's contentImportance for the next plan — that is what makes the decision
              worth storing at all. */}
          <div>
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-sm font-medium text-foreground">{t('recommend.title')}</h2>
              <button
                type="button"
                onClick={() => { if (selectedGoalId) void regenerateRecommendations(selectedGoalId) }}
                disabled={!insights || insights.weakCards.length === 0}
                className="text-xs text-primary hover:underline cursor-pointer disabled:opacity-50 disabled:no-underline"
              >
                {t('recommend.regenerate')}
              </button>
            </div>
            <p className="text-[11px] text-content-tertiary mt-0.5">{t('recommend.hint')}</p>

            {recommendations.length === 0 ? (
              <p className="mt-2 text-sm text-muted-foreground">{t('recommend.empty')}</p>
            ) : (
              <ul className="mt-2 space-y-1">
                {recommendations.map((rec) => {
                  const ref = rec.card_id ? planCards[rec.card_id] : undefined
                  const label = cardPromptLabel(ref?.field_values, ref?.template_id, planTemplateFields)
                  return (
                    <li key={rec.id} className="px-3 py-2 bg-card rounded-lg border border-border">
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-xs text-foreground truncate">
                          {label || t('insights.cardFallback')}
                        </span>
                        {rec.status === 'pending' ? (
                          <span className="flex items-center gap-2 shrink-0">
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => void resolveRecommendation(rec.id, 'accepted')}
                              className="text-xs text-primary hover:underline cursor-pointer disabled:opacity-50"
                            >
                              {t('recommend.accept')}
                            </button>
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => void resolveRecommendation(rec.id, 'dismissed')}
                              className="text-xs text-content-tertiary hover:underline cursor-pointer disabled:opacity-50"
                            >
                              {t('recommend.dismiss')}
                            </button>
                          </span>
                        ) : (
                          <span className="text-xs text-content-tertiary shrink-0">
                            {t(`recommend.status.${rec.status}`)}
                          </span>
                        )}
                      </div>
                      {rec.reason && (
                        <p className="mt-0.5 text-[11px] text-content-tertiary">{rec.reason}</p>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
          </div>

          {/* Honest about what this page is NOT. `study_recommendations` has no producer
              anywhere in the repo, so a "recommended for you" feed would be permanently
              empty; saying nothing beats an empty promise. */}
          <p className="text-[11px] text-content-tertiary">{t('insights.scopeNote')}</p>
        </>
      )}
    </div>
  )
}
