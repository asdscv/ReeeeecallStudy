import { useEffect, useMemo, useState } from 'react'
import {
  availableDomainIds, projectWorkload, daysForDailyBudget,
  parseCadence, parseNewCardsPerDay, studyDaysBetween, perStudyDayMultiplier,
  DEFAULT_NEW_CARDS_PER_DAY,
} from '@reeeeecall/shared/learning'
import { useTranslation } from 'react-i18next'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../../components/ui/dialog'
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
 *
 * ## What the last pass changed, and why
 *
 * The two pacing numbers were unreadable, and one of them was silently contradicted 40px below
 * itself: "하루에 새로 배울 카드 20" sat next to a projection reading "하루 새 카드 62장" — the
 * same unit, two different meanings (a CEILING the learner sets, and the RATE the deadline
 * demands), neither labelled as such. They are now stated as what they are, and when they
 * disagree the form says so in a sentence instead of leaving the learner to notice.
 *
 * The date and the minutes budget used to be two live inputs that answered the same question
 * from opposite ends, in different places on the screen, with the budget silently winning. They
 * are now one explicit choice — 목표일 기준 / 하루 시간 기준 — so whichever one is driving the
 * plan is the one on screen.
 *
 * Dismissal is Radix's, not hand-rolled: this used to be a bare `fixed inset-0` div, so clicking
 * the backdrop or pressing Escape did nothing and `aria-modal="true"` was a claim nothing
 * enforced. `Dialog` supplies backdrop-close, Escape, focus trap and focus restore.
 */

