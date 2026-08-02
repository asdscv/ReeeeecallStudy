import { useEffect, useMemo, useState } from 'react'
import {
  availableDomainIds, projectWorkload, daysForDailyBudget,
} from '@reeeeecall/shared/learning'
import { useTranslation } from 'react-i18next'
import type { LearningGoalWithDecks, GoalDeckLink } from '../../stores/learning-store'
import { useDeckStore } from '../../stores/deck-store'
import { useAuthStore } from '../../stores/auth-store'

/**
 * Create/edit form for a learning goal.
 *
 * ASKS FOR THREE THINGS. It used to ask for six, and three of them were the app's job:
 *
 *   과목      removed — a provable no-op. The two shipped domain adapters are byte-identical
 *             apart from their id string, so the choice changed nothing, and the subject is
 *             already on the deck (learning_language / study_level).
 *   중요도    removed — 0.20 of the ranking, but a question the learner cannot answer better
 *             than the app can. Every deck now carries the neutral weight, which makes
 *             `goalRelevance` constant; `scoreCandidate` renormalises over the features it
 *             actually used, so the other five simply share the weight. No ordering changes.
 *   하루 몇 분  INVERTED. The learner cannot know this — it depends on unseen card count and how
 *             far away the date is, and the app knows both. It is now an OUTPUT.
 *
 * The preview is the point of the screen: decks and a date go in, and the daily cost comes back
 * before anything is saved. It reports the PEAK as well as the average because the average
 * alone is a comfortable lie — load piles up behind intake, and a learner who agreed to 34
 * minutes and met 43 was misled.
 */

export interface GoalFormValues {
  domainId: string
  title: string
  dailyMinutes: number
  targetDate: string | null
  decks: GoalDeckLink[]
}

/**
 * Every deck in a goal carries the same weight now that the learner is not asked to rank them.
 * Neutral rather than 1.0: `goalRelevance` is clamped to 0..1 and a constant anywhere in range
 * behaves identically, so the midpoint is the least surprising thing to store.
 */
const NEUTRAL_IMPORTANCE = 0.5

/** Days before the target date to stop introducing new cards, so the tail can consolidate. */
const CONSOLIDATION_DAYS = 14

/** Fallbacks for a learner with no measured history yet. Both refine from real data later. */
const ASSUMED_SECONDS_PER_CARD = 8
const ASSUMED_LAPSE_RATE = 0.10

const DAY_MS = 86_400_000

