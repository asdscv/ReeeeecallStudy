import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { useQuizStore, mistakeResponseText, groupMistakesByDeck } from '@reeeeecall/shared/stores/quiz-store'
import { dateLine } from '@reeeeecall/shared/lib/quiz-outcome'

/**
 * 오답 노트, on its own page, one deck at a time.
 *
 * It began as a panel that expanded on the quiz home, and that ran out of room immediately: five
 * decks of misses is a wall of text above the thing the learner came to the screen for. The panel
 * stays as a SUMMARY — how many cards, how many decks — and the reading happens here.
 *
 * A deck is picked, not merged. Cards from two decks cannot be one study session, so "study these
 * again" is per deck anyway, and mixing 영어 회화 with 중국어 발음 in one list makes neither
 * readable. One deck is selected at a time and its misses fill the page.
 *
 * One row per card, newest miss first — a card missed four times is one card to restudy, not four
 * copies of the same stem. That grouping is shared with mobile so the two cannot disagree about
 * what the list contains.
 */
export function QuizMistakesPage() {
  const { t } = useTranslation('quiz')
  const { mistakes, loadMistakes, loading } = useQuizStore()
  const [deckId, setDeckId] = useState<string | null>(null)

  useEffect(() => { void loadMistakes(undefined, 200).catch(() => {}) }, [loadMistakes])

  const decks = useMemo(() => groupMistakesByDeck(mistakes), [mistakes])
  // The deck with the most misses opens first: it is the one the learner has most to do about.
  const active = decks.find((d) => d.deckId === deckId)
    ?? [...decks].sort((a, b) => b.items.length - a.items.length)[0]

  const total = decks.reduce((n, d) => n + d.items.length, 0)

  return (
    <div className="max-w-2xl mx-auto p-4 space-y-4" data-testid="quiz-mistakes-page">
      <div>
        <Link to="/quiz" className="text-xs text-content-tertiary hover:underline">
          {t('run.backToQuiz')}
        </Link>
        <h1 className="text-lg font-medium text-foreground mt-1">{t('mistakes.title')}</h1>
        <p className="text-xs text-content-tertiary mt-0.5">
          {t('mistakes.summary', { cards: total, decks: decks.length })}
        </p>
      </div>

      {loading && decks.length === 0 && (
        <p className="text-sm text-content-tertiary">{t('run.loading')}</p>
      )}

      {!loading && decks.length === 0 && (
        // Not an error, and not a shrug. A learner who has never got one wrong should be told
        // that is what happened.
        <div className="p-6 bg-card rounded-xl border border-border text-center">
          <p className="text-sm text-muted-foreground">{t('mistakes.emptyTitle')}</p>
          <p className="text-xs text-content-tertiary mt-1">{t('mistakes.emptyBody')}</p>
        </div>
      )}

      {decks.length > 1 && (
        // Deck chips rather than one merged list: a session cannot span two decks, so the list
        // that feeds it should not either.
        <div className="flex flex-wrap gap-1.5">
          {decks.map((deck) => (
            <button
              key={deck.deckId}
              type="button"
              onClick={() => setDeckId(deck.deckId)}
              data-testid="quiz-mistakes-deck"
              className={`px-2.5 py-1 text-xs rounded-full border cursor-pointer transition-colors ${
                active?.deckId === deck.deckId
                  ? 'border-brand bg-brand/10 text-brand'
                  : 'border-border text-content-tertiary hover:border-brand/40'
              }`}
            >
              {deck.deckName} {deck.items.length}
            </button>
          ))}
        </div>
      )}

      {active && (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-medium text-foreground truncate">{active.deckName}</p>
            {/* The same URL the diagnostics panel uses, so a mistake list and a weak-card list
                start the identical kind of session. */}
            <Link
              to={`/decks/${active.deckId}/study?mode=srs&cards=${active.items.map((m) => m.card_id).join(',')}`}
              className="text-sm text-brand shrink-0 hover:underline"
              data-testid="quiz-mistakes-study"
            >
              {t('mistakes.studyAgain', { cards: active.items.length })}
            </Link>
          </div>

          <ul className="space-y-2">
            {active.items.map((m) => {
              const mine = mistakeResponseText(m)
              const at = dateLine(m.answered_at)
              return (
                <li key={m.attempt_id} className="p-3 bg-card rounded-lg border border-border">
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-sm text-foreground">{m.stem}</p>
                    {at && (
                      <span className="text-xs text-content-tertiary shrink-0">
                        {t(at.key, at.params)}
                      </span>
                    )}
                  </div>
                  {/* Their own words beside the answer they were graded against. Without both,
                      a list of stems says only "you failed something here". Not clamped on this
                      page — there is room, and this is where a learner comes to read them. */}
                  {mine && (
                    <p className="text-xs text-content-tertiary mt-1">
                      {t('mistakes.youWrote', { answer: mine })}
                    </p>
                  )}
                  {m.reference_answer && (
                    <p className="text-xs text-content-tertiary mt-0.5">
                      {t('run.reference', { answer: m.reference_answer })}
                    </p>
                  )}
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </div>
  )
}
