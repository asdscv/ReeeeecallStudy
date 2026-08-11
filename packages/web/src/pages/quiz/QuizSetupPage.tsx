import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AI_HUB_QUIZ } from '@reeeeecall/shared/lib/ai/hub/catalog'
import { AiCreditNotice } from '../../components/ai/AiCreditNotice'
import { useNavigate } from 'react-router-dom'
import {
  useQuizStore, QuizError, QUIZ_GENERATE_ACTION,
  type QuizQuestionType, type QuizQuote, type QuizzableCount, type QuizDifficultyBand,
} from '@reeeeecall/shared/stores/quiz-store'
import { useDeckStore } from '@reeeeecall/shared/stores/deck-store'

const TYPES: QuizQuestionType[] = ['mcq', 'short', 'essay']
// Presets plus a free field up to MAX_COUNT. The presets stop where a learner's idea of "a
// quiz" usually stops; anything past that is deliberate and is typed.
const COUNTS = [4, 6, 8, 10, 12, 20, 30, 50]
const MAX_COUNT = 50

/**
 * Pick a scope and a type, see what it costs, confirm.
 *
 * The price is quoted by the SERVER (`get_ai_quiz_quote`) and passed back verbatim as
 * `maxPriceMicro`. The client never multiplies a unit price itself — if it did, an owner
 * changing the price would silently charge a number the learner never saw, and the whole
 * "you approved this" claim would be a client-side belief rather than a server-checked fact.
 *
 * The riskiest state on this screen is `eligible = 0`. It is not an error: it means the
 * deck's template never marked which back field is the answer, which the learner can fix.
 * Saying "0 of 561" rather than "0" is what makes that difference visible.
 */
