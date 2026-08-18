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
import { retakeNoteKey } from '@reeeeecall/shared/lib/quiz-pricing'
import { Button } from '../../components/ui/button'
import { Trash2 } from 'lucide-react'

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

  /**
   * Delete, after saying what goes with it.
   *
   * Since mig 231 a set that HAS been taken can be deleted too, and the cascade takes the
   * sittings, the answers in them and their 오답 노트 entries. That used to be a refusal the
   * learner could not get past; a refusal is not a safeguard, it is a dead end. The safeguard is
   * telling them what they are agreeing to, in the sentence that asks.
   */
  const remove = async () => {
    if (!setRow) return
    const runs = setRow.run_count ?? 0
    const ok = window.confirm(
      `${t('home.confirmTitle')}\n\n`
      + (runs > 0 ? t('home.confirmTaken', { runs }) : t('home.confirmUnused')),
    )
    if (!ok) return
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

      {/* 이 페이지가 존재하는 이유는 하나입니다: 이 퀴즈를 푼다.
          그 버튼을 폭 전체로 두는 것은 맞습니다. 틀렸던 것은 그 옆에 삭제를 붙여 놓은 것입니다 —
          한 줄에 나란히 놓으면 파괴적인 동작이 주된 동작의 나머지 절반처럼 보이고, 실제로 화면
          오른쪽 끝에 끼인 아이콘이 됐습니다. 주된 동작과 파괴적인 동작은 한 컨트롤의 두 쪽이
          아닙니다. 삭제는 페이지 맨 아래로 내렸습니다. */}
      <Button
        onClick={() => void take()}
        disabled={busy || empty}
        data-testid="quiz-detail-take"
        className="w-full"
      >
        {busy ? t('home.starting') : (setRow.run_count ? t('result.retake') : t('home.take'))}
      </Button>

      {/* The first thing anyone wonders on seeing 다시 풀기: are these the same questions, and
          does it cost anything. Both, in one line, before they tap. Multiple choice says
          something different because it genuinely IS free end to end. */}
      {!empty && (
        <p className="text-xs text-content-tertiary" data-testid="quiz-retake-note">
          {t(retakeNoteKey(setRow.question_type))}
        </p>
      )}

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

      {/* 삭제는 여기, 페이지 끝. 231 이후로 어떤 세트든 지울 수 있고, 확인창이 무엇이 함께
          사라지는지 이름을 댑니다. 찾을 수 있으면 되고, 이 페이지가 하려는 일과 자리를 다툴
          이유는 없습니다. */}
      <div className="border-t border-border pt-4">
        <Button
          variant="ghost"
          onClick={() => void remove()}
          disabled={busy}
          data-testid="quiz-detail-delete"
          className="text-content-tertiary hover:text-destructive hover:bg-destructive/10"
        >
          <Trash2 className="w-4 h-4 mr-1.5" />
          {t('home.remove')}
        </Button>
      </div>
    </div>
  )
}
