import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  useQuizStore, type QuizSetRow, type QuizSetHistoryRun,
} from '@reeeeecall/shared/stores/quiz-store'
import {
  dateLine, tallyFromCounts, tallyLine, isRunUnfinished,
} from '@reeeeecall/shared/lib/quiz-outcome'

/**
 * When a set was made, whether it has ever been taken, and how each sitting went.
 *
 * The row used to read `제목 / 객관식 · 10문항` and stop. A learner with a dozen sets could not
 * tell yesterday's from March's, could not tell one they had sat three times from one they had
 * never opened, and could not see how any of it went. `created_at` was already being fetched and
 * thrown away; the rest was in `quiz_runs` and `answer_attempts` and nobody asked for it.
 *
 * Counts, never a percentage — `tallyLine` is the same function the run and result screens use,
 * so a sitting cannot read one way here and another there. The alternative was `score_raw /
 * score_max`, which is the arithmetic that reported 17% for six answers and one paid grade.
 *
 * Dates are assembled from parts through the locale files rather than `toLocaleDateString`,
 * because the mobile twin of this component runs on Hermes, which has no ICU and would print the
 * same English on every device.
 */
export function QuizSetHistory({ setRow }: { setRow: QuizSetRow }) {
  const { t } = useTranslation('quiz')
  const { loadSetHistory } = useQuizStore()
  const [runs, setRuns] = useState<QuizSetHistoryRun[] | null>(null)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  const created = dateLine(setRow.created_at)
  const lastAt = setRow.last_taken_at ? dateLine(setRow.last_taken_at) : null
  const runCount = setRow.run_count ?? 0

  const toggle = async () => {
    if (open) { setOpen(false); return }
    setOpen(true)
    // Fetched once, and only when asked. The collapsed row already has the last sitting.
    if (runs === null) {
      setBusy(true)
      try { setRuns(await loadSetHistory(setRow.id)) } catch { setRuns([]) } finally { setBusy(false) }
    }
  }

  return (
    <div className="mt-1" data-testid="quiz-set-history">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
        {created && (
          <span className="text-xs text-content-tertiary">
            {t('history.created', { date: t(created.key, created.params) })}
          </span>
        )}
        {runCount === 0 ? (
          <span className="text-xs text-content-tertiary">{t('history.never')}</span>
        ) : (
          <>
            <span className="text-xs text-content-tertiary">
              {t('history.taken', {
                runs: runCount,
                date: lastAt ? t(lastAt.key, lastAt.params) : '',
              })}
            </span>
            <button
              type="button"
              onClick={() => void toggle()}
              className="text-xs text-brand cursor-pointer hover:underline"
              data-testid="quiz-set-history-toggle"
            >
              {open ? t('history.hide') : t('history.show')}
            </button>
          </>
        )}
      </div>

      {/* The last sitting, on the collapsed row, because "3번 풀었어요" without an outcome is
          a fact nobody can act on. */}
      {runCount > 0 && setRow.last_tally && (
        <p className="text-xs text-content-tertiary">
          {(() => {
            const line = tallyLine(tallyFromCounts(setRow.last_tally))
            return t(line.key, line.params)
          })()}
        </p>
      )}

      {open && (
        <ul className="mt-1 space-y-0.5">
          {busy && <li className="text-xs text-content-tertiary">{t('run.loading')}</li>}
          {runs?.map((run) => {
            const at = dateLine(run.completed_at ?? run.started_at)
            const line = tallyLine(tallyFromCounts(run.tally))
            return (
              <li key={run.run_id} className="text-xs text-content-tertiary">
                {t('history.attempt', {
                  n: run.attempt_no,
                  date: at ? t(at.key, at.params) : '',
                })}
                {' · '}
                {/* Only when it is genuinely unfinished. `status` stays `in_progress` until
                    `finish_quiz_run` is called and nothing makes a learner call it, so a run
                    with every answer in was reporting "진행 중" instead of its result. */}
                {isRunUnfinished(run.status, run.tally)
                  ? t('history.inProgress')
                  : t(line.key, line.params)}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
