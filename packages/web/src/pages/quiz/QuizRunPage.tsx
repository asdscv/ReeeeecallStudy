import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useParams } from 'react-router-dom'
import {
  useQuizStore, QuizError, QUIZ_GRADE_ACTION,
  optionFlaws,
  type QuizRunItem, type QuizSubmitResult,
} from '@reeeeecall/shared/stores/quiz-store'
import { QuizFeedback } from './QuizFeedback'
import { AiRefusalNotice } from '../../components/ai/AiRefusalNotice'
import { answerLength } from '@reeeeecall/shared/lib/quiz-answer-limits'

/**
 * Taking the quiz. Outside the app Layout, like the study session, so nothing competes with
 * the question.
 *
 * Multiple choice is graded the instant it is submitted, in SQL, for free. Short answer and
 * essay cost money to grade, so they are quoted and confirmed per answer — which is also why
 * they are not graded automatically on submit: spending is always a gesture.
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
  const [gradePrice, setGradePrice] = useState<{ itemId: string; micro: number } | null>(null)
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
    if (!item || item.question_type === 'mcq' || item.answered) return
    const itemId = item.item_id
    let cancelled = false
    void quote(QUIZ_GRADE_ACTION[item.question_type], 1)
      .then((q) => { if (!cancelled) setGradePrice({ itemId, micro: q.price_micro }) })
      .catch(() => { if (!cancelled) setGradePrice(null) })
    return () => { cancelled = true }
  }, [item, quote])

  const shownPrice = item && gradePrice?.itemId === item.item_id ? gradePrice.micro : null

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
  const isLast = index === items.length - 1
  /** Live length against the bound the SERVER will apply. Mirrored, and pinned by a test. */
  const length = answerLength(text, item?.question_type === 'essay' ? 'essay' : 'short')

  return (
    <div className="max-w-2xl mx-auto p-4 space-y-4 min-h-screen">
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs text-content-tertiary">
          {t('run.progress', { current: index + 1, total: items.length })}
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
                  className={`w-full text-left px-3 py-2 text-sm rounded-lg border cursor-pointer transition-colors disabled:cursor-default ${
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
          learnerText={text}
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
            {item.question_type !== 'mcq' && item.score === null && (
              <button
                type="button"
                onClick={() => void requestGrade()}
                disabled={grading || shownPrice === null}
                className="flex-1 px-3 py-2 text-sm font-medium bg-brand text-white rounded-lg cursor-pointer transition-colors hover:bg-brand-hover disabled:opacity-50"
              >
                {/* The price is no longer on the button. The QUOTE still runs and still
                    authorises the spend through `maxPriceMicro`; only the announcement is
                    gone. */}
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
    </div>
  )
}
