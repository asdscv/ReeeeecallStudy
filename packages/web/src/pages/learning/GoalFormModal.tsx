import { useEffect, useState } from 'react'
import {
  DECK_PRIORITY_LEVELS, DEFAULT_DECK_PRIORITY, importanceForPriority, priorityForImportance,
  type DeckPriority,
} from '@reeeeecall/shared/lib/learning-deck-priority'
import { useTranslation } from 'react-i18next'
import type { LearningGoalWithDecks, GoalDeckLink } from '../../stores/learning-store'
import { useDeckStore } from '../../stores/deck-store'

/**
 * Create/edit form for a learning goal.
 *
 * Client-side validation mirrors the RPC's own bounds (title 1–500, daily minutes
 * 1–1440) so the common mistakes never become a round-trip; the server remains the
 * authority and its errors are still rendered by the caller.
 *
 * The domain is a fixed choice, not free text: `domain_id` selects a registered domain
 * adapter, and a typo would create a goal no adapter can plan for.
 */
const DOMAINS = ['language', 'labor-law'] as const

export interface GoalFormValues {
  domainId: string
  title: string
  dailyMinutes: number
  targetDate: string | null
  decks: GoalDeckLink[]
}

export function GoalFormModal({ goal, onCancel, onSubmit, submitting }: {
  goal: LearningGoalWithDecks | null
  onCancel: () => void
  onSubmit: (values: GoalFormValues) => void
  submitting: boolean
}) {
  const { t } = useTranslation('learning')
  const { decks, fetchDecks } = useDeckStore()

  const [domainId, setDomainId] = useState(goal?.domain_id ?? DOMAINS[0])
  const [title, setTitle] = useState(goal?.title ?? '')
  const [dailyMinutes, setDailyMinutes] = useState(goal?.daily_minutes ?? 20)
  const [targetDate, setTargetDate] = useState(goal?.target_date ?? '')
  const [deckIds, setDeckIds] = useState<Set<string>>(
    new Set((goal?.decks ?? []).map((link) => link.deck_id)),
  )
  // Kept separately from the selection so unchecking a deck and changing its mind does not
  // silently reset the level the learner had already chosen for it.
  const [deckPriority, setDeckPriority] = useState<Record<string, DeckPriority>>(
    Object.fromEntries((goal?.decks ?? []).map((link) => [
      link.deck_id, priorityForImportance(link.importance),
    ])),
  )
  const [localError, setLocalError] = useState<string | null>(null)

  useEffect(() => { void fetchDecks() }, [fetchDecks])

  const toggleDeck = (deckId: string) => {
    setDeckIds((current) => {
      const next = new Set(current)
      if (next.has(deckId)) next.delete(deckId)
      else next.add(deckId)
      return next
    })
  }

  const submit = () => {
    const trimmed = title.trim()
    if (trimmed.length < 1 || trimmed.length > 500) {
      setLocalError(t('form.error.title'))
      return
    }
    if (!Number.isInteger(dailyMinutes) || dailyMinutes < 1 || dailyMinutes > 1440) {
      setLocalError(t('form.error.dailyMinutes'))
      return
    }
    setLocalError(null)
    onSubmit({
      domainId,
      title: trimmed,
      dailyMinutes,
      targetDate: targetDate || null,
      decks: [...deckIds].map((deck_id) => ({
        deck_id,
        importance: importanceForPriority(deckPriority[deck_id] ?? DEFAULT_DECK_PRIORITY),
      })),
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div role="dialog" aria-modal="true" aria-label={t(goal ? 'form.editTitle' : 'form.createTitle')}
        className="w-full max-w-md bg-card rounded-xl border border-border p-4 space-y-3 max-h-[90vh] overflow-y-auto">
        <h2 className="text-base font-medium text-foreground">
          {t(goal ? 'form.editTitle' : 'form.createTitle')}
        </h2>

        <label className="block">
          <span className="text-xs text-muted-foreground">{t('form.domain')}</span>
          <select
            value={domainId}
            onChange={(e) => setDomainId(e.target.value)}
            disabled={!!goal}   // domain fixes which adapter plans the goal; changing it would invalidate its plans
            className="mt-1 w-full px-3 py-2 text-sm bg-muted border border-border rounded-lg cursor-pointer disabled:opacity-60"
          >
            {DOMAINS.map((domain) => (
              <option key={domain} value={domain}>{t(`form.domainName.${domain}`)}</option>
            ))}
          </select>
        </label>

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

        <label className="block">
          <span className="text-xs text-muted-foreground">{t('form.dailyMinutes')}</span>
          <input
            type="number"
            min={1}
            max={1440}
            value={dailyMinutes}
            onChange={(e) => setDailyMinutes(Number.parseInt(e.target.value, 10))}
            className="mt-1 w-full px-3 py-2 text-sm bg-muted border border-border rounded-lg"
          />
        </label>

        <label className="block">
          <span className="text-xs text-muted-foreground">{t('form.targetDate')}</span>
          <input
            type="date"
            value={targetDate}
            onChange={(e) => setTargetDate(e.target.value)}
            className="mt-1 w-full px-3 py-2 text-sm bg-muted border border-border rounded-lg"
          />
        </label>

        <div>
          <span className="text-xs text-muted-foreground">{t('form.decks')}</span>
          <p className="text-[11px] text-content-tertiary mt-0.5">{t('form.decksHint')}</p>
          <div className="mt-2 space-y-1 max-h-48 overflow-y-auto">
            {decks.length === 0 ? (
              <p className="text-xs text-content-tertiary">{t('form.noDecks')}</p>
            ) : decks.map((deck) => (
              <div key={deck.id} className="flex items-center justify-between gap-2">
                <label className="flex items-center gap-2 text-sm text-foreground cursor-pointer min-w-0">
                  <input
                    type="checkbox"
                    checked={deckIds.has(deck.id)}
                    onChange={() => toggleDeck(deck.id)}
                    className="cursor-pointer"
                  />
                  <span className="truncate">{deck.name}</span>
                </label>
                {/* Only for decks that are actually in the goal: a priority on a deck the
                    learner has not chosen is a control with nothing to act on. */}
                {deckIds.has(deck.id) && (
                  <div
                    role="radiogroup"
                    aria-label={`${t('form.deckPriority.label')} — ${deck.name}`}
                    className="flex shrink-0 gap-1"
                  >
                    {DECK_PRIORITY_LEVELS.map((level) => {
                      const selected = (deckPriority[deck.id] ?? DEFAULT_DECK_PRIORITY) === level
                      return (
                        <button
                          key={level}
                          type="button"
                          role="radio"
                          aria-checked={selected}
                          onClick={() => setDeckPriority((current) => ({ ...current, [deck.id]: level }))}
                          className={`text-xs px-2 py-0.5 rounded border cursor-pointer ${
                            selected
                              ? 'border-primary text-primary'
                              : 'border-border text-content-tertiary'
                          }`}
                        >
                          {t(`form.deckPriority.${level}`)}
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {localError && (
          <p role="alert" className="text-xs text-destructive">{localError}</p>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onCancel} className="px-3 py-1.5 text-sm border border-border rounded-lg cursor-pointer">
            {t('form.cancel')}
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={submitting}
            className="px-3 py-1.5 text-sm bg-primary text-primary-foreground rounded-lg cursor-pointer disabled:opacity-50"
          >
            {submitting ? t('form.saving') : t('form.save')}
          </button>
        </div>
      </div>
    </div>
  )
}
