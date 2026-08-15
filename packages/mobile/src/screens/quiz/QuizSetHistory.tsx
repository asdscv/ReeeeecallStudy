import { useCallback, useState } from 'react'
import { View, Text, Pressable } from 'react-native'
import { useTranslation } from 'react-i18next'
import {
  useQuizStore, type QuizSetRow, type QuizSetHistoryRun,
} from '@reeeeecall/shared/stores/quiz-store'
import {
  dateLine, tallyFromCounts, tallyLine, isRunUnfinished,
} from '@reeeeecall/shared/lib/quiz-outcome'
import { testProps } from '../../utils/testProps'
import { useTheme } from '../../theme'

/**
 * When a set was made, whether it has ever been taken, and how each sitting went.
 *
 * The row used to read `제목 / 객관식 · 10문항` and stop — a learner could not tell yesterday's
 * set from March's, nor one they had sat three times from one they had never opened.
 *
 * Counts, never a percentage: `tallyLine` is the same function the run and result screens use, so
 * a sitting cannot read one way here and another there.
 *
 * Dates are assembled from parts and ORDERED by the locale files. `toLocaleDateString` is not an
 * option here — Hermes ships without ICU, so it returns the same English on every device whatever
 * the app's language, which is the defect the plan week strip already documents.
 */
export function QuizSetHistory({ setRow }: { setRow: QuizSetRow }) {
  const { t } = useTranslation('quiz')
  const theme = useTheme()
  const { loadSetHistory } = useQuizStore()
  const [runs, setRuns] = useState<QuizSetHistoryRun[] | null>(null)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  const created = dateLine(setRow.created_at)
  const lastAt = setRow.last_taken_at ? dateLine(setRow.last_taken_at) : null
  const runCount = setRow.run_count ?? 0

  const toggle = useCallback(async () => {
    if (open) { setOpen(false); return }
    setOpen(true)
    // Fetched once, and only when asked. The collapsed row already carries the last sitting.
    if (runs === null) {
      setBusy(true)
      try { setRuns(await loadSetHistory(setRow.id)) } catch { setRuns([]) } finally { setBusy(false) }
    }
  }, [open, runs, loadSetHistory, setRow.id])

  const caption = { ...theme.typography.caption, color: theme.colors.textSecondary }

  return (
    <View style={{ gap: 2 }} {...testProps('quiz-set-history')}>
      {created && (
        <Text style={caption}>
          {t('history.created', { date: t(created.key, created.params) })}
        </Text>
      )}
      {runCount === 0 ? (
        <Text style={caption}>{t('history.never')}</Text>
      ) : (
        <>
          <Text style={caption}>
            {t('history.taken', { runs: runCount, date: lastAt ? t(lastAt.key, lastAt.params) : '' })}
          </Text>
          {/* The last sitting, on the collapsed row: "3번 풀었어요" without an outcome is a
              fact nobody can act on. */}
          {setRow.last_tally && (
            <Text style={caption}>
              {(() => {
                const line = tallyLine(tallyFromCounts(setRow.last_tally))
                return t(line.key, line.params)
              })()}
            </Text>
          )}
          <Pressable onPress={() => void toggle()} {...testProps(`quiz-history-toggle-${setRow.id}`)}>
            <Text style={[theme.typography.caption, { color: theme.colors.primary }]}>
              {open ? t('history.hide') : t('history.show')}
            </Text>
          </Pressable>
        </>
      )}

      {open && busy && <Text style={caption}>{t('run.loading')}</Text>}
      {open && runs?.map((run) => {
        const at = dateLine(run.completed_at ?? run.started_at)
        const line = tallyLine(tallyFromCounts(run.tally))
        return (
          <Text key={run.run_id} style={caption}>
            {t('history.attempt', { n: run.attempt_no, date: at ? t(at.key, at.params) : '' })}
            {' · '}
            {/* Only when it is genuinely unfinished. `status` stays `in_progress` until
                `finish_quiz_run` is called and nothing makes a learner call it, so a run with
                every answer in was reporting "진행 중" instead of its result. */}
            {isRunUnfinished(run.status, run.tally)
              ? t('history.inProgress')
              : t(line.key, line.params)}
          </Text>
        )
      })}
    </View>
  )
}
