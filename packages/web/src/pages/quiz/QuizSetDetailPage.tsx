import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  useQuizStore, isDailyCheckTitle,
  type QuizSetRow, type QuizSetHistoryRun,
} from '@reeeeecall/shared/stores/quiz-store'
import {
  dateLine, tallyFromCounts, tallyLine, isRunUnfinished,
} from '@reeeeecall/shared/lib/quiz-outcome'

/**
 * One quiz, on its own page.
 *
 * The history started life as a toggle on the list row, and that was the wrong shape for it. A
 * set is something a learner comes BACK to — it cost money, it has a history, and it is the unit
 * they retake — while a list row is a place to choose one, not to read one. Expanding in place
 * also left the history unreachable by link, so nothing could point at a quiz.
 *
 * Every sitting is listed, and each one links to its own result screen, which is where the
 * answers, the grader's spans and the free override already live. Nothing here re-implements
 * that: this page answers "which sitting", and the result page answers "what happened in it".
 *
 * Counts, never a percentage. `tallyLine` is the same function the run and result screens use, so
 * a sitting cannot read one way here and another there — the alternative was
 * `score_raw / score_max`, the arithmetic that reported 17% for six answers and one paid grade.
 */
export function QuizSetDetailPage() {
  const { t } = useTranslation('quiz')
  const { setId } = useParams<{ setId: string }>()
  const navigate = useNavigate()
  const { loadSet, loadSetHistory, startRun, deleteSet } = useQuizStore()

  const [setRow, setSetRow] = useState<QuizSetRow | null | undefined>(undefined)
  const [runs, setRuns] = useState<QuizSetHistoryRun[]>([])
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!setId) return
    let live = true
    void (async () => {
      // Loaded from the id, not from the list: a deep link, a reload, or arriving straight from
      // a run all skip the list entirely.
      const [row, history] = await Promise.all([
        loadSet(setId).catch(() => null),
        loadSetHistory(setId).catch(() => [] as QuizSetHistoryRun[]),
      ])
      if (!live) return
      setSetRow(row)
      setRuns(history)
    })()
    return () => { live = false }
  }, [setId, loadSet, loadSetHistory])

  const take = async () => {
    if (!setRow) return
    setBusy(true)
    try {
      const runId = await startRun(setRow.id)
      navigate(`/quiz/${runId}/run`)
    } finally { setBusy(false) }
  }

  const remove = async () => {
    if (!setRow) return
    setBusy(true)
    try {
      if (await deleteSet(setRow.id)) navigate('/quiz')
    } finally { setBusy(false) }
  }

  if (setRow === undefined) {
    return <div className="max-w-2xl mx-auto p-8 text-center text-sm text-content-tertiary">{t('run.loading')}</div>
  }
  if (setRow === null) {
    // Deleted from another tab, or a stale link. Saying so beats an error boundary.
    return (
      <div className="max-w-2xl mx-auto p-8 text-center space-y-3">
        <p className="text-sm text-muted-foreground">{t('detail.gone')}</p>
        <Link to="/quiz" className="text-sm text-brand hover:underline">{t('run.backToQuiz')}</Link>
      </div>
    )
  }

  const created = dateLine(setRow.created_at)
  const title = isDailyCheckTitle(setRow.title) ? t('home.dailyCheckTitle') : setRow.title
  const empty = setRow.generated_count === 0

  return (
    <div className="max-w-2xl mx-auto p-4 space-y-4" data-testid="quiz-set-detail">
      <div>
        <Link to="/quiz" className="text-xs text-content-tertiary hover:underline">
          {t('run.backToQuiz')}
        </Link>
        <h1 className="text-lg font-medium text-foreground mt-1">{title}</h1>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-1">
          {setRow.deck_name && (
            <span className="text-xs text-content-tertiary">{setRow.deck_name}</span>
          )}
          <span className="text-xs text-content-tertiary">{t(`type.${setRow.question_type}`)}</span>
          <span className="text-xs text-content-tertiary">
            {t('home.questions', { count: setRow.generated_count })}
          </span>
          {/* Under-delivery, said out loud: dropped items are never charged for, so asking for
              6 and getting 4 is a normal outcome the row cannot otherwise distinguish. */}
          {setRow.generated_count > 0 && setRow.generated_count < setRow.requested_count && (
            <span className="text-xs text-content-tertiary">
              {t('home.fewerThanAsked', { requested: setRow.requested_count })}
            </span>
          )}
          {created && (
            <span className="text-xs text-content-tertiary">
              {t('history.created', { date: t(created.key, created.params) })}
            </span>
          )}
        </div>
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => void take()}
          disabled={busy || empty}
          data-testid="quiz-detail-take"
          className="flex-1 px-3 py-2 text-sm font-medium bg-brand text-white rounded-lg cursor-pointer transition-colors hover:bg-brand-hover disabled:opacity-50"
        >
          {busy ? t('home.starting') : (setRow.run_count ? t('result.retake') : t('home.take'))}
        </button>
        {/* Only while nobody has taken it. Questions, runs and the answers under them all
            cascade from a set, so removing one that has been sat destroys the learner's own
            history — including their 오답 노트 for those cards. */}
        {(setRow.run_count ?? 0) === 0 && (
          <button
            type="button"
            onClick={() => void remove()}
            disabled={busy}
            data-testid="quiz-detail-delete"
            className="px-3 py-2 text-sm font-medium border border-border rounded-lg text-foreground cursor-pointer hover:border-destructive/40 disabled:opacity-50"
          >
            {t('home.remove')}
          </button>
        )}
      </div>

      <div>
        <h2 className="text-sm font-medium text-foreground">{t('detail.historyTitle')}</h2>
        {runs.length === 0 ? (
          <p className="text-xs text-content-tertiary mt-1">{t('history.never')}</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {runs.map((run) => {
              const at = dateLine(run.completed_at ?? run.started_at)
              const line = tallyLine(tallyFromCounts(run.tally))
              return (
                <li key={run.run_id}>
                  {/* Straight to that sitting's result, where the answers, the grader's spans
                      and the free override already are. This page says which; that one says
                      what happened. */}
                  <Link
                    to={`/quiz/${run.run_id}/result`}
                    className="flex items-center justify-between gap-3 p-3 bg-card rounded-lg border border-border no-underline hover:border-brand/40"
                  >
                    <div className="min-w-0">
                      <p className="text-sm text-foreground">
                        {t('history.attempt', {
                          n: run.attempt_no,
                          date: at ? t(at.key, at.params) : '',
                        })}
                      </p>
                      <p className="text-xs text-content-tertiary mt-0.5">
                        {/* `status` stays `in_progress` until `finish_quiz_run` is called and
                            nothing makes a learner call it, so it is believed only when the
                            counts agree. */}
                        {isRunUnfinished(run.status, run.tally)
                          ? t('history.inProgress')
                          : t(line.key, line.params)}
                      </p>
                    </div>
                  </Link>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}
