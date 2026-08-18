import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useParams } from 'react-router-dom'
import {
  useQuizStore, QuizError, QUIZ_GRADE_ACTION,
  optionFlaws, optionAxes, QUIZ_FEEDBACK_REASONS,
  type QuizRunItem, type QuizSubmitResult, type QuizQuote,
} from '@reeeeecall/shared/stores/quiz-store'
import { QuizFeedback } from './QuizFeedback'
import { AiRefusalNotice } from '../../components/ai/AiRefusalNotice'
import { quizGrowth, QUIZ_GROWTH_POLL_MS } from '@reeeeecall/shared/lib/quiz-shortfall'
import { answerLength } from '@reeeeecall/shared/lib/quiz-answer-limits'
import { itemOutcome, tallyQuiz, tallyLine } from '@reeeeecall/shared/lib/quiz-outcome'
import { gradeCostLine } from '@reeeeecall/shared/lib/quiz-pricing'

/**
 * Taking the quiz. Outside the app Layout, like the study session, so nothing competes with
 * the question.
 *
 * Multiple choice is MARKED the instant it is submitted, in SQL, for free — and that mark is
 * final; no model revises it. Its EXPLANATION shipped with the question (one axis per wrong
 * option, mig 252), so the one matching the learner's choice is already here: nothing to buy,
 * nothing to wait for. Short answer and essay buy the mark itself.
 *
 * Those two are quoted and confirmed per answer, and neither is bought automatically on submit:
 * spending is always a gesture.
 */
/**
 * 학습자가 고칠 수 있는 실패들. 재시도 버튼이 아니라 **무엇을 하면 되는지**가 필요합니다.
 *
 * `refusalFrom` 은 모르는 코드를 `kind: 'failed', retryable: true` 로 떨어뜨립니다 — 지갑
 * 문제에는 맞는 기본값이지만, "답안이 짧다"에는 틀린 답입니다. 같은 답으로 다시 시도하면
 * 같은 자리에서 또 거절됩니다.
 */
const QUIZ_SPECIFIC_ERRORS = new Set([
  'QUIZ_UNGRADEABLE', 'QUIZ_ITEM_GONE', 'QUIZ_NOT_ANSWERED', 'QUIZ_CARDS_TOO_SHORT',
])

