import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useParams } from 'react-router-dom'
import {
  useQuizStore, QuizError, QUIZ_GRADE_ACTION,
  optionFlaws,
  type QuizRunItem, type QuizSubmitResult, type QuizQuote,
} from '@reeeeecall/shared/stores/quiz-store'
import { QuizFeedback } from './QuizFeedback'
import { AiRefusalNotice } from '../../components/ai/AiRefusalNotice'
import { answerLength } from '@reeeeecall/shared/lib/quiz-answer-limits'
import { itemOutcome, tallyQuiz, tallyLine } from '@reeeeecall/shared/lib/quiz-outcome'
import { gradeCostLine } from '@reeeeecall/shared/lib/quiz-pricing'

/**
 * Taking the quiz. Outside the app Layout, like the study session, so nothing competes with
 * the question.
 *
 * Multiple choice is MARKED the instant it is submitted, in SQL, for free — and that mark is
 * final; no model revises it. What costs money on a multiple-choice item is the EXPLANATION:
 * what the right option and the one they picked differ on, and where in their own card it says
 * so. Short answer and essay buy the mark itself.
 *
 * All three are quoted and confirmed per answer, and none is bought automatically on submit:
 * spending is always a gesture.
 */
export function QuizRunPage() {
  const { t } = useTranslation('quiz')
  const { runId } = useParams<{ runId: string }>()
  const navigate = useNavigate()
  const {
    run, loading, loadRun, refreshRun, submit, gradeWithAi, quote, grading, finishRun,
  } = useQuizStore()

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
  const stillGrowing = !!run && run.item_count < (run.requested_count ?? run.item_count)
  useEffect(() => {
    if (!runId || !stillGrowing) return
    const id = setInterval(() => { void refreshRun(runId) }, 4000)
    return () => clearInterval(id)
  }, [runId, stillGrowing, refreshRun])

  const items = useMemo(() => run?.items ?? [], [run])
  const item: QuizRunItem | undefined = items[index]

  // Re-quote per item: the price depends on the type, and an essay costs four times a short
  // answer. Quoting once for the run would show the wrong number on most of it.
  useEffect(() => {
    // Multiple choice is quoted AFTER answering, not before: its purchase is an explanation of
    // an answer that already exists, so there is nothing to price until one does.
    if (!item) return
    if (item.question_type === 'mcq' ? !item.answered || item.feedback : item.answered) return
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
      if (runId) await loadRun(runId)
    } catch (e) {
      setError(e instanceof QuizError ? e.code : 'UNKNOWN')
    }
  }

  const requestGrade = async () => {
    if (!item || shownPrice === null) return
    setError(null)
    try {
      // Multiple choice sends no text — the server reads the submitted choice from the attempt
      // it already stored, which is the copy the mark was computed from.
      await gradeWithAi(item.item_id, item.question_type === 'mcq' ? '' : text.trim(), shownPrice)
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

      <AiRefusalNotice
        code={error}
        actionId="quiz_grade"
        onRetry={() => void requestGrade()}
      />

      <div className="flex gap-2">
        {!answered ? (
          <button
            type="button"
            onClick={() => void submitAnswer()}
            disabled={item.question_type === 'mcq' ? choice === null : text.trim() === ''}
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
            {/* Multiple choice qualifies once it is answered and has no explanation yet; the
                other two once they are answered and unscored. Both are "there is something left
                to buy for this item", which is the only condition that should show a price. */}
            {(item.question_type === 'mcq' ? !item.feedback : item.score === null) && (
              <button
                type="button"
                onClick={() => void requestGrade()}
                disabled={grading || shownPrice === null}
                className="flex-1 px-3 py-2 text-sm font-medium bg-brand text-white rounded-lg cursor-pointer transition-colors hover:bg-brand-hover disabled:opacity-50"
              >
                {/* The price stays off the BUTTON — a button is a decision, not a price tag —
                    and is said in the line below it instead. It used to be said nowhere at all,
                    so a learner tapped this with no idea whether it cost anything. */}
                {grading
                  ? t(item.question_type === 'mcq' ? 'run.explaining' : 'run.grading')
                  : t(item.question_type === 'mcq' ? 'run.explain' : 'run.grade')}
              </button>
            )}
            <button
              type="button"
              onClick={() => (isLast ? void finish() : goTo(index + 1))}
              className={`px-3 py-2 text-sm font-medium rounded-lg cursor-pointer transition-colors ${
                (item.question_type === 'mcq' ? !item.feedback : item.score === null)
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
      {(item.question_type === 'mcq' ? !item.feedback : item.score === null) && costLine && (
        <p className="text-xs text-content-tertiary text-center" data-testid="quiz-grade-cost">
          {t(costLine.key, costLine.params)}
        </p>
      )}
    </div>
  )
}