export function GoalFormModal({ goal, onCancel, onSubmit, submitting }: {
  goal: LearningGoalWithDecks | null
  onCancel: () => void
  onSubmit: (values: GoalFormValues) => void
  submitting: boolean
}) {
  const { t } = useTranslation('learning')
  const { decks, stats, fetchDecks, fetchStats } = useDeckStore()
  const { user } = useAuthStore()

  const [title, setTitle] = useState(goal?.title ?? '')
  const [targetDate, setTargetDate] = useState(goal?.target_date ?? '')
  const [deckIds, setDeckIds] = useState<Set<string>>(
    new Set((goal?.decks ?? []).map((link) => link.deck_id)),
  )
  // The learner may pin either side: a date, or a daily budget. Both are legitimate — "I have
  // until November" and "I have 30 minutes a day" are the same question from opposite ends.
  const [budgetMinutes, setBudgetMinutes] = useState<number | null>(null)
  const [localError, setLocalError] = useState<string | null>(null)

  useEffect(() => { void fetchDecks() }, [fetchDecks])
  useEffect(() => { if (user?.id) void fetchStats(user.id) }, [user?.id, fetchStats])

  const toggleDeck = (deckId: string) => {
    setDeckIds((current) => {
      const next = new Set(current)
      if (next.has(deckId)) next.delete(deckId)
      else next.add(deckId)
      return next
    })
  }

  // `get_deck_stats` already breaks cards down by SRS state and covers subscribed decks, so the
  // estimate uses real counts rather than treating a studied deck as untouched.
  const selection = useMemo(() => {
    let unseen = 0, seen = 0
    for (const row of stats) {
      if (!deckIds.has(row.deck_id)) continue
      unseen += row.new_cards
      seen += row.review_cards + row.learning_cards
    }
    return { unseen, seen, total: unseen + seen }
  }, [stats, deckIds])

  const daysAvailable = useMemo(() => {
    if (!targetDate) return null
    const days = Math.ceil((Date.parse(`${targetDate}T00:00:00Z`) - Date.now()) / DAY_MS)
    return Number.isFinite(days) && days > 0 ? days : null
  }, [targetDate])

  const workloadInput = {
    unseenCards: selection.unseen,
    seenCards: selection.seen,
    secondsPerCard: ASSUMED_SECONDS_PER_CARD,
    lapseRate: ASSUMED_LAPSE_RATE,
    consolidationDays: CONSOLIDATION_DAYS,
  }

  /** Date-driven: how much per day. Null until there is something to compute from. */
  const projection = useMemo(() => {
    if (selection.total === 0 || daysAvailable === null) return null
    return projectWorkload({ ...workloadInput, daysAvailable })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection.unseen, selection.seen, selection.total, daysAvailable])

  /** Budget-driven: when it finishes. Null when the budget cannot keep up at all. */
  const daysForBudget = useMemo(() => {
    if (selection.total === 0 || budgetMinutes === null || budgetMinutes <= 0) return null
    return daysForDailyBudget({ ...workloadInput, minutesPerDay: budgetMinutes })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection.unseen, selection.seen, selection.total, budgetMinutes])

  const budgetFinishDate = daysForBudget === null
    ? null
    : new Date(Date.now() + daysForBudget * DAY_MS).toISOString().slice(0, 10)

  const submit = () => {
    const trimmed = title.trim()
    if (trimmed.length < 1 || trimmed.length > 500) {
      setLocalError(t('form.error.title'))
      return
    }
    if (deckIds.size === 0) {
      setLocalError(t('form.error.decks'))
      return
    }
    setLocalError(null)
    onSubmit({
      // Still sent because `learning_goals.domain_id` is NOT NULL, but no longer asked for. An
      // existing goal keeps whatever it was created with rather than being silently rewritten.
      domainId: goal?.domain_id ?? availableDomainIds()[0],
      title: trimmed,
      // The planner's per-day budget. Derived, not typed: the projection when a date is set, the
      // learner's own figure when they pinned one, and the previous value when editing.
      dailyMinutes: Math.max(1, Math.min(1440, Math.round(
        budgetMinutes ?? projection?.averageMinutesPerDay ?? goal?.daily_minutes ?? 20,
      ))),
      targetDate: targetDate || null,
      decks: [...deckIds].map((deck_id) => ({ deck_id, importance: NEUTRAL_IMPORTANCE })),
    })
  }

  const minutes = (value: number) => t('form.plan.minutes', { count: Math.max(1, Math.round(value)) })

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div role="dialog" aria-modal="true" aria-label={t(goal ? 'form.editTitle' : 'form.createTitle')}
        className="w-full max-w-md bg-card rounded-xl border border-border p-4 space-y-3 max-h-[90vh] overflow-y-auto">
        <h2 className="text-base font-medium text-foreground">
          {t(goal ? 'form.editTitle' : 'form.createTitle')}
        </h2>

        <label className="block">
          <span className="text-xs text-muted-foreground">{t('form.goalTitle')}</span>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={500}
            className="mt-1 w-full px-3 py-2 text-sm bg-muted border border-border rounded-lg"
            placeholder={t('form.goalTitlePlaceholder')}
          />
        </label>

        <div className="block">
          <span className="text-xs text-muted-foreground">{t('form.decks')}</span>
          <p className="text-[11px] text-content-tertiary mt-0.5">{t('form.decksHint')}</p>
          <div className="mt-1 max-h-40 overflow-y-auto border border-border rounded-lg p-2 space-y-1">
            {decks.length === 0 && <p className="text-xs text-content-tertiary">{t('form.noDecks')}</p>}
            {decks.map((deck) => (
              <label key={deck.id} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={deckIds.has(deck.id)}
                  onChange={() => toggleDeck(deck.id)}
                />
                <span className="truncate">{deck.name}</span>
              </label>
            ))}
          </div>
        </div>

        <label className="block">
          <span className="text-xs text-muted-foreground">{t('form.targetDate')}</span>
          <input
            type="date"
            value={targetDate}
            onChange={(e) => { setTargetDate(e.target.value); setBudgetMinutes(null) }}
            className="mt-1 w-full px-3 py-2 text-sm bg-muted border border-border rounded-lg"
          />
        </label>

        {/* ── The plan this goal implies, before it is saved ────────────────── */}
        <section
          aria-label={t('form.plan.title')}
          className="rounded-lg border border-border bg-muted/40 p-3 space-y-1.5"
        >
          <h3 className="text-xs font-medium text-foreground">{t('form.plan.title')}</h3>

          {selection.total === 0 || (daysAvailable === null && budgetMinutes === null) ? (
            <p className="text-[11px] text-content-tertiary">{t('form.plan.needDecksAndDate')}</p>
          ) : (
            <>
              {projection && (
                <>
                  <p className="text-sm text-foreground">
                    {t('form.plan.newPerDay', { count: projection.newCardsPerDay })}
                    {' · '}
                    {minutes(projection.averageMinutesPerDay)}
                  </p>
                  {/* Stated separately and never averaged away: this is the day the learner has
                      to actually survive. */}
                  <p className="text-[11px] text-content-tertiary">
                    {t('form.plan.peak', {
                      minutes: Math.round(projection.peakMinutesPerDay),
                      day: projection.peakDay + 1,
                    })}
                  </p>
                </>
              )}

              {budgetMinutes !== null && (
                <p className="text-sm text-foreground">
                  {budgetFinishDate
                    ? t('form.plan.finishBy', { date: budgetFinishDate })
                    : t('form.plan.tooSlow')}
                </p>
              )}
            </>
          )}

          <div className="flex items-center gap-2 pt-1">
            <label className="text-[11px] text-content-tertiary flex items-center gap-1">
              {t('form.plan.byMinutes')}
              <input
                type="number"
                min={1}
                max={1440}
                value={budgetMinutes ?? ''}
                onChange={(e) => setBudgetMinutes(e.target.value ? Number(e.target.value) : null)}
                className="w-16 px-1.5 py-1 text-xs bg-background border border-border rounded"
                aria-label={t('form.plan.byMinutes')}
              />
            </label>
          </div>

          {/* Only SRS-mode study feeds the plan — cramming and the sequential modes call
              apply_study_rating with no SRS payload, so they move nothing here. Said out loud
              rather than left for the learner to discover from a plan that never changes. */}
          <p className="text-[11px] text-content-tertiary">{t('form.plan.srsOnly')}</p>
          <p className="text-[11px] text-content-tertiary">{t('form.plan.estimate')}</p>
        </section>

        {localError && <p className="text-xs text-danger">{localError}</p>}

        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onCancel} className="px-3 py-1.5 text-sm text-muted-foreground">
            {t('form.cancel')}
          </button>
          <button
            onClick={submit}
            disabled={submitting}
            className="px-3 py-1.5 text-sm bg-primary text-primary-foreground rounded-lg disabled:opacity-60"
          >
            {submitting ? t('form.saving') : t('form.save')}
          </button>
        </div>
      </div>
    </div>
  )
}