export function QuizRunPage() {
  const { t } = useTranslation('quiz')
  const { runId } = useParams<{ runId: string }>()
  const navigate = useNavigate()
  const {
    run, loading, loadRun, refreshRun, submit, gradeWithAi, quote, grading, finishRun,
    rateItem, itemRatings,
  } = useQuizStore()
  /** Which item's reason chips are open. One at a time; closed by choosing or by moving on. */
  const [reasonsFor, setReasonsFor] = useState<string | null>(null)

  const [index, setIndex] = useState(0)
  const [choice, setChoice] = useState<number | null>(null)
  const [text, setText] = useState('')
  const [result, setResult] = useState<QuizSubmitResult | null>(null)
  // Keyed by item for the same reason the deck counts are on the setup screen: clearing it
  // synchronously inside the effect is a cascading render, and an unkeyed value would quote
  // the previous question's price on this one — an essay costs four times a short answer.
  // The whole quote, not just the price. The screen has to say whether this grading is covered
  // by the free allowance or charged, and only the server knows how much of it the free units
  // cover — a client re-deriving that from unit counts would be a second opinion about the
  // learner's own balance.
  const [gradeQuote, setGradeQuote] = useState<{ itemId: string; quote: QuizQuote } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [startedAt, setStartedAt] = useState(() => Date.now())

  useEffect(() => { if (runId) void loadRun(runId) }, [runId, loadRun])

  /**
   * A long quiz is still being written while its first questions are being answered.
   *
   * `start_quiz_run` snapshots, so the run only holds what existed when it opened; this pulls
   * in whatever has landed since. Polled while the set is still short of what was asked for,
   * and stopped as soon as it is complete — an idle poll on a finished quiz is pure noise.
   */
  //
  // 그리고 **영원히 못 채우는 경우**가 있습니다: 덱이 작아 카드를 다 썼거나, 그 카드들로는
  // 그 유형의 문항을 만들 수 없을 때. 그때 예전에는 조회가 4초마다 끝없이 돌고, 학습자는
  // 왜 5문항을 골랐는데 4문항인지 아무 설명도 못 받았습니다. `quizGrowth` 가 시간으로
  // 가릅니다 — 20초 동안 한 문항도 안 늘면 생성이 끝난 것입니다.
  const [idleTicks, setIdleTicks] = useState(0)
  const seenCount = useRef(-1)
  useEffect(() => {
    if (!run) return
    if (run.item_count !== seenCount.current) {
      seenCount.current = run.item_count
      setIdleTicks(0)
    }
  }, [run])
  const growth = quizGrowth(run?.item_count ?? 0, run?.requested_count, idleTicks)
  const stillGrowing = !!run && growth.polling
  useEffect(() => {
    if (!runId || !stillGrowing) return
    const id = setInterval(() => {
      void refreshRun(runId)
      setIdleTicks((t) => t + 1)
    }, QUIZ_GROWTH_POLL_MS)
    return () => clearInterval(id)
  }, [runId, stillGrowing, refreshRun])

  const items = useMemo(() => run?.items ?? [], [run])
  const item: QuizRunItem | undefined = items[index]

  // Re-quote per item: the price depends on the type, and an essay costs four times a short
  // answer. Quoting once for the run would show the wrong number on most of it.
  useEffect(() => {
    // Nothing to quote for multiple choice — nothing is bought after a multiple-choice answer.
    if (!item || item.question_type === 'mcq' || item.answered) return
    const itemId = item.item_id
    let cancelled = false
    void quote(QUIZ_GRADE_ACTION[item.question_type], 1)
      .then((q) => { if (!cancelled) setGradeQuote({ itemId, quote: q }) })
      .catch(() => { if (!cancelled) setGradeQuote(null) })
    return () => { cancelled = true }
  }, [item, quote])

  const shownQuote = item && gradeQuote?.itemId === item.item_id ? gradeQuote.quote : null
  const shownPrice = shownQuote?.price_micro ?? null
  const costLine = gradeCostLine(shownQuote)

  const goTo = (next: number) => {
    setIndex(next); setChoice(null); setText(''); setResult(null); setError(null)
    setReasonsFor(null)
    setStartedAt(Date.now())
  }

  const submitAnswer = async () => {
    if (!item) return
    setError(null)
    try {
      const payload = item.question_type === 'mcq'
        ? { choice }
        : { text: text.trim() }
      const submitted = await submit(item.item_id, payload as Record<string, unknown>, Date.now() - startedAt)
      setResult(submitted)
      // 제출과 채점은 한 동작입니다.
      //
      // 예전에는 답을 내고 나서 채점을 한 번 더 눌러야 했습니다. 하나의 의도에 두 번의 탭이고,
      // 그 사이에서 학습자는 "제출했는데 왜 점수가 없지"를 봅니다. 지출이 제스처여야 한다는
      // 규칙은 여전히 지켜집니다 — 값은 제출 버튼 **아래에** 미리 적혀 있고, 유형을 고를 때도
      // 한 번 말합니다. 이미 값을 보고 누른 제출이 그 제스처입니다.
      //
      // 객관식은 제출로 이미 채점이 끝나므로 여기 오지 않습니다.
      if (item.question_type !== 'mcq' && submitted && submitted.graded !== true && shownPrice !== null) {
        await gradeWithAi(item.item_id, text.trim(), shownPrice)
      }
      if (runId) await loadRun(runId)
    } catch (e) {
      setError(e instanceof QuizError ? e.code : 'UNKNOWN')
      // 채점이 거절돼도 답안은 이미 서버에 있습니다. 다시 읽어 두지 않으면 화면만 답하지 않은
      // 상태로 남아, 학습자가 같은 답을 또 제출하게 됩니다.
      if (runId) await loadRun(runId)
    }
  }

  const requestGrade = async () => {
    if (!item || shownPrice === null) return
    setError(null)
    try {
      await gradeWithAi(item.item_id, text.trim(), shownPrice)
    } catch (e) {
      // The CODE, not a sentence. `AiRefusalNotice` decides what it means and what the
      // learner can do about it — which on this screen is the whole point: a refused grade
      // here used to print "충전하면 계속할 수 있어요" with no way to 충전 anywhere on the run.
      setError(e instanceof QuizError ? e.code : 'UNKNOWN')
    }
  }

  const finish = async () => {
    if (!runId) return
    await finishRun(runId)
    navigate(`/quiz/${runId}/result`)
  }

  if (loading && !run) {
    return <div className="max-w-2xl mx-auto p-8 text-center text-sm text-content-tertiary">{t('run.loading')}</div>
  }
  if (!run || items.length === 0) {
    // Every question in the set can be cascaded away by card deletion. An empty run is a
    // real state with a real explanation, not a crash.
    return (
      <div className="max-w-2xl mx-auto p-8 text-center space-y-3">
        <p className="text-sm text-muted-foreground">{t('run.empty')}</p>
        <button
          type="button"
          onClick={() => navigate('/quiz')}
          className="px-3 py-1.5 text-sm font-medium bg-brand text-white rounded-lg cursor-pointer"
        >
          {t('run.backToQuiz')}
        </button>
      </div>
    )
  }
  if (!item) return null

  const answered = item.answered || result !== null
  const flaws = optionFlaws(item)
  // Written with the question and revealed on answering (mig 252). Free, and already here — this
  // used to be a $0.05 provider call the learner had to press for AFTER they had committed.
  const axes = optionAxes(item)
  /**
   * The option this learner chose, by text.
   *
   * From the stored response rather than local state: a reload, or coming back to a run from the
   * list, leaves `choice` null while the item is still answered.
   */
  const pickedIndex = typeof item.response?.choice === 'number' ? item.response.choice : choice
  const pickedOption = item.question_type === 'mcq' && pickedIndex !== null
    ? item.options?.[pickedIndex] ?? null
    : null
  const isLast = index === items.length - 1
  /** This item's verdict, and the run so far. Counts, never a ratio — see quiz-outcome.ts. */
  const outcome = item ? itemOutcome({ answered, score: item.score }) : 'unanswered'
  const tally = tallyQuiz(items.map((i) => ({ answered: i.answered, score: i.score })))
  const line = tallyLine(tally)
  /** Live length against the bound the SERVER will apply. Mirrored, and pinned by a test. */
  const length = answerLength(text, item?.question_type === 'essay' ? 'essay' : 'short')

  return (
    <div className="max-w-2xl mx-auto p-4 space-y-4 min-h-screen">
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs text-content-tertiary">
          {t('run.progress', { current: index + 1, total: items.length })}
          {tally.judged + tally.ungraded > 0 && (
            <span className="ml-2 text-content-tertiary" data-testid="quiz-tally">
              {t(line.key, line.params)}
            </span>
          )}
        </span>
        <button
          type="button"
          onClick={() => navigate('/quiz')}
          className="text-xs text-content-tertiary hover:text-foreground cursor-pointer"
        >
          {t('run.leave')}
        </button>
      </div>
      {/* 요청한 수를 못 채운 채로 생성이 끝났습니다.
          덱이 작아 카드를 다 썼거나(카드 5장에 5문항, 한 장이 그 유형에 안 맞으면 4문항),
          그 카드들로는 그 유형의 문항을 만들 수 없을 때입니다. 예전에는 이 상태에서 조회만
          4초마다 끝없이 돌고 학습자는 아무 설명도 못 받았습니다. */}
      {growth.cameUpShort && (
        <p className="text-xs text-content-tertiary" data-testid="quiz-shortfall">
          {t('run.shortfall', { requested: run?.requested_count ?? 0, made: items.length })}
        </p>
      )}


      <div className="p-4 bg-card rounded-xl border border-border">
        <p className="text-base text-foreground whitespace-pre-wrap">{item.stem}</p>
      </div>

      {/* The verdict, said out loud.
          The report was not "it marks me wrong" — it was that after answering there is only the
          grader's explanation, and a learner cannot tell whether they got it. A coloured border
          on one option is not an answer to "맞았나?". */}
      {answered && (
        <div
          className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium ${
            outcome === 'correct' ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
              : outcome === 'partial' ? 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400'
                : outcome === 'wrong' ? 'border-destructive/40 bg-destructive/10 text-destructive'
                  : 'border-border bg-card text-muted-foreground'
          }`}
          role="status"
          data-testid="quiz-verdict"
          data-outcome={outcome}
        >
          <span aria-hidden="true">
            {outcome === 'correct' ? '\u2713' : outcome === 'wrong' ? '\u2715' : outcome === 'partial' ? '\u2248' : '\u2026'}
          </span>
          {t(`run.verdict.${outcome === 'unanswered' ? 'ungraded' : outcome}`)}
        </div>
      )}

      {item.question_type === 'mcq' && item.options && (
        <ul className="space-y-2">
          {item.options.map((option, optionIndex) => {
            const isCorrect = answered && result?.correct_display_index === optionIndex
            const isPicked = choice === optionIndex
            // Only after answering, and only from a closed label set the model chose from —
            // never model prose. Aligned with the shuffle by `get_quiz_run_items` (mig 203);
            // before that fix these would have named the wrong option.
            const flaw = answered && !isCorrect ? flaws[optionIndex] : null
            return (
              <li key={optionIndex}>
                <button
                  type="button"
                  disabled={answered}
                  onClick={() => setChoice(optionIndex)}
                  // `whitespace-pre-wrap`: an option is card content and card content has line
                  // breaks in it. A math card's answer field holds two formulas on two lines —
                  // `a²+2ab+b²=(a+b)²` and `a²−2ab+b²=(a−b)²` — and HTML collapsed the newline,
                  // so the option read as one run-on string that nobody could parse. The stem
                  // above already does this; the options did not. (Mobile is unaffected: React
                  // Native's <Text> keeps newlines.)
                  className={`w-full text-left px-3 py-2 text-sm rounded-lg border cursor-pointer transition-colors disabled:cursor-default whitespace-pre-wrap ${
                    isCorrect ? 'bg-brand/10 border-brand text-foreground'
                      : isPicked ? 'bg-accent border-brand/40 text-foreground'
                      : 'bg-card border-border text-foreground hover:border-brand/40'
                  }`}
                >
                  {option}
                </button>
                {flaw && (
                  <p className="text-xs text-content-tertiary mt-1 ml-3">
                    {t(`flaw.${flaw}`, { defaultValue: '' })}
                    {/* And, for the option they actually PICKED, what separates it from the
                        answer. Only there: printing all three axes turns the explanation into a
                        wall and buries the one that is about their own mistake. */}
                    {isPicked && axes[optionIndex] && (
                      <span className="ml-1 text-foreground">
                        {t(`mcqAxis.${axes[optionIndex]}`, { defaultValue: '' })}
                      </span>
                    )}
                  </p>
                )}
              </li>
            )
          })}
        </ul>
      )}

      {item.question_type !== 'mcq' && (
        <>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            disabled={answered}
            rows={item.question_type === 'essay' ? 8 : 3}
            placeholder={t(`run.placeholder.${item.question_type}`)}
            className="w-full px-3 py-2 text-sm bg-background border border-border rounded-lg text-foreground disabled:opacity-60"
          />
          {/* The server refuses an over-length answer rather than truncating it — correctly,
              since grading the first 2,000 characters of a 4,000-character essay grades
              something the learner did not write. It just never said so until 채점 was pressed,
              and then said "비어 있거나 너무 길어요" for both directions at once. */}
          {!answered && (
            <p
              className={`-mt-1 text-right text-xs tabular-nums ${
                length.state === 'too_long' ? 'text-destructive'
                  : length.state === 'near_limit' ? 'text-amber-600'
                    : 'text-content-tertiary'
              }`}
              data-testid="answer-length"
              data-state={length.state}
            >
              {length.state === 'too_short'
                ? t('run.length.tooShort', { min: length.min })
                : t('run.length.count', { chars: length.count, max: length.max })}
            </p>
          )}
        </>
      )}

      {answered && item.score !== null && (
        <div className="p-3 bg-card rounded-lg border border-border">
          <p className="text-sm text-foreground">
            {/* Percent, matching the result screen. This is a normalised 0–1 score shown
                ×100; calling it "점" made the same 0.1 read as "10점" here and "10%" there. */}
            {t('result.percent', { percent: Math.round((item.score ?? 0) * 100) })}
          </p>
          {item.reference_answer && (
            <p className="text-xs text-content-tertiary mt-1">
              {t('run.reference', { answer: item.reference_answer })}
            </p>
          )}
          {item.model_answer && (
            <div className="mt-2 pt-2 border-t border-border">
              <p className="text-xs font-medium text-content-secondary">{t('run.modelAnswer')}</p>
              <p className="text-sm text-foreground whitespace-pre-wrap mt-0.5">{item.model_answer}</p>
            </div>
          )}
        </div>
      )}

      {answered && item.feedback && (
        <QuizFeedback
          feedback={item.feedback}
          rubric={item.rubric}
          // For multiple choice "what the learner wrote" is the option they picked. The spans
          // were computed against that string server-side, so passing the textarea (always
          // empty here) would silently drop every highlight that was just paid for.
          learnerText={item.question_type === 'mcq' ? (pickedOption ?? '') : text}
          referenceText={item.reference_answer}
        />
      )}

      {/* Was this question any good?
          Every question here is written by a model, and until now nothing could tell us when one
          came out badly — a learner met a broken question, shrugged, and the next generation used
          the same prompt to write the same broken question. 👎 alone records it; the reasons are
          optional, because requiring one adds a second tap and a second tap means nobody takes
          the first. */}
      {/* 채점이 끝난 뒤에만. `answered` 는 제출 직후를 포함하는데, 그때는 아직 점수도 해설도
          없어서 학습자가 평가할 대상이 화면에 없습니다. 객관식은 제출이 곧 채점이라 즉시
          나타나고, 서술형·주관식은 점수가 붙은 다음입니다. */}
      {answered && item.score !== null && (
        <div className="rounded-lg border border-border bg-card p-3" data-testid="quiz-item-rating">
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-content-tertiary">{t('rate.prompt')}</p>
            <div className="flex shrink-0 gap-1.5">
              {(['good', 'bad'] as const).map((verdict) => {
                const chosen = itemRatings[item.item_id]?.verdict === verdict
                return (
                  <button
                    key={verdict}
                    type="button"
                    aria-label={t(`rate.${verdict}`)}
                    aria-pressed={chosen}
                    onClick={() => {
                      void rateItem(item.item_id, verdict)
                      // Reasons only ever follow a 👎 — there is nothing to diagnose about a
                      // question that worked.
                      setReasonsFor(verdict === 'bad' ? item.item_id : null)
                    }}
                    className={`cursor-pointer rounded-lg border px-2.5 py-1 text-sm transition-colors ${
                      chosen ? 'border-brand bg-brand/10 text-brand' : 'border-border text-content-tertiary hover:border-brand/40'
                    }`}
                    data-testid={`quiz-rate-${verdict}`}
                  >
                    {verdict === 'good' ? '👍' : '👎'}
                  </button>
                )
              })}
            </div>
          </div>
          {reasonsFor === item.item_id && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {QUIZ_FEEDBACK_REASONS.map((reason) => {
                const chosen = itemRatings[item.item_id]?.reason === reason
                return (
                  <button
                    key={reason}
                    type="button"
                    onClick={() => void rateItem(item.item_id, 'bad', reason)}
                    className={`cursor-pointer rounded-full border px-2.5 py-0.5 text-xs transition-colors ${
                      chosen ? 'border-brand bg-brand/10 text-brand' : 'border-border text-content-tertiary hover:border-brand/40'
                    }`}
                  >
                    {t(`rate.reason.${reason}`)}
                  </button>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* 정확한 이유가 있으면 그것을 말합니다.
          `AiRefusalNotice` 는 모르는 코드를 전부 "처리하지 못했어요 · 다시 시도"로 뭉갭니다
          (`refusalFrom` 의 default). 그래서 40자 미만이라 채점될 수 없는 답안이 우리 쪽 장애처럼
          보였고, 다시 시도 버튼은 같은 답으로 영원히 실패했습니다. 정확한 문구는 처음부터
          `quiz.json` 의 `error.*` 에 있었는데 이 화면에 닿지 못했을 뿐입니다. */}
      {error && QUIZ_SPECIFIC_ERRORS.has(error) ? (
        <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 p-3">
          <p className="text-sm text-destructive">
            {error === 'QUIZ_UNGRADEABLE'
              ? t('run.length.tooShort', { min: length.min })
              : t(`error.${error}`, { defaultValue: t('error.UNKNOWN') })}
          </p>
        </div>
      ) : (
        <AiRefusalNotice
          code={error}
          actionId="quiz_grade"
          onRetry={() => void requestGrade()}
        />
      )}

      <div className="flex gap-2">
        {!answered ? (
          <button
            type="button"
            onClick={() => void submitAnswer()}
            // 제출이 곧 채점이므로, 채점될 수 없는 길이는 제출도 막습니다. 예전에는 열 글자
            // 서술형도 제출됐다가 채점에서 거절됐고, 화면은 그것을 우리 잘못처럼 말했습니다.
            disabled={item.question_type === 'mcq'
              ? choice === null
              : text.trim() === '' || length.state === 'too_short' || length.state === 'too_long'}
            className="flex-1 px-3 py-2 text-sm font-medium bg-brand text-white rounded-lg cursor-pointer transition-colors hover:bg-brand-hover disabled:opacity-50"
          >
            {t('run.submit')}
          </button>
        ) : (
          <>
            {/* Grading sits BESIDE moving on, never instead of it.
                It used to replace them, which meant a learner who submitted a short answer
                had exactly two buttons — pay, or leave. There was no 다음 and, on the last
                item, no 마치기, so a run could not be completed without paying to grade every
                single answer. Charging is a choice we offer; it must never be the only exit. */}
            {item.question_type !== 'mcq' && item.score === null && (
              <button
                type="button"
                onClick={() => void requestGrade()}
                disabled={grading || shownPrice === null}
                className="flex-1 px-3 py-2 text-sm font-medium bg-brand text-white rounded-lg cursor-pointer transition-colors hover:bg-brand-hover disabled:opacity-50"
              >
                {/* The price stays off the BUTTON — a button is a decision, not a price tag —
                    and is said in the line below it instead. It used to be said nowhere at all,
                    so a learner tapped this with no idea whether it cost anything. */}
                {grading ? t('run.grading') : t('run.grade')}
              </button>
            )}
            <button
              type="button"
              onClick={() => (isLast ? void finish() : goTo(index + 1))}
              className={`px-3 py-2 text-sm font-medium rounded-lg cursor-pointer transition-colors ${
                item.question_type !== 'mcq' && item.score === null
                  ? 'flex-1 border border-border text-foreground hover:border-brand/40'
                  : 'flex-1 bg-brand text-white hover:bg-brand-hover'
              }`}
            >
              {isLast ? t('run.finish') : t('run.next')}
            </button>
          </>
        )}
      </div>

      {/* What grading this answer costs, or that it is covered. Under the buttons, not on one:
          the learner is choosing whether to spend, and needs the number before they tap. */}
      {item.question_type !== 'mcq' && item.score === null && costLine && (
        <p className="text-xs text-content-tertiary text-center" data-testid="quiz-grade-cost">
          {t(costLine.key, costLine.params)}
        </p>
      )}
    </div>
  )
}
