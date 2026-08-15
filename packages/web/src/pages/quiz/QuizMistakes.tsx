import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { useQuizStore, mistakeResponseText, groupMistakesByDeck } from '@reeeeecall/shared/stores/quiz-store'

/**
 * 오답 노트 — what you got wrong, and the one thing to do about it.
 *
 * Every wrong quiz answer was already being recorded: `answer_attempts` carries the card, the
 * response, the score and the run item, and nothing ever read it back. A learner could get the
 * same card wrong five sittings running and the app would never mention it.
 *
 * Grouped by deck, because that is the unit the "study these again" link takes — cards from two
 * decks cannot be one session, and a flat list would offer a button that cannot work. Within a
 * deck the newest miss wins and the card appears once: a card missed four times is one card to
 * restudy, not four rows of the same stem.
 *
 * It reschedules nothing. A quiz answer silently moving SRS reviews would let one casual sitting
 * rearrange weeks of study, so this shows the misses and the decision stays the learner's.
 */
export function QuizMistakes() {
  const { t } = useTranslation('quiz')
  const { mistakes, loadMistakes } = useQuizStore()
  const [expanded, setExpanded] = useState(false)

  useEffect(() => { void loadMistakes(undefined, 50).catch(() => {}) }, [loadMistakes])

  // Shared with the other platform: two copies of "which card, which deck, how many times" is
  // two places for the list and the study button to start disagreeing.
  const decks = useMemo(() => groupMistakesByDeck(mistakes), [mistakes])

  const total = decks.reduce((n, d) => n + d.items.length, 0)
  if (total === 0) return null

  return (
    <div className="p-3 bg-card rounded-lg border border-border" data-testid="quiz-mistakes">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center justify-between gap-3 cursor-pointer"
      >
        <div className="text-left">
          <p className="text-sm font-medium text-foreground">{t('mistakes.title')}</p>
          <p className="text-xs text-content-tertiary mt-0.5">
            {t('mistakes.summary', { cards: total, decks: decks.length })}
          </p>
        </div>
        <span className="text-xs text-content-tertiary shrink-0">
          {expanded ? t('mistakes.collapse') : t('mistakes.expand')}
        </span>
      </button>

      {expanded && (
        <div className="mt-3 space-y-3">
          {decks.map((deck) => (
            <div key={deck.deckId}>
              <div className="flex items-baseline justify-between gap-3">
                <p className="text-xs font-medium text-foreground truncate">{deck.deckName}</p>
                {/* The same URL the diagnostics panel uses, so a mistake list and a weak-card
                    list start the identical kind of session. */}
                <Link
                  to={`/decks/${deck.deckId}/study?mode=srs&cards=${deck.items.map((m) => m.card_id).join(',')}`}
                  className="text-xs text-brand shrink-0 hover:underline"
                >
                  {t('mistakes.studyAgain', { cards: deck.items.length })}
                </Link>
              </div>
              <ul className="mt-1 space-y-1">
                {deck.items.slice(0, 8).map((m) => {
                  const mine = mistakeResponseText(m)
                  return (
                    <li key={m.attempt_id} className="text-xs text-content-tertiary">
                      <span className="text-foreground">{m.stem}</span>
                      {/* Their own words beside the answer they were graded against. Without
                          both, a list of stems says only "you failed something here". */}
                      {mine && <span> · {t('mistakes.youWrote', { answer: mine })}</span>}
                      {m.reference_answer && (
                        <span> · {t('run.reference', { answer: m.reference_answer })}</span>
                      )}
                    </li>
                  )
                })}
                {deck.items.length > 8 && (
                  <li className="text-xs text-content-tertiary">
                    {t('mistakes.andMore', { cards: deck.items.length - 8 })}
                  </li>
                )}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
