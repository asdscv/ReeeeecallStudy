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
import { minCardsForMcq } from '@reeeeecall/shared/lib/quiz-outcome'
import { generateCostLine, freeLeftLine, affordableQuestionCount } from '@reeeeecall/shared/lib/quiz-pricing'

const TYPES: QuizQuestionType[] = ['mcq', 'short', 'essay']
// Presets plus a free field up to MAX_COUNT. The presets stop where a learner's idea of "a
// quiz" usually stops; anything past that is deliberate and is typed.
// 서버가 실제로 받는 길이만 보여 줍니다. 30·50 은 스키마가 12 로 막고 있는 동안에도
// 화면에 있었고, 고르면 원시 제약 위반(23514)이 돌아왔습니다. 264 가 20 까지 열었고,
// 그 위는 스키마가 아니라 생성 구조 이야기입니다 — 서술형 50문항은 17배치입니다.
// `quiz-count-options.test.ts` 가 이 목록을 마이그레이션의 상한에 붙들어 둡니다.
const COUNTS = [4, 6, 8, 10, 12, 16, 20]
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
  // Blocking here is kinder than letting the server refuse after the learner has picked
  // everything and seen a price.
  /** The chosen count is not one of the chips, so the custom box is what is in effect. */
  const isCustomCount = !COUNTS.includes(count)
  // From the BAND, not a literal 4. The far distractor slots are what need deck-mates, and the
  // band says how many there are — at the hardest one the model writes every distractor, so a
  // six-card deck was being refused for cards it did not need.
  const mcqMinimum = minCardsForMcq(usableBands.find((b) => b.level === activeBand))
  const tooFewForMcq = type === 'mcq' && eligible > 0 && eligible < mcqMinimum
  const canSubmit = Boolean(deckId) && eligible > 0 && !tooFewForMcq && !generating
    && priced !== null && priced.sufficient
  /**
   * How many of the requested questions are payable right now.
   *
   * Only meaningful when the quote says the full count is not — see `affordableQuestionCount`
   * for why the screen has to be able to name this number at all.
   */
  const affordable = affordableQuestionCount(priced, count)
  const costLine = generateCostLine(priced)
  const freeLeft = freeLeftLine(priced)

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
        // The quote's own split, so the batch drawdown can follow the server's
        // trial -> free -> paid order instead of guessing pro-rata. Without it the
        // final batch is refused whenever free questions remain.
        freeQuestions: (priced.free_items ?? 0) + (priced.trial_items ?? 0),
        paidQuestions: priced.paid_items ?? 0,
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
          </div>

          {/* Out of the chip row, and labelled.
              It used to sit inline as a ninth chip that always echoed `count`, so typing 13
              highlighted nothing and typing 6 lit up the 6 chip — the same control appearing to
              do two different things depending on the number. Now it is visibly a separate
              input, empty unless the chosen count is genuinely custom, and highlighted when it
              is the thing in effect. */}
          <div className="mt-2 flex items-center gap-2">
            <label htmlFor="quiz-count-custom" className="text-xs text-content-tertiary">
              {t('setup.customCount')}
            </label>
            <input
              id="quiz-count-custom"
              type="number"
              inputMode="numeric"
              min={1}
              max={MAX_COUNT}
              value={isCustomCount ? count : ''}
              placeholder={`1–${MAX_COUNT}`}
              onChange={(e) => {
                const raw = e.target.value
                if (raw === '') return
                const n = Number(raw)
                if (Number.isFinite(n)) setCount(Math.min(MAX_COUNT, Math.max(1, Math.round(n))))
              }}
              aria-label={t('setup.customCount')}
              data-testid="quiz-count-custom"
              className={`w-20 rounded-lg border px-2 py-1.5 text-center text-sm text-foreground ${
                isCustomCount
                  ? 'border-brand bg-brand/5 font-medium'
                  : 'border-border bg-background'
              }`}
            />
            {/* One place says what will actually be made, whichever control set it. */}
            <span className="text-xs text-content-tertiary" data-testid="quiz-count-effective">
              {t('setup.countEffective', { count: Math.min(count, eligible || count) })}
            </span>
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

      {/* What this batch costs, and what is left of today's free questions.
          An allowance nobody can see is not an allowance: the free tier gets five questions a day
          whatever the type, and until mig 239 the only way to discover that was to be charged for
          the sixth. Both lines come from the shared helper, so the two platforms cannot start
          explaining the same billing differently. */}
      {costLine && (
        <div className="p-3 bg-muted/50 border border-border rounded-lg space-y-1" data-testid="quiz-generate-cost">
          <p className="text-xs text-foreground">{t(costLine.key, costLine.params)}</p>
          {freeLeft && (
            <p className="text-xs text-muted-foreground" data-testid="quiz-free-left">
              {t(freeLeft.key, freeLeft.params)}
            </p>
          )}
        </div>
      )}

      {priced && !priced.sufficient && (
        <div className="p-3 bg-destructive/10 border border-destructive/30 rounded-lg space-y-2">
          <p className="text-xs text-destructive">{t('error.AI_INSUFFICIENT_CREDITS')}</p>
          {/* The number, and a way to take it.
              This used to be the red line alone over a disabled button, which is where a learner
              with five free questions left who asked for ten got NOTHING — not five. The reserve
              is all-or-nothing by design (it agrees one price up front), so the only way to use
              the free allowance was to guess the exact count. Now the screen says the count and
              offers it in one tap. */}
          {affordable > 0 && (
            <button
              type="button"
              onClick={() => setCount(affordable)}
              className="w-full rounded-lg border border-destructive/40 px-3 py-1.5 text-xs font-medium text-destructive transition-colors hover:bg-destructive/10"
              data-testid="quiz-use-affordable"
            >
              {t('setup.makeAffordable', { count: affordable })}
            </button>
          )}
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