export function QuizSetupPage() {
  const { t, i18n } = useTranslation('quiz')
  const navigate = useNavigate()
  const { decks, fetchDecks } = useDeckStore()
  const {
    countQuizzable, quote, createAndGenerate, generating, generateProgress, difficultyLevels,
  } = useQuizStore()

  const [deckId, setDeckId] = useState('')
  const [type, setType] = useState<QuizQuestionType>('mcq')
  const [count, setCount] = useState(6)
  // Keyed by deck, not cleared in an effect. Clearing synchronously would be a setState
  // inside an effect (a cascading render), and leaving it unkeyed would flash the previous
  // deck's numbers over the newly chosen one.
  const [counts, setCounts] = useState<{ deckId: string; value: QuizzableCount } | null>(null)
  const [priced, setPriced] = useState<QuizQuote | null>(null)
  // Listed from the server, never enumerated here: a band is a row, so a new one appears
  // without a deploy. The default is the hardest, which is what the feature shipped as.
  const [bands, setBands] = useState<QuizDifficultyBand[]>([])
  // No initial level. Until the learner picks one, the band is whichever row the server
  // marked `is_default` — hardcoding 3 here overrode that silently on every fresh screen.
  const [difficulty, setDifficulty] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => { void fetchDecks() }, [fetchDecks])
  useEffect(() => { void difficultyLevels().then(setBands).catch(() => setBands([])) }, [difficultyLevels])

  useEffect(() => {
    if (!deckId) return
    let cancelled = false
    void countQuizzable(deckId)
      .then((value) => { if (!cancelled) setCounts({ deckId, value }) })
      .catch(() => { if (!cancelled) setCounts(null) })
    return () => { cancelled = true }
  }, [deckId, countQuizzable])

  const shownCounts = counts?.deckId === deckId ? counts.value : null

  const refreshQuote = useCallback(() => {
    let cancelled = false
    void quote(QUIZ_GENERATE_ACTION[type], count)
      .then((q) => { if (!cancelled) setPriced(q) })
      .catch(() => { if (!cancelled) setPriced(null) })
    return () => { cancelled = true }
  }, [quote, type, count])

  useEffect(() => refreshQuote(), [refreshQuote])

  // Only the bands that have guidance for the chosen type. A band without it is refused by
  // `create_quiz_set` (P0013) rather than defaulted, so offering it would be offering a
  // button that errors.
  const usableBands = bands.filter((b) => !b.types || b.types.includes(type))
  // Switching type can strip the chosen band. Derived rather than corrected in an effect —
  // a setState inside an effect is a cascading render, and the fallback is the band the
  // server marked default.
  const activeBand = difficulty !== null && usableBands.some((b) => b.level === difficulty)
    ? difficulty
    : (usableBands.find((b) => b.is_default) ?? usableBands[0])?.level ?? null
  const eligible = shownCounts?.eligible ?? 0
  // Multiple choice needs three other cards to draw plausible distractors from. Blocking here
  // is kinder than letting the server refuse after the learner has picked everything.
  const tooFewForMcq = type === 'mcq' && eligible > 0 && eligible < 4
  const canSubmit = Boolean(deckId) && eligible > 0 && !tooFewForMcq && !generating
    && priced !== null && priced.sufficient

  const submit = async () => {
    if (!priced || !deckId) return
    setError(null)
    try {
      const deck = decks.find((d) => d.id === deckId)
      const setId = await createAndGenerate({
        deckId,
        title: deck?.name ?? t('setup.untitled'),
        questionType: type,
        count: Math.min(count, eligible),
        locale: i18n.language.split('-')[0],
        // May be null before the band list has loaded; the server then applies its own
        // default rather than being handed a guess.
        difficulty: activeBand ?? undefined,
        maxPriceMicro: priced.price_micro,
      })
      navigate(`/quiz?created=${setId}`)
    } catch (e) {
      // A price that moved between the quote and the reservation is retryable and says so;
      // everything else gets its own sentence. No raw server string reaches the screen.
      const code = e instanceof QuizError ? e.code : 'UNKNOWN'
      setError(t(`error.${code}`))
      if (code === 'AI_PRICE_CHANGED') refreshQuote()
    }
  }

  return (
    <div className="max-w-2xl mx-auto p-4 space-y-4">
      <div>
        <h1 className="text-lg font-medium text-foreground">{t('setup.title')}</h1>
        <p className="text-xs text-content-tertiary mt-0.5">{t('setup.subtitle')}</p>
      </div>

      {/* The screen the paid action is started from. Placed by feature id so it follows the
          catalog rather than this file. */}
      <AiCreditNotice featureId={AI_HUB_QUIZ} />

      <div className="p-3 bg-card rounded-lg border border-border space-y-3">
        <label className="block">
          <span className="text-xs text-content-tertiary">{t('setup.deck')}</span>
          <select
            value={deckId}
            onChange={(e) => setDeckId(e.target.value)}
            className="mt-1 w-full px-3 py-2 text-sm bg-background border border-border rounded-lg text-foreground"
          >
            <option value="">{t('setup.deckPlaceholder')}</option>
            {decks.map((deck) => (
              <option key={deck.id} value={deck.id}>{deck.name}</option>
            ))}
          </select>
        </label>

        {shownCounts && (
          eligible === 0 ? (
            <div className="p-3 bg-destructive/10 border border-destructive/30 rounded-lg">
              <p className="text-sm text-destructive">
                {t('setup.noEligible.title', { total: shownCounts.total })}
              </p>
              {/* Actionable, because it is fixable: the template never said which back field
                  is the answer, and the learner owns the template. */}
              <p className="text-xs text-content-tertiary mt-1">{t('setup.noEligible.body')}</p>
            </div>
          ) : (
            <p className="text-xs text-content-tertiary">
              {t('setup.eligible', { eligible, total: shownCounts.total })}
            </p>
          )
        )}

        <div>
          <span className="text-xs text-content-tertiary">{t('setup.type')}</span>
          <div className="flex gap-2 mt-1">
            {TYPES.map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setType(option)}
                className={`px-3 py-1.5 text-sm rounded-lg border cursor-pointer transition-colors ${
                  type === option
                    ? 'bg-brand text-white border-brand'
                    : 'bg-background text-foreground border-border hover:border-brand/40'
                }`}
              >
                {t(`type.${option}`)}
              </button>
            ))}
          </div>
          <p className="text-xs text-content-tertiary mt-1">{t(`setup.typeHint.${type}`)}</p>
        </div>

        <div>
          <span className="text-xs text-content-tertiary">{t('setup.count')}</span>
          <div className="flex gap-2 mt-1">
            {COUNTS.map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setCount(option)}
                disabled={eligible > 0 && option > eligible}
                className={`px-3 py-1.5 text-sm rounded-lg border cursor-pointer transition-colors disabled:opacity-40 ${
                  count === option
                    ? 'bg-brand text-white border-brand'
                    : 'bg-background text-foreground border-border hover:border-brand/40'
                }`}
              >
                {option}
              </button>
            ))}
            <input
              type="number"
              min={1}
              max={MAX_COUNT}
              value={count}
              onChange={(e) => {
                const n = Number(e.target.value)
                if (Number.isFinite(n)) setCount(Math.min(MAX_COUNT, Math.max(1, Math.round(n))))
              }}
              aria-label={t('setup.count')}
              className="w-16 rounded-lg border border-border bg-background px-2 py-1.5 text-center text-sm text-foreground"
            />
          </div>
          {/* The submit clamps to `eligible`, and on a deck smaller than the smallest chip every
              chip is disabled — so the screen showed a count nobody could change and then quietly
              made a different number. Say the real number instead. */}
          {eligible > 0 && eligible < count && (
            <p className="text-xs text-content-tertiary mt-1">
              {t('setup.clampedCount', { count: eligible })}
            </p>
          )}
        </div>

        {/* Every type has a band since mig 202: difficulty is an instruction the band
            carries per question type, not a count of near-miss options. */}
        {usableBands.length > 0 && (
          <div>
            <span className="text-xs text-content-tertiary">{t('setup.difficulty')}</span>
            <div className="flex gap-2 mt-1">
              {usableBands.map((band) => (
                <button
                  key={band.level}
                  type="button"
                  onClick={() => setDifficulty(band.level)}
                  className={`px-3 py-1.5 text-sm rounded-lg border cursor-pointer transition-colors ${
                    activeBand === band.level
                      ? 'bg-brand text-white border-brand'
                      : 'bg-background text-foreground border-border hover:border-brand/40'
                  }`}
                >
                  {t(`difficulty.${band.level}`, { defaultValue: t('difficulty.generic', { level: band.level }) })}
                </button>
              ))}
            </div>
            <p className="text-xs text-content-tertiary mt-1">{t(`difficultyHint.${type}.${activeBand}`, { defaultValue: '' })}</p>
          </div>
        )}

        {tooFewForMcq && (
          <p className="text-xs text-destructive">{t('setup.tooFewForMcq', { count: eligible })}</p>
        )}
      </div>

      {/* The amount is no longer announced in the flow — a product decision, not a
          rendering one. The QUOTE is still fetched and still gates the button: it is what
          `maxPriceMicro` authorises, and without it a price that moved between choosing and
          reserving would be spent silently. What remains on screen is the one thing a
          learner cannot act on without: that they have nothing left to spend. */}
      {priced && !priced.sufficient && (
        <div className="p-3 bg-destructive/10 border border-destructive/30 rounded-lg">
          <p className="text-xs text-destructive">{t('error.AI_INSUFFICIENT_CREDITS')}</p>
        </div>
      )}

      {error && (
        <div role="alert" className="p-3 bg-destructive/10 border border-destructive/30 rounded-lg text-sm text-destructive">
          {error}
        </div>
      )}

      <button
        type="button"
        onClick={() => void submit()}
        disabled={!canSubmit}
        className="w-full px-3 py-2 text-sm font-medium bg-brand text-white rounded-lg cursor-pointer transition-colors hover:bg-brand-hover disabled:opacity-50"
      >
        {generating
          // A 50-question quiz is several model calls and can take over a minute. A button
          // stuck on "만드는 중…" for that long reads as a hang.
          ? (generateProgress && generateProgress.total > 1
            ? t('setup.generatingBatch', {
              done: generateProgress.done, total: generateProgress.total,
            })
            : t('setup.generating'))
          : t('setup.confirm')}
      </button>
    </div>
  )
}