export interface GoalFormValues {
  domainId: string
  title: string
  dailyMinutes: number
  targetDate: string | null
  decks: GoalDeckLink[]
  /** Study rhythm and daily intake limit, stored in `learning_goals.settings`. */
  settings: Record<string, unknown>
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

/** Which side of the same question the learner pinned. See the `basis` state below. */
type PlanBasis = 'date' | 'minutes'

export function GoalFormModal({ goal, onCancel, onSubmit, submitting }: {
  goal: LearningGoalWithDecks | null
  onCancel: () => void
  onSubmit: (values: GoalFormValues) => void
  submitting: boolean
}) {
  const { t } = useTranslation('learning')
  const { decks, stats, fetchDecks, fetchStats } = useDeckStore()
  const { user } = useAuthStore()

  /**
   * How often this learner studies, as `studyDays` out of every 7.
   *
   * The cycle stays 7 until there is a control for it. The stored shape is already general —
   * `{ cycleDays, studyDays }` says "15 days a month" as easily as "3 a week" — so opening that
   * up later is a second input, not a migration or a rewrite.
   */
  const [studyDays, setStudyDays] = useState(() => parseCadence(goal?.settings).studyDays)
  const cadence = useMemo(() => ({ cycleDays: 7, studyDays }), [studyDays])

  /**
   * New cards to start per study day.
   *
   * Twenty is the figure every mainstream SRS ships as its default, and it is a defensible one:
   * each new card commits the learner to roughly seven reviews over the following year, so 20/day
   * settles at a few hundred reviews a day rather than an unbounded climb.
   */
  const [newCardsPerDay, setNewCardsPerDay] = useState(
    () => parseNewCardsPerDay(goal?.settings) ?? DEFAULT_NEW_CARDS_PER_DAY,
  )

  const [title, setTitle] = useState(goal?.title ?? '')
  const [targetDate, setTargetDate] = useState(goal?.target_date ?? '')
  const [deckIds, setDeckIds] = useState<Set<string>>(
    new Set((goal?.decks ?? []).map((link) => link.deck_id)),
  )
  // The learner may pin either side: a date, or a daily budget. Both are legitimate — "I have
  // until November" and "I have 30 minutes a day" are the same question from opposite ends.
  // Which one is pinned is now an explicit choice rather than an emergent one: two live inputs
  // that both changed the saved budget, with the minutes box quietly outranking the date, is
  // how the form ended up showing two different finish stories at once.
  const [basis, setBasis] = useState<PlanBasis>('date')
  const [budgetMinutes, setBudgetMinutes] = useState<number | null>(
    () => (goal?.daily_minutes ?? null),
  )
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

  /**
   * Date-driven: how much per STUDY day.
   *
   * The projection runs over calendar days because that is when reviews come due — a card is due
   * in three days whether or not the learner studies then. Studying fewer days does not reduce
   * the work, it concentrates it, so the per-day figures are scaled up by the inverse of the
   * study ratio afterwards rather than the horizon being shortened beforehand.
   */
  const projection = useMemo(() => {
    if (selection.total === 0 || daysAvailable === null) return null
    if (studyDaysBetween(cadence, daysAvailable) < 1) return null
    const raw = projectWorkload({ ...workloadInput, daysAvailable })
    const perDay = perStudyDayMultiplier(cadence)
    return {
      ...raw,
      averageMinutesPerDay: raw.averageMinutesPerDay * perDay,
      peakMinutesPerDay: raw.peakMinutesPerDay * perDay,
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection.unseen, selection.seen, selection.total, daysAvailable, cadence])

  /** Budget-driven: when it finishes. Null when the budget cannot keep up at all. */
  const daysForBudget = useMemo(() => {
    if (selection.total === 0 || budgetMinutes === null || budgetMinutes <= 0) return null
    // The budget is what the learner does IN A SESSION. Spread back over calendar days before
    // asking how long it takes, or a three-days-a-week learner is told the finish date of
    // someone studying daily.
    return daysForDailyBudget({
      ...workloadInput,
      minutesPerDay: budgetMinutes / perStudyDayMultiplier(cadence),
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection.unseen, selection.seen, selection.total, budgetMinutes, cadence])

  const budgetFinishDate = daysForBudget === null
    ? null
    : new Date(Date.now() + daysForBudget * DAY_MS).toISOString().slice(0, 10)

  /**
   * The intake rate the deadline demands, against the ceiling the learner set.
   *
   * These two numbers are in the same unit and used to sit 40px apart with nothing saying they
   * measured different things. `projection.newCardsPerDay` is what the date REQUIRES;
   * `newCardsPerDay` is the ceiling. When the ceiling is lower, the target date is not reachable
   * at this pace — which is worth one sentence, not a silent contradiction.
   */
  const neededNewPerDay = projection?.newCardsPerDay ?? null
  const capBlocksTarget =
    basis === 'date' && neededNewPerDay !== null && newCardsPerDay < neededNewPerDay

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
      // The planner's per-day budget. Derived, not typed: the learner's own figure when they
      // pinned the minutes side, the projection when they pinned the date, and the previous
      // value when neither can be computed.
      dailyMinutes: Math.max(1, Math.min(1440, Math.round(
        (basis === 'minutes' ? budgetMinutes : projection?.averageMinutesPerDay)
        ?? goal?.daily_minutes ?? 20,
      ))),
      // Kept whatever the basis: a deadline is a fact about the goal, not a consequence of
      // which side of the arithmetic the learner happened to pin.
      targetDate: targetDate || null,
      decks: [...deckIds].map((deck_id) => ({ deck_id, importance: NEUTRAL_IMPORTANCE })),
      // Stored whole rather than merged into whatever was there: these two are the only keys
      // anything writes, and a read-modify-write here would race an edit made on another device.
      settings: { cadence, newCardsPerDay },
    })
  }

  const minutes = (value: number) => t('form.plan.minutes', { count: Math.max(1, Math.round(value)) })

  const fieldClass =
    'mt-1.5 w-full px-3 py-2 text-sm bg-background border border-border rounded-lg ' +
    'text-foreground outline-none transition-colors focus:border-brand focus:ring-2 focus:ring-brand/20'

  return (
    <Dialog open onOpenChange={(next) => { if (!next) onCancel() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t(goal ? 'form.editTitle' : 'form.createTitle')}</DialogTitle>
        </DialogHeader>

        <div className="space-y-5">
          <label className="block">
            <span className="text-xs font-medium text-foreground">{t('form.goalTitle')}</span>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={500}
              className={fieldClass}
              placeholder={t('form.goalTitlePlaceholder')}
            />
          </label>

          <div className="block">
            <span className="text-xs font-medium text-foreground">{t('form.decks')}</span>
            <p className="text-[11px] text-content-tertiary mt-0.5">{t('form.decksHint')}</p>
            <div className="mt-1.5 max-h-40 overflow-y-auto border border-border rounded-lg p-2 space-y-0.5">
              {decks.length === 0 && <p className="text-xs text-content-tertiary">{t('form.noDecks')}</p>}
              {decks.map((deck) => (
                <label
                  key={deck.id}
                  className="flex items-center gap-2 text-sm text-foreground rounded-md px-1.5 py-1 cursor-pointer hover:bg-accent/60"
                >
                  <input
                    type="checkbox"
                    checked={deckIds.has(deck.id)}
                    onChange={() => toggleDeck(deck.id)}
                    className="accent-brand cursor-pointer"
                  />
                  <span className="truncate">{deck.name}</span>
                </label>
              ))}
            </div>
            {/* What was actually picked, in cards. "덱 3개" says nothing about the size of the
                job; the split between seen and unseen is what every number below is computed
                from, so it is stated where the choice is made. */}
            {selection.total > 0 && (
              <p className="mt-1.5 text-[11px] text-content-tertiary">
                {t('form.decksSummary', { total: selection.total, unseen: selection.unseen })}
              </p>
            )}
          </div>

          {/* ── Which side of the question the learner is pinning ──────────────── */}
          <div>
            <span className="text-xs font-medium text-foreground">{t('form.basisLabel')}</span>
            <p className="text-[11px] text-content-tertiary mt-0.5">{t('form.basisHint')}</p>
            <div
              role="radiogroup"
              aria-label={t('form.basisLabel')}
              className="mt-1.5 grid grid-cols-2 gap-1 rounded-lg bg-muted p-1"
            >
              {(['date', 'minutes'] as const).map((option) => {
                const selected = basis === option
                return (
                  <button
                    key={option}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => setBasis(option)}
                    className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer ${
                      selected
                        ? 'bg-card text-foreground shadow-sm'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {t(option === 'date' ? 'form.basisDate' : 'form.basisMinutes')}
                  </button>
                )
              })}
            </div>

            {basis === 'date' ? (
              <label className="block mt-2.5">
                <span className="text-xs text-muted-foreground">{t('form.targetDate')}</span>
                <input
                  type="date"
                  value={targetDate}
                  onChange={(e) => setTargetDate(e.target.value)}
                  className={fieldClass}
                />
              </label>
            ) : (
              <label className="block mt-2.5">
                <span className="text-xs text-muted-foreground">{t('form.dailyBudget')}</span>
                <div className="relative">
                  <input
                    type="number"
                    min={1}
                    max={1440}
                    value={budgetMinutes ?? ''}
                    onChange={(e) => {
                      // Clamped here rather than only on submit: the preview computes a finish
                      // date from whatever is typed, and `Math.min(1440, …)` at save time would
                      // otherwise promise a date the saved goal can never hit.
                      const raw = e.target.value
                      if (raw === '') { setBudgetMinutes(null); return }
                      const next = Number(raw)
                      setBudgetMinutes(
                        Number.isFinite(next) ? Math.max(1, Math.min(1440, Math.trunc(next))) : null,
                      )
                    }}
                    className={`${fieldClass} pr-10`}
                  />
                  {/* The ko/ja/zh labels named no unit at all, so a three-character box invited
                      hours. The unit now sits inside the field. */}
                  <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-content-tertiary">
                    {t('form.minutesUnit')}
                  </span>
                </div>
                {/* Still offered, and still saved, even though the date is not what drives the
                    plan on this side. Deadlines outlive the arithmetic used to plan for them. */}
                <span className="mt-2.5 block text-xs text-muted-foreground">{t('form.targetDate')}</span>
                <input
                  type="date"
                  value={targetDate}
                  onChange={(e) => setTargetDate(e.target.value)}
                  className={fieldClass}
                />
              </label>
            )}
          </div>

          {/* ── Rhythm and intake ─────────────────────────────────────────────── */}
          <div className="space-y-3">
            <label className="block">
              <span className="text-xs font-medium text-foreground">{t('form.studyDays')}</span>
              <select
                value={studyDays}
                onChange={(e) => setStudyDays(Number(e.target.value))}
                className={`${fieldClass} cursor-pointer`}
              >
                {[1, 2, 3, 4, 5, 6, 7].map((n) => (
                  <option key={n} value={n}>{t('form.studyDaysOption', { count: n })}</option>
                ))}
              </select>
              {/* The missing sentence. Picking a smaller number makes every minute figure on the
                  screen go UP, which without this reads as the app punishing the learner. */}
              <p className="mt-1 text-[11px] text-content-tertiary">{t('form.studyDaysHint')}</p>
            </label>

            <label className="block">
              <span className="text-xs font-medium text-foreground">{t('form.newCardsPerDay')}</span>
              <div className="relative">
                <input
                  type="number"
                  min={0}
                  max={999}
                  value={newCardsPerDay}
                  onChange={(e) => {
                    // Clamped here rather than on submit: a controlled number input that accepts a
                    // value it will later discard shows the learner a figure the plan never used.
                    const next = Number(e.target.value)
                    setNewCardsPerDay(Number.isFinite(next) ? Math.max(0, Math.min(999, Math.trunc(next))) : 0)
                  }}
                  className={`${fieldClass} pr-10`}
                />
                <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-content-tertiary">
                  {t('form.cardsUnit')}
                </span>
              </div>
              {/* What raising or lowering it actually costs — distinct from the reviews-first
                  rule below, which holds at every value including this one. */}
              <p className="mt-1 text-[11px] text-content-tertiary">{t('form.newCardsPerDayHint')}</p>
              {/* 0 is a real answer, not a broken one, and nothing said so. */}
              {newCardsPerDay === 0 && (
                <p className="mt-1 text-[11px] text-content-tertiary">{t('form.newCardsPerDayZero')}</p>
              )}
              <p className="mt-1 text-[11px] text-content-tertiary">{t('form.newCardsHint')}</p>
            </label>
          </div>

          {/* ── The plan this goal implies, before it is saved ────────────────── */}
          <section
            aria-label={t('form.plan.title')}
            className="rounded-lg border border-border bg-muted/40 p-3 space-y-1.5"
          >
            <h3 className="text-xs font-semibold text-foreground">{t('form.plan.title')}</h3>

            {selection.total === 0 || (basis === 'date' ? daysAvailable === null : !budgetMinutes) ? (
              <p className="text-[11px] text-content-tertiary">
                {t(basis === 'date' ? 'form.plan.needDecksAndDate' : 'form.plan.needDecksAndBudget')}
              </p>
            ) : basis === 'date' ? (
              projection && (
                <>
                  <p className="text-sm text-foreground">{minutes(projection.averageMinutesPerDay)}</p>
                  {/* Stated separately and never averaged away: this is the day the learner has
                      to actually survive. */}
                  <p className="text-[11px] text-content-tertiary">
                    {t('form.plan.peak', {
                      minutes: Math.round(projection.peakMinutesPerDay),
                      day: projection.peakDay + 1,
                    })}
                  </p>
                  {/* The rate the DEADLINE demands, named as such so it cannot be mistaken for
                      the ceiling set above — they are the same unit and used to disagree in
                      silence. */}
                  {neededNewPerDay !== null && (
                    <p className="text-[11px] text-content-tertiary">
                      {t('form.plan.newPerDayNeeded', { count: neededNewPerDay })}
                    </p>
                  )}
                  {capBlocksTarget && (
                    <p className="text-[11px] text-warning">
                      {t('form.plan.capBelowNeeded', { count: newCardsPerDay })}
                    </p>
                  )}
                </>
              )
            ) : (
              <>
                <p className="text-sm text-foreground">
                  {budgetFinishDate
                    ? t('form.plan.finishBy', { date: budgetFinishDate })
                    : t('form.plan.tooSlow')}
                </p>
                {budgetFinishDate && (
                  <p className="text-[11px] text-content-tertiary">{t('form.plan.peakBasis')}</p>
                )}
              </>
            )}

            {/* Only SRS-mode study feeds the plan — cramming and the sequential modes call
                apply_study_rating with no SRS payload, so they move nothing here. Said out loud
                rather than left for the learner to discover from a plan that never changes. */}
            <p className="text-[11px] text-content-tertiary pt-1">{t('form.plan.srsOnly')}</p>
            <p className="text-[11px] text-content-tertiary">{t('form.plan.estimate')}</p>
          </section>

          {localError && <p role="alert" className="text-xs text-destructive">{localError}</p>}

          {/* Pinned to the bottom of the dialog's own scroll area. The form is taller than
              85vh on a laptop, so a footer in normal flow left 저장 half-cut at the fold —
              the one control the learner is looking for. */}
          <div className="sticky -bottom-4 -mx-4 flex justify-end gap-2 border-t border-border bg-background px-4 py-3 sm:-bottom-6 sm:-mx-6 sm:px-6">
            <button
              type="button"
              onClick={onCancel}
              className="px-3 py-1.5 text-sm text-muted-foreground rounded-lg cursor-pointer hover:bg-accent"
            >
              {t('form.cancel')}
            </button>
            <button
              type="button"
              onClick={submit}
              disabled={submitting}
              className="px-4 py-1.5 text-sm font-medium bg-brand text-white rounded-lg cursor-pointer transition-colors hover:bg-brand-hover disabled:opacity-60"
            >
              {submitting ? t('form.saving') : t('form.save')}
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
