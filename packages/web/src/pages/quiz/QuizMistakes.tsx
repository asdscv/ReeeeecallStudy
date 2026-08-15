import { useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { useQuizStore, groupMistakesByDeck } from '@reeeeecall/shared/stores/quiz-store'

/**
 * 오답 노트 — what you got wrong, and the one thing to do about it.
 *
 * Every wrong quiz answer was already being recorded: `answer_attempts` carries the card, the
 * response, the score and the run item, and nothing ever read it back. A learner could get the
 * same card wrong five sittings running and the app would never mention it.
 *
 * This is the SUMMARY on the quiz home — how many cards, across how many decks — and it opens
 * `QuizMistakesPage`, where the reading happens. It expanded in place at first and ran out of
 * room immediately: five decks of misses is a wall of text above the sets the learner came to
 * this screen for.
 *
 * Renders nothing at zero, deliberately: someone who has never got one wrong should not be shown
 * an empty 오답 노트 on every visit.
 */
export function QuizMistakes() {
  const { t } = useTranslation('quiz')
  const { mistakes, loadMistakes } = useQuizStore()

  useEffect(() => { void loadMistakes(undefined, 200).catch(() => {}) }, [loadMistakes])

  // Shared with the other platform and with the page itself: three copies of "which card, which
  // deck, how many times" is three places for them to start disagreeing.
  const decks = useMemo(() => groupMistakesByDeck(mistakes), [mistakes])
  const total = decks.reduce((n, d) => n + d.items.length, 0)
  if (total === 0) return null

  return (
    // A SUMMARY that opens the page, not the list itself. Expanding five decks of misses in
    // place buried the sets the learner came to this screen for.
    <Link
      to="/quiz/mistakes"
      className="flex items-center justify-between gap-3 p-3 bg-card rounded-lg border border-border no-underline hover:border-brand/40"
      data-testid="quiz-mistakes"
    >
      <div className="min-w-0">
        <p className="text-sm font-medium text-foreground">{t('mistakes.title')}</p>
        <p className="text-xs text-content-tertiary mt-0.5">
          {t('mistakes.summary', { cards: total, decks: decks.length })}
        </p>
      </div>
      <span className="text-xs text-brand shrink-0">{t('mistakes.open')}</span>
    </Link>
  )
}
