import { useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { useLearningStore } from '../../stores/learning-store'

/**
 * The learning plan, in one line, on the dashboard.
 *
 * Deliberately small. The plan already has a screen and the plan's detail already has a screen;
 * a third full report here would be the fragmentation this work spent several PRs undoing —
 * before it, learning state was scattered across the dashboard, `/learning`, and a hidden
 * "진단" page that nobody could find. This is a pointer, not a dashboard within a dashboard.
 *
 * It renders NOTHING when there is no plannable goal. A dashboard tile that exists only to
 * advertise an unused feature is an ad, and the empty state for "you have no learning goal" is
 * already handled by the learning screen itself.
 */
export function LearningPlanWidget() {
  const { t } = useTranslation('learning')
  const { goals, fetchGoals, knowledge, fetchGoalKnowledge } = useLearningStore()

  useEffect(() => { void fetchGoals() }, [fetchGoals])

  /**
   * The goal with the nearest deadline, then the oldest.
   *
   * One goal, not all of them: a learner with four plans does not need four rows here, they need
   * the one that is running out of time. The rest are one tap away.
   */
  const focus = useMemo(() => {
    const active = goals.filter((goal) => goal.status === 'active')
    const dated = active.filter((goal) => goal.target_date)
    const pool = dated.length > 0 ? dated : active
    return [...pool].sort((a, b) => {
      if (a.target_date && b.target_date) return a.target_date.localeCompare(b.target_date)
      return a.created_at.localeCompare(b.created_at)
    })[0] ?? null
  }, [goals])

  // Judged at the target date when there is one, so the number answers "what will I know on the
  // day". Memoised: a bare `new Date()` here would be a new value every render, and the effect
  // below would loop the RPC — the exact defect this work shipped and then caught on mobile.
  const judgedAt = useMemo(
    () => (focus?.target_date ? `${focus.target_date}T00:00:00.000Z` : new Date().toISOString()),
    [focus?.target_date],
  )

  useEffect(() => {
    if (focus?.id) void fetchGoalKnowledge(focus.id, judgedAt)
  }, [focus?.id, judgedAt, fetchGoalKnowledge])

  if (!focus) return null

  const state = knowledge[focus.id]
  const attempted = state ? state.known + state.unknown : 0
  const percent = attempted > 0 ? Math.round((state!.known / attempted) * 100) : 0
  const daysLeft = focus.target_date
    ? Math.ceil((Date.parse(`${focus.target_date}T00:00:00Z`) - Date.now()) / 86_400_000)
    : null

  return (
    <Link
      to={`/learning/${focus.id}`}
      className="block p-3 sm:p-4 bg-card rounded-xl border border-border hover:border-primary/50 transition-colors"
      aria-label={t('progress.title')}
    >
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-medium text-foreground truncate">🎯 {focus.title}</span>
        {daysLeft !== null && daysLeft > 0 && (
          <span className="text-xs text-content-tertiary shrink-0">
            {t('progress.daysLeft', { count: daysLeft })}
          </span>
        )}
      </div>

      {state && state.total > 0 ? (
        <>
          <p className="mt-1 text-xs text-muted-foreground">
            {focus.target_date
              ? t('progress.knownAtTarget', { known: state.known, total: state.total, date: focus.target_date })
              : t('progress.knownNow', { known: state.known, total: state.total })}
          </p>
          <div className="mt-2 h-1.5 w-full rounded-full bg-muted overflow-hidden">
            <div className="h-full bg-primary" style={{ width: `${percent}%` }} role="presentation" />
          </div>
        </>
      ) : (
        // The goal exists but its progress has not loaded, or its decks hold no cards. Say
        // nothing rather than render a 0% bar, which would read as "you know none of it".
        <p className="mt-1 text-xs text-content-tertiary">{t('today.title')}</p>
      )}
    </Link>
  )
}
