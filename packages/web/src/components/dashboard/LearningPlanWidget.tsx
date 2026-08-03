import { useEffect, useMemo, useState } from 'react'
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

  /** The clock, sampled once. See `daysLeft` below for why it is not read during render. */
  const [mountedAt] = useState(() => Date.now())

  /**
   * The goal with the nearest deadline STILL AHEAD, then the oldest undated one.
   *
   * One goal, not all of them: a learner with four plans needs the one running out of time, and
   * the rest are one tap away. Sorting plain ascending picked the most OVERDUE goal instead — a
   * deadline from last year sorts first — so the widget showed the wrong plan and asked the
   * server what the learner would know on a date long past.
   */
  const focus = useMemo(() => {
    const today = new Date(mountedAt).toISOString().slice(0, 10)
    const active = goals.filter((goal) => goal.status === 'active')
    const upcoming = active.filter((goal) => goal.target_date && goal.target_date >= today)
    const pool = upcoming.length > 0 ? upcoming : active.filter((goal) => !goal.target_date)
    // Everything lapsed and nothing undated: fall back to the least stale rather than nothing.
    const fallback = [...active].sort((a, b) => (b.target_date ?? '').localeCompare(a.target_date ?? ''))
    return [...pool].sort((a, b) => {
      if (a.target_date && b.target_date) return a.target_date.localeCompare(b.target_date)
      return a.created_at.localeCompare(b.created_at)
    })[0] ?? fallback[0] ?? null
  }, [goals, mountedAt])

  // Judged at the target date when there is one, so the number answers "what will I know on the
  // day". Built from `mountedAt` rather than a bare `new Date()`: that would be a new value on
  // every render and the effect below would loop the RPC — the exact defect this work shipped
  // and then caught on mobile. Depending on `focus` (not `focus?.target_date`) is what the React
  // Compiler infers; a narrower dep list makes it refuse to optimise the whole component.
  const judgedAt = useMemo(
    () => (focus?.target_date
      ? `${focus.target_date}T00:00:00.000Z`
      : new Date(mountedAt).toISOString()),
    [focus, mountedAt],
  )

  useEffect(() => {
    if (focus?.id) void fetchGoalKnowledge(focus.id, judgedAt)
  }, [focus?.id, judgedAt, fetchGoalKnowledge])

  if (!focus) return null

  const state = knowledge[focus.id]
  // Over the TOTAL, matching the sentence beside it. Dividing by attempted cards instead put a
  // 50% bar next to the words "5 of 100 cards known".
  const percent = state && state.total > 0 ? Math.round((state.known / state.total) * 100) : 0
  // `now` is read ONCE per mount, not per render. `Date.now()` inline is impure during render:
  // React may render twice for the same state and the two passes would disagree, and the repo's
  // lint rule rejects it for exactly that reason. A dashboard tile that freezes its clock at
  // mount is correct — the page is not open across a date boundary in any way that matters, and
  // the plan screen it links to recomputes from a fresh context on open.
  const daysLeft = focus.target_date
    ? Math.ceil((Date.parse(`${focus.target_date}T00:00:00Z`) - mountedAt) / 86_400_000)
    : null

  return (
    <Link
      to={`/learning/${focus.id}`}
      className="block p-3 sm:p-4 bg-card rounded-xl border border-border hover:border-primary/50 transition-colors"
    >
      {/* No `aria-label` here on purpose: it wins over contents in accessible-name computation,
          so the whole tile announced as "Progress, link" and the title, days left and numbers
          were all removed from the accessibility tree. Letting the contents name the link is
          what a screen reader needs. */}
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-medium text-foreground truncate">
          <span aria-hidden="true">🎯 </span>{focus.title}
        </span>
        {daysLeft !== null && daysLeft > 0 && (
          <span className="text-xs text-content-tertiary shrink-0">
            {t('progress.daysLeft', { count: daysLeft })}
          </span>
        )}
      </div>

      {state && state.total > 0 ? (
        <>
          <p className="mt-1 text-xs text-muted-foreground">
            {t('progress.knownNow', { known: state.known, total: state.total })}
          </p>
          <div
            className="mt-2 h-1.5 w-full rounded-full bg-muted overflow-hidden"
            role="progressbar"
            aria-valuenow={percent}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={t('progress.title')}
          >
            <div className="h-full bg-primary" style={{ width: `${percent}%` }} />
          </div>
        </>
      ) : (
        // Progress has not arrived — still loading, or the RPC failed and the store swallowed it
        // into a null entry. Rendering the plan's own heading here (which this did) states
        // something untrue about a different section; a plain dash says "no number yet" without
        // pretending. A brand-new goal with cards renders the real 0% above, which is honest.
        <p className="mt-1 text-xs text-content-tertiary" aria-hidden="true">—</p>
      )}
    </Link>
  )
}
