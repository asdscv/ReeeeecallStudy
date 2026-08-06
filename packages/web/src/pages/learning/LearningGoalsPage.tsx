import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate } from 'react-router-dom'
import { useLearningStore, type LearningGoalWithDecks } from '../../stores/learning-store'
import { useConfirmStore } from '../../stores/confirm-store'
import { ListSkeleton } from '../../components/common/Skeleton'
import { GoalFormModal, type GoalFormValues } from './GoalFormModal'

/**
 * Goal list + create/edit/archive, with the archive itself behind a drawer.
 *
 * ## Why the archive is a separate list
 *
 * Archived goals cannot be planned or edited — `update_learning_goal`, `set_learning_goal_decks`
 * and `save_daily_plan` all reject them — so mixing them into the working list would offer three
 * buttons that answer P0007. They get their own list, where the only thing offered is the one
 * thing that works.
 *
 * ## Why the archive is visible at all
 *
 * It was not, and that made 보관 strictly worse than 삭제. The status flip was real, but
 * `fetchGoals` filtered the row out with `.neq('status','archived')` and no screen anywhere read
 * it back — so "보관" meant "hide forever", while the goal, its deck links and every daily plan it
 * ever produced sat in the database unreachable. The server had allowed `archived → active` since
 * mig 167 and nothing had ever called it. This is the missing half.
 */
export function LearningGoalsPage() {
  const { t } = useTranslation('learning')
  const {
    goals, goalsLoading, goalsError, fetchGoals, createGoal, updateGoal, archiveGoal, deleteGoal,
    archivedGoals, archivedGoalsLoading, fetchArchivedGoals, restoreGoal,
  } = useLearningStore()
  const confirm = useConfirmStore((state) => state.confirm)
  const navigate = useNavigate()

  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<LearningGoalWithDecks | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [archiveOpen, setArchiveOpen] = useState(false)

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
   * Open the drawer, and read the archive the first time it is opened.
   *
   * Not read on mount: almost nobody has an archived goal, and every session would pay for the
   * query. `archivedGoals === null` is "never asked", which is why the store starts it at null
   * rather than at `[]` — an empty array would let the drawer say the archive is empty before
   * anything had looked.
   */
  const toggleArchive = () => {
    const next = !archiveOpen
    setArchiveOpen(next)
    if (next && archivedGoals === null) void fetchArchivedGoals()
  }

  /**
   * Restore, with no confirmation.
   *
   * Nothing is destroyed and the button that undoes it is right there, so a modal would only be
   * ceremony. Archive and delete ask because both take something away.
   */
  const handleRestore = async (goal: LearningGoalWithDecks) => {
    await restoreGoal(goal.id)
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

      {/* ── The archive ────────────────────────────────────────────────────
          Collapsed by default and never louder than the working list: it is where finished
          goals go, not a second inbox. */}
      <div className="pt-2">
        <button
          type="button"
          onClick={toggleArchive}
          aria-expanded={archiveOpen}
          aria-controls="learning-archive"
          className="text-xs text-muted-foreground hover:text-foreground hover:underline cursor-pointer"
        >
          {archiveOpen ? t('goals.archived.hide') : t('goals.archived.show')}
        </button>

        {archiveOpen && (
          <div id="learning-archive" className="mt-2" data-testid="learning-archive">
            {archivedGoalsLoading && archivedGoals === null ? (
              <ListSkeleton />
            ) : (archivedGoals ?? []).length === 0 ? (
              <p className="px-3 py-4 text-center text-xs text-content-tertiary">
                {t('goals.archived.empty')}
              </p>
            ) : (
              <ul className="space-y-2">
                {(archivedGoals ?? []).map((goal) => (
                  // Deliberately NOT clickable, and no <Link>: the plan screen would call
                  // `save_daily_plan` for a goal the RPC refuses. Restore first, then open it.
                  <li key={goal.id} className="p-3 bg-muted/40 rounded-lg border border-border">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-muted-foreground truncate">
                          {goal.title}
                        </p>
                        <div className="flex flex-wrap items-center gap-2 mt-1">
                          <span className="text-xs text-content-tertiary">
                            {t('goals.deckCount', { count: goal.decks.length })}
                          </span>
                          {goal.target_date && (
                            <span className="text-xs text-content-tertiary">
                              {t('goals.targetDate', { date: goal.target_date })}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={() => void handleRestore(goal)}
                          className="text-xs text-brand hover:underline cursor-pointer"
                        >
                          {t('goals.archived.restore')}
                        </button>
                        {/* Delete stays reachable here. Otherwise the only way to be rid of an
                            archived goal for good would be to restore it first. */}
                        <button
                          type="button"
                          onClick={() => void handleDelete(goal)}
                          className="text-xs text-destructive hover:underline cursor-pointer"
                        >
                          {t('goals.delete')}
                        </button>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

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
