import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useParams } from 'react-router-dom'
import { useQuizStore, type QuizRunItem } from '@reeeeecall/shared/stores/quiz-store'
import { QuizFeedback } from './QuizFeedback'

/**
 * What the sitting came to, and the one control that matters: the learner can overrule any
 * AI grade, in either direction, for free.
 *
 * That override is not a courtesy. An AI grade a learner cannot contest is worse than no
 * grade — they are told they are wrong, about their own card, with no recourse. Charging for
 * the correction would make it a second sale on a failure we caused, so it is free; offering
 * it in both directions is what keeps it a judgement rather than an appeals window that only
 * ever inflates scores.
 */
export function QuizResultPage() {
  const { t } = useTranslation('quiz')
  const { runId } = useParams<{ runId: string }>()
  const navigate = useNavigate()
  const { run, loadRun, override, startRun } = useQuizStore()
  const [busy, setBusy] = useState<string | null>(null)

  useEffect(() => { if (runId) void loadRun(runId) }, [runId, loadRun])

  const retake = async () => {
    if (!run) return
    // Free, always: the questions are the asset, and a set that costs money every sitting
    // would never become a habit.
    const newRunId = await startRun(run.set_id)
    navigate(`/quiz/${newRunId}/run`)
  }

  const flip = async (item: QuizRunItem, score: number) => {
    setBusy(item.item_id)
    try { await override(item.item_id, score) } finally { setBusy(null) }
  }

  if (!run) {
    return <div className="max-w-2xl mx-auto p-8 text-center text-sm text-content-tertiary">{t('run.loading')}</div>
  }

  // Over what was GRADED, not over what was asked. A learner who answered six short-answer
  // questions and paid to grade none of them was being shown "0%" and "0 of 6" — a total
  // failure they did not earn, on a run where nothing had been judged at all.
  const graded = run.items.filter((i) => i.score !== null).length
  const percent = run.score_max > 0 ? Math.round((run.score_raw / run.score_max) * 100) : 0

  return (
    <div className="max-w-2xl mx-auto p-4 space-y-4">
      <div className="p-4 bg-card rounded-xl border border-border text-center">
        <p className="text-2xl font-medium text-foreground">
          {graded === 0 ? t('result.nothingGraded') : t('result.percent', { percent })}
        </p>
        <p className="text-xs text-content-tertiary mt-1">
          {/* Whole questions, not a decimal: partial credit exists on essays, but "4.3 of 6"
              reads as a rounding artefact rather than as a score. */}
          {graded === 0
            ? t('result.nothingGradedBody')
            : t('result.of', { raw: Math.round(run.score_raw), max: run.score_max })}
        </p>
        <p className="text-xs text-content-tertiary mt-0.5">
          {t('result.attempt', { count: run.attempt_no })}
        </p>
      </div>

      <ul className="space-y-2">
        {run.items.map((item, i) => (
          <li key={item.item_id} className="p-3 bg-card rounded-lg border border-border">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs text-content-tertiary">{t('result.item', { n: i + 1 })}</p>
                <p className="text-sm text-foreground mt-0.5 line-clamp-2">{item.stem}</p>
                {item.reference_answer && (
                  <p className="text-xs text-content-tertiary mt-1">
                    {t('run.reference', { answer: item.reference_answer })}
                  </p>
                )}
              </div>
              <span className="text-sm font-medium text-foreground shrink-0">
                {item.score === null ? t('result.ungraded') : `${Math.round(item.score * 100)}%`}
              </span>
            </div>

            {item.feedback && (
              <div className="mt-2">
                <QuizFeedback
                  feedback={item.feedback}
                  rubric={item.rubric}
                  referenceText={item.reference_answer}
                />
              </div>
            )}

            {/* `answered`, not `score !== null`. An ungraded answer is exactly the case where
                the learner most needs to mark it themselves — they chose not to pay for the
                grade, and without this the run has no score and no way to get one. */}
            {item.answered && (
              <div className="flex gap-2 mt-2">
                <button
                  type="button"
                  disabled={busy === item.item_id || item.score === 1}
                  onClick={() => void flip(item, 1)}
                  className="px-2 py-1 text-xs rounded border border-border text-foreground cursor-pointer hover:border-brand/40 disabled:opacity-40"
                >
                  {t('result.markCorrect')}
                </button>
                <button
                  type="button"
                  disabled={busy === item.item_id || item.score === 0}
                  onClick={() => void flip(item, 0)}
                  className="px-2 py-1 text-xs rounded border border-border text-foreground cursor-pointer hover:border-brand/40 disabled:opacity-40"
                >
                  {t('result.markWrong')}
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => void retake()}
          className="flex-1 px-3 py-2 text-sm font-medium bg-brand text-white rounded-lg cursor-pointer transition-colors hover:bg-brand-hover"
        >
          {t('result.retake')}
        </button>
        <button
          type="button"
          onClick={() => navigate('/quiz')}
          className="px-3 py-2 text-sm font-medium border border-border rounded-lg text-foreground cursor-pointer hover:border-brand/40"
        >
          {t('run.backToQuiz')}
        </button>
      </div>
    </div>
  )
}
