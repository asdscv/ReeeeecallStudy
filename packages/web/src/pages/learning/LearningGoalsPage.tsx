import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { useLearningStore, type LearningGoalWithDecks } from '../../stores/learning-store'
import { useConfirmStore } from '../../stores/confirm-store'
import { ListSkeleton } from '../../components/common/Skeleton'
import { GoalFormModal, type GoalFormValues } from './GoalFormModal'

/**
 * Goal list + create/edit/archive.
 *
 * Archived goals are not listed: `update_learning_goal`, `set_learning_goal_decks` and
 * `save_daily_plan` all reject them, so showing one would only offer dead actions. The
 * archive confirmation says so rather than implying it is a soft hide.
 */
export function LearningGoalsPage() {
  const { t } = useTranslation('learning')
  const { goals, goalsLoading, goalsError, fetchGoals, createGoal, updateGoal, archiveGoal } = useLearningStore()
  const confirm = useConfirmStore((state) => state.confirm)

  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<LearningGoalWithDecks | null>(null)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => { void fetchGoals() }, [fetchGoals])

  const openCreate = () => { setEditing(null); setFormOpen(true) }
  const openEdit = (goal: LearningGoalWithDecks) => { setEditing(goal); setFormOpen(true) }

  const handleSubmit = async (values: GoalFormValues) => {
    setSubmitting(true)
    const ok = editing
      ? await updateGoal({
        goalId: editing.id,
        title: values.title,
        dailyMinutes: values.dailyMinutes,
        targetDate: values.targetDate,
        decks: values.decks,
      })
      : await createGoal({
        domainId: values.domainId,
        title: values.title,
        dailyMinutes: values.dailyMinutes,
        targetDate: values.targetDate,
        decks: values.decks,
      })
    setSubmitting(false)
    if (ok) { setFormOpen(false); setEditing(null) }
  }

  const handleArchive = async (goal: LearningGoalWithDecks) => {
    const ok = await confirm({
      title: t('goals.archiveConfirmTitle'),
      message: t('goals.archiveConfirmMessage', { title: goal.title }),
      danger: true,
    })
    if (ok) await archiveGoal(goal.id)
  }

  const errorKey = (code: string): string => {
    switch (code) {
      case 'LIMIT_EXCEEDED': return 'goals.error.limitExceeded'
      case 'NOT_FOUND': return 'goals.error.notFound'
      case 'INVALID_INPUT': return 'goals.error.invalidInput'
      case 'CONFLICT': return 'goals.error.conflict'
      case 'AUTH_REQUIRED': return 'goals.error.authRequired'
      case 'FORBIDDEN': return 'goals.error.forbidden'
      default: return 'goals.error.unknown'
    }
  }

  return (
    <div className="max-w-2xl mx-auto p-4 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-medium text-foreground">{t('goals.title')}</h1>
          <p className="text-xs text-content-tertiary mt-0.5">{t('goals.subtitle')}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">

          <button
            type="button"
            onClick={openCreate}
            className="px-3 py-1.5 text-sm bg-primary text-primary-foreground rounded-lg cursor-pointer"
          >
            {t('goals.create')}
          </button>
        </div>
      </div>

      {goalsError && (
        <div role="alert" className="p-3 bg-destructive/10 border border-destructive/30 rounded-lg text-sm text-destructive">
          {t(errorKey(goalsError.code))}
        </div>
      )}

      {goalsLoading && goals.length === 0 ? (
        <ListSkeleton />
      ) : goals.length === 0 ? (
        <div className="p-6 bg-card rounded-xl border border-border text-center">
          <p className="text-sm text-muted-foreground">{t('goals.empty.title')}</p>
          <p className="text-xs text-content-tertiary mt-1">{t('goals.empty.body')}</p>
        </div>
      ) : (
        <ul className="space-y-2">
          {goals.map((goal) => (
            <li key={goal.id} className="p-3 bg-card rounded-lg border border-border">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  {/* The card IS the way in. Plans used to be switched with a dropdown repeated
                      on three sibling screens; now the list opens one. */}
                  <Link to={`/learning/${goal.id}`} className="text-sm text-foreground truncate hover:underline block">
                    {goal.title}
                  </Link>
                  <div className="flex flex-wrap items-center gap-2 mt-1">
                    <span className="text-xs text-content-tertiary">
                      {t('goals.dailyMinutes', { count: goal.daily_minutes })}
                    </span>
                    <span className="text-xs text-content-tertiary">
                      {t('goals.deckCount', { count: goal.decks.length })}
                    </span>
                    {goal.target_date && (
                      <span className="text-xs text-content-tertiary">
                        {t('goals.targetDate', { date: goal.target_date })}
                      </span>
                    )}
                    {goal.status !== 'active' && (
                      <span className="text-xs text-warning">{t(`goals.status.${goal.status}`)}</span>
                    )}
                  </div>
                  {goal.decks.length === 0 && (
                    <p className="text-xs text-warning mt-1">{t('goals.noDecksWarning')}</p>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button type="button" onClick={() => openEdit(goal)} className="text-xs text-primary hover:underline cursor-pointer">
                    {t('goals.edit')}
                  </button>
                  <button type="button" onClick={() => void handleArchive(goal)} className="text-xs text-destructive hover:underline cursor-pointer">
                    {t('goals.archive')}
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {formOpen && (
        <GoalFormModal
          goal={editing}
          submitting={submitting}
          onCancel={() => { setFormOpen(false); setEditing(null) }}
          onSubmit={(values) => void handleSubmit(values)}
        />
      )}
    </div>
  )
}
