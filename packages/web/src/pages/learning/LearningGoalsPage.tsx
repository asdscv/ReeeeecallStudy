import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate } from 'react-router-dom'
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
  const {
    goals, goalsLoading, goalsError, fetchGoals, createGoal, updateGoal, archiveGoal, deleteGoal,
  } = useLearningStore()
  const confirm = useConfirmStore((state) => state.confirm)
  const navigate = useNavigate()

  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<LearningGoalWithDecks | null>(null)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => { void fetchGoals() }, [fetchGoals])

  const openCreate = () => { setEditing(null); setFormOpen(true) }
  const openEdit = (goal: LearningGoalWithDecks) => { setEditing(goal); setFormOpen(true) }

  const handleSubmit = async (values: GoalFormValues) => {
    setSubmitting(true)
    // `settings` carries the two pacing answers ({ cadence, newCardsPerDay }). It was collected
    // by the form and then dropped HERE, so every goal in production stored `settings = {}` —
    // which `parseNewCardsPerDay` reads as "uncapped" and `parseCadence` as "every day". The
    // intake limit had therefore never throttled anything, and the study-days select silently
    // reopened at 7 after every save.
    const ok = editing
      ? await updateGoal({
        goalId: editing.id,
        title: values.title,
        dailyMinutes: values.dailyMinutes,
        targetDate: values.targetDate,
        decks: values.decks,
        settings: values.settings,
      })
      : await createGoal({
        domainId: values.domainId,
        title: values.title,
        dailyMinutes: values.dailyMinutes,
        targetDate: values.targetDate,
        decks: values.decks,
        settings: values.settings,
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

  /**
   * Delete, not archive.
   *
   * The confirmation names what actually goes — the plans, not the study record — because the
   * two are different fates and the learner cannot see the difference from the button. Archiving
   * keeps everything and only hides it; deleting cascades every daily plan this goal produced,
   * while the answer attempts survive detached, since the cards really were reviewed.
   */
  const handleDelete = async (goal: LearningGoalWithDecks) => {
    const ok = await confirm({
      title: t('goals.deleteConfirmTitle'),
      message: t('goals.deleteConfirmMessage', { title: goal.title }),
      confirmLabel: t('goals.delete'),
      danger: true,
    })
    if (ok) await deleteGoal(goal.id)
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
            className="px-3 py-1.5 text-sm font-medium bg-brand text-white rounded-lg cursor-pointer transition-colors hover:bg-brand-hover"
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
            <li
              key={goal.id}
              // The whole card opens the plan, not the 14px of title text. The `<Link>` below
              // stays: it is what gives the row a tab stop, a link role, and ctrl/middle-click
              // "open in new tab" — this handler only widens the MOUSE target, which is the
              // pattern DeckCard.tsx already uses for a card that also carries buttons.
              onClick={() => navigate(`/learning/${goal.id}`)}
              className="p-3 bg-card rounded-lg border border-border cursor-pointer transition-colors hover:border-brand/40 hover:bg-accent/40"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  {/* The card IS the way in. Plans used to be switched with a dropdown repeated
                      on three sibling screens; now the list opens one. */}
                  <Link
                    to={`/learning/${goal.id}`}
                    onClick={(e) => e.stopPropagation()}
                    className="text-sm font-medium text-foreground truncate hover:underline block"
                  >
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
                {/* The same guard DeckCard.tsx:110 uses: without it 수정 / 보관 would open the
                    plan on their way to their own handler. */}
                <div className="flex items-center gap-2 shrink-0" onClick={(e) => e.stopPropagation()}>
                  <button type="button" onClick={() => openEdit(goal)} className="text-xs text-brand hover:underline cursor-pointer">
                    {t('goals.edit')}
                  </button>
                  <button type="button" onClick={() => void handleArchive(goal)} className="text-xs text-muted-foreground hover:underline cursor-pointer">
                    {t('goals.archive')}
                  </button>
                  {/* Destructive, and the only one of the three that cannot be undone — so it
                      is the only one in the destructive colour. */}
                  <button type="button" onClick={() => void handleDelete(goal)} className="text-xs text-destructive hover:underline cursor-pointer">
                    {t('goals.delete')}
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
