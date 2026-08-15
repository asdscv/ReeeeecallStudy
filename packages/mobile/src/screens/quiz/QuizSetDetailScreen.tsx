import { useCallback, useEffect, useState } from 'react'
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native'
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { useTranslation } from 'react-i18next'
import {
  useQuizStore, isDailyCheckTitle,
  type QuizSetRow, type QuizSetHistoryRun,
} from '@reeeeecall/shared/stores/quiz-store'
import {
  dateLine, tallyFromCounts, tallyLine, isRunUnfinished,
} from '@reeeeecall/shared/lib/quiz-outcome'
import { retakeNoteKey } from '@reeeeecall/shared/lib/quiz-pricing'
import { Screen, Button, ScreenHeader } from '../../components/ui'
import { testProps } from '../../utils/testProps'
import { useTheme } from '../../theme'
import type { QuizStackParamList } from '../../navigation/types'

type Nav = NativeStackNavigationProp<QuizStackParamList, 'QuizSetDetail'>
type Rt = RouteProp<QuizStackParamList, 'QuizSetDetail'>

/**
 * One quiz, on its own screen.
 *
 * The history started as a toggle on the list row and that was the wrong shape for it: a set is
 * something a learner comes BACK to — it cost money, it has a history, it is the unit they retake
 * — while a list row is a place to choose one, not to read one.
 *
 * Every sitting links to its own result screen, where the answers, the grader's spans and the
 * free override already live. This screen answers "which sitting"; that one answers "what
 * happened in it".
 */
export function QuizSetDetailScreen() {
  const theme = useTheme()
  const { t } = useTranslation('quiz')
  const navigation = useNavigation<Nav>()
  const { setId } = useRoute<Rt>().params
  const { loadSet, loadSetHistory, startRun, deleteSet } = useQuizStore()

  const [setRow, setSetRow] = useState<QuizSetRow | null | undefined>(undefined)
  const [runs, setRuns] = useState<QuizSetHistoryRun[]>([])
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let live = true
    void (async () => {
      // From the id, not from the list: arriving here from a run, or after a reload, skips it.
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

  const take = useCallback(async () => {
    if (!setRow) return
    setBusy(true)
    try {
      const runId = await startRun(setRow.id)
      navigation.navigate('QuizRun', { runId })
    } finally { setBusy(false) }
  }, [setRow, startRun, navigation])

  const remove = useCallback(async () => {
    if (!setRow) return
    setBusy(true)
    try {
      if (await deleteSet(setRow.id)) navigation.goBack()
    } finally { setBusy(false) }
  }, [setRow, deleteSet, navigation])

  const caption = { ...theme.typography.caption, color: theme.colors.textSecondary }

  if (setRow === undefined) {
    return (
      <Screen>
        <ScreenHeader title={t('home.title')} mode="back" onBack={() => navigation.goBack()} />
        <Text style={[caption, { padding: 16 }]}>{t('run.loading')}</Text>
      </Screen>
    )
  }
  if (setRow === null) {
    // Deleted from another device, or a stale push. Saying so beats a blank screen.
    return (
      <Screen>
        <ScreenHeader title={t('home.title')} mode="back" onBack={() => navigation.goBack()} />
        <Text style={[caption, { padding: 16 }]}>{t('detail.gone')}</Text>
      </Screen>
    )
  }

  const created = dateLine(setRow.created_at)
  const title = isDailyCheckTitle(setRow.title) ? t('home.dailyCheckTitle') : setRow.title
  const meta = [
    setRow.deck_name,
    t(`type.${setRow.question_type}`),
    t('home.questions', { count: setRow.generated_count }),
    created ? t('history.created', { date: t(created.key, created.params) }) : null,
  ].filter(Boolean).join(' · ')

  return (
    <Screen>
      <ScreenHeader title={title} mode="back" onBack={() => navigation.goBack()} />
      <ScrollView contentContainerStyle={styles.body} {...testProps('quiz-set-detail')}>
        <Text style={caption}>{meta}</Text>
        {/* Under-delivery, said out loud: dropped items are never charged for, so asking for 6
            and getting 4 is a normal outcome the row cannot otherwise distinguish. */}
        {setRow.generated_count > 0 && setRow.generated_count < setRow.requested_count && (
          <Text style={caption}>{t('home.fewerThanAsked', { requested: setRow.requested_count })}</Text>
        )}

        <Button
          title={busy ? t('home.starting') : (setRow.run_count ? t('result.retake') : t('home.take'))}
          onPress={() => void take()}
          disabled={busy || setRow.generated_count === 0}
          {...testProps('quiz-detail-take')}
        />
        {/* Only while nobody has taken it. Questions, runs and the answers under them all
            cascade from a set, so removing one that has been sat destroys the learner's own
            history — their 오답 노트 for those cards included. */}
        {(setRow.run_count ?? 0) === 0 && (
          <Pressable
            onPress={() => void remove()}
            disabled={busy}
            style={[styles.remove, { borderColor: theme.colors.border }]}
            {...testProps('quiz-detail-delete')}
          >
            <Text style={[theme.typography.label, { color: theme.colors.text }]}>
              {t('home.remove')}
            </Text>
          </Pressable>
        )}

        {/* The first thing anyone wonders on seeing 다시 풀기: are these the same questions, and
            does it cost anything. Both, in one line, before they tap. Multiple choice says
            something different because it genuinely IS free end to end. */}
        {setRow.generated_count > 0 && (
          <Text style={caption} {...testProps('quiz-retake-note')}>
            {t(retakeNoteKey(setRow.question_type))}
          </Text>
        )}

        <Text style={[theme.typography.label, { color: theme.colors.text, marginTop: 8 }]}>
          {t('detail.historyTitle')}
        </Text>
        {runs.length === 0 ? (
          <Text style={caption}>{t('history.never')}</Text>
        ) : runs.map((run) => {
          const at = dateLine(run.completed_at ?? run.started_at)
          const line = tallyLine(tallyFromCounts(run.tally))
          return (
            // Straight to that sitting's result, where the answers and the grader's spans are.
            <Pressable
              key={run.run_id}
              onPress={() => navigation.navigate('QuizResult', { runId: run.run_id })}
              style={[styles.run, {
                backgroundColor: theme.colors.surfaceElevated, borderColor: theme.colors.border,
              }]}
              {...testProps(`quiz-detail-run-${run.attempt_no}`)}
            >
              <Text style={[theme.typography.body, { color: theme.colors.text }]}>
                {t('history.attempt', { n: run.attempt_no, date: at ? t(at.key, at.params) : '' })}
              </Text>
              <Text style={caption}>
                {/* `status` stays `in_progress` until `finish_quiz_run` is called and nothing
                    makes a learner call it, so it is believed only when the counts agree. */}
                {isRunUnfinished(run.status, run.tally)
                  ? t('history.inProgress')
                  : t(line.key, line.params)}
              </Text>
            </Pressable>
          )
        })}
      </ScrollView>
    </Screen>
  )
}

const styles = StyleSheet.create({
  body: { padding: 16, gap: 10, paddingBottom: 32 },
  remove: { paddingVertical: 10, borderRadius: 8, borderWidth: 1, alignItems: 'center' },
  run: { padding: 12, borderRadius: 12, borderWidth: 1, gap: 2 },
})
