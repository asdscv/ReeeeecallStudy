import { useEffect, useMemo, useRef, useState } from 'react'
import {
  View, Text, StyleSheet, ScrollView, Pressable, TextInput, KeyboardAvoidingView, Platform,
} from 'react-native'
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { useTranslation } from 'react-i18next'
import {
  useQuizStore, QuizError, QUIZ_GRADE_ACTION, type QuizSubmitResult, type QuizQuote,
  optionFlaws,
} from '@reeeeecall/shared/stores/quiz-store'
import { Screen, Button, EmptyState } from '../../components/ui'
import { testProps } from '../../utils/testProps'
import { useTheme } from '../../theme'
import { AiRefusalNotice } from '../../components/ai/AiRefusalNotice'
import { answerLength } from '@reeeeecall/shared/lib/quiz-answer-limits'
import { itemOutcome, tallyQuiz, tallyLine } from '@reeeeecall/shared/lib/quiz-outcome'
import { QuizFeedback } from './QuizFeedback'
import type { QuizStackParamList } from '../../navigation/types'
import { gradeCostLine } from '@reeeeecall/shared/lib/quiz-pricing'

type Nav = NativeStackNavigationProp<QuizStackParamList, 'QuizRun'>
type Rt = RouteProp<QuizStackParamList, 'QuizRun'>

/**
 * Taking the quiz on a phone.
 *
 * Multiple choice grades itself the moment it is submitted, in SQL, free. Short answer and
 * essay cost money, so grading is a separate, priced button rather than something that happens
 * to the learner — spending is always a gesture.
 *
 * Typed answers are held per item in a ref, so moving between questions never loses text. That
 * covers the realistic loss: a learner drafting an essay, tapping back to re-read question two,
 * and returning. It does NOT survive the app being killed — that needs a storage dependency this
 * package does not have, and it is stated here rather than implied by silence.
 */
export function QuizRunScreen() {
  const theme = useTheme()
  const { t } = useTranslation('quiz')
  const navigation = useNavigation<Nav>()
  const { runId } = useRoute<Rt>().params
  const {
    run, loading, loadRun, refreshRun, submit, gradeWithAi, quote, grading, finishRun,
  } = useQuizStore()

  const [index, setIndex] = useState(0)
  const [choice, setChoice] = useState<number | null>(null)
  const [text, setText] = useState('')
  const [result, setResult] = useState<QuizSubmitResult | null>(null)
  // Keyed by item: an essay costs four times a short answer, so an unkeyed price would quote
  // the previous question's on this one — and clearing it in the effect is a cascading render.
  // The whole quote, not just the price. The screen has to say whether this grading is covered
  // by the free allowance or charged, and only the server knows how much of it the free units
  // cover.
  const [gradeQuote, setGradeQuote] = useState<{ itemId: string; quote: QuizQuote } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const drafts = useRef<Record<string, string>>({})
  const startedAt = useRef(Date.now())

  useEffect(() => { void loadRun(runId) }, [runId, loadRun])

  /**
   * A long quiz is still being written while its first questions are answered.
   *
   * `start_quiz_run` snapshots, so the run holds only what existed when it opened. Polled
   * while the set is short of what was asked for, and stopped the moment it is complete —
   * an idle timer on a finished quiz is pure battery.
   */
  const stillGrowing = !!run && run.item_count < (run.requested_count ?? run.item_count)
  useEffect(() => {
    if (!stillGrowing) return
    const id = setInterval(() => { void refreshRun(runId) }, 4000)
    return () => clearInterval(id)
  }, [runId, stillGrowing, refreshRun])

  const items = useMemo(() => run?.items ?? [], [run])
  const item = items[index]

  // Re-quoted per item: an essay costs four times a short answer, so one quote for the whole
  // run would show the wrong number on most of it.
  useEffect(() => {
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
    if (item) drafts.current[item.item_id] = text
    const nextItem = items[next]
    setIndex(next)
    setChoice(null)
    setText(nextItem ? (drafts.current[nextItem.item_id] ?? '') : '')
    setResult(null)
    setError(null)
    startedAt.current = Date.now()
  }

  const submitAnswer = async () => {
    if (!item) return
    setError(null)
    try {
      const payload = item.question_type === 'mcq' ? { choice } : { text: text.trim() }
      const submitted = await submit(item.item_id, payload as Record<string, unknown>, Date.now() - startedAt.current)
      setResult(submitted)
      await loadRun(runId)
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
      setError(e instanceof QuizError ? e.code : 'UNKNOWN')
    }
  }

  const finish = async () => {
    await finishRun(runId)
    navigation.replace('QuizResult', { runId })
  }

  if (loading && !run) {
    return <Screen><Text style={[theme.typography.body, styles.center, { color: theme.colors.textSecondary }]}>{t('run.loading')}</Text></Screen>
  }
  if (!run || items.length === 0) {
    // Every question can be cascaded away by card deletion. An empty run is a real state.
    return (
      <Screen>
        <EmptyState
          title={t('run.empty')}
          actionTitle={t('run.backToQuiz')}
          onAction={() => navigation.navigate('QuizHome')}
        />
      </Screen>
    )
  }
  if (!item) return null

  /** Live length against the bound the SERVER applies. Mirrored, and pinned by a test. */

  const length = answerLength(text, item?.question_type === 'essay' ? 'essay' : 'short')

  const answered = item.answered || result !== null
  /** This item's verdict, and the run so far. Counts, never a ratio — see quiz-outcome.ts. */
  const outcome = item ? itemOutcome({ answered, score: item.score }) : 'unanswered'
  const tally = tallyQuiz(items.map((i) => ({ answered: i.answered, score: i.score })))
  const tallyText = tallyLine(tally)
  const flaws = optionFlaws(item)
  const isLast = index === items.length - 1

  return (
    <Screen>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.topBar}>
          <Text style={[theme.typography.caption, { color: theme.colors.textSecondary }]}>
            {t('run.progress', { current: index + 1, total: items.length })}
            {tally.judged + tally.ungraded > 0 ? '  ' + t(tallyText.key, tallyText.params) : ''}
          </Text>
          <Pressable onPress={() => navigation.navigate('QuizHome')} {...testProps('quiz-leave')}>
            <Text style={[theme.typography.caption, { color: theme.colors.textSecondary }]}>{t('run.leave')}</Text>
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={styles.body}>
          <View style={[styles.stem, { backgroundColor: theme.colors.surfaceElevated, borderColor: theme.colors.border }]}>
            <Text style={[theme.typography.body, { color: theme.colors.text }]}>{item.stem}</Text>
          </View>

          {item.question_type === 'mcq' && item.options?.map((option, optionIndex) => {
            const isCorrect = answered && result?.correct_display_index === optionIndex
            const isPicked = choice === optionIndex
            // Only after answering, and only a closed label the model chose from — never
            // model prose. Aligned with the shuffle by `get_quiz_run_items` (mig 203).
            const flaw = answered && !isCorrect ? flaws[optionIndex] : null
            return (
              <View key={optionIndex}>
              <Pressable
                disabled={answered}
                onPress={() => setChoice(optionIndex)}
                style={[styles.option, {
                  borderColor: isCorrect ? theme.colors.primary : isPicked ? theme.colors.primary : theme.colors.border,
                  backgroundColor: isCorrect || isPicked ? theme.colors.surfaceElevated : 'transparent',
                }]}
                {...testProps(`quiz-option-${optionIndex}`)}
              >
                <Text style={[theme.typography.body, { color: theme.colors.text }]}>{option}</Text>
              </Pressable>
              {flaw ? (
                <Text
                  style={[theme.typography.caption, styles.flaw, { color: theme.colors.textSecondary }]}
                  {...testProps(`quiz-flaw-${optionIndex}`)}
                >
                  {t(`flaw.${flaw}`, { defaultValue: '' })}
                </Text>
              ) : null}
              </View>
            )
          })}

          {/* The verdict, said out loud.
              The report was not "it marks me wrong" — it was that after answering there is only
              the grader's explanation, and a learner cannot tell whether they got it. A coloured
              border on one option does not answer "맞았나?". */}
          {answered && (
            <View
              accessibilityRole="text"
              style={{
                flexDirection: 'row', alignItems: 'center', gap: 6,
                borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10,
                marginBottom: 12,
                borderColor: outcome === 'correct' ? theme.colors.success
                  : outcome === 'partial' ? theme.colors.warning
                    : outcome === 'wrong' ? theme.colors.error : theme.colors.border,
                backgroundColor: theme.colors.surface,
              }}
              {...testProps('quiz-verdict')}
            >
              <Text style={[theme.typography.body, {
                color: outcome === 'correct' ? theme.colors.success
                  : outcome === 'partial' ? theme.colors.warning
                    : outcome === 'wrong' ? theme.colors.error : theme.colors.textSecondary,
                fontWeight: '600',
              }]}>
                {outcome === 'correct' ? '\u2713 ' : outcome === 'wrong' ? '\u2715 ' : outcome === 'partial' ? '\u2248 ' : ''}
                {t(`run.verdict.${outcome === 'unanswered' ? 'ungraded' : outcome}`)}
              </Text>
            </View>
          )}

          {item.question_type !== 'mcq' && (
            <TextInput
              value={text}
              onChangeText={setText}
              editable={!answered}
              multiline
              placeholder={t(`run.placeholder.${item.question_type}`)}
              placeholderTextColor={theme.colors.textSecondary}
              style={[styles.input, {
                borderColor: theme.colors.border,
                color: theme.colors.text,
                minHeight: item.question_type === 'essay' ? 160 : 64,
              }]}
              {...testProps('quiz-answer-input')}
            />
          )}

          {/* The server refuses an over-length answer rather than truncating it — grading the
              first 2,000 characters of a 4,000-character essay grades something the learner did
              not write. It just never said so until 채점 was pressed, and then said
              "비어 있거나 너무 길어요" for both directions at once. */}
          {item.question_type !== 'mcq' && !answered && (
            <Text
              style={[theme.typography.caption, {
                textAlign: 'right', marginTop: 4,
                color: length.state === 'too_long' ? theme.colors.error
                  : length.state === 'near_limit' ? theme.colors.warning
                    : theme.colors.textTertiary,
              }]}
              {...testProps('answer-length')}
            >
              {length.state === 'too_short'
                ? t('run.length.tooShort', { min: length.min })
                : t('run.length.count', { chars: length.count, max: length.max })}
            </Text>
          )}

          {answered && item.score !== null && (
            <View style={[styles.stem, { backgroundColor: theme.colors.surfaceElevated, borderColor: theme.colors.border }]}>
              <Text
                style={[theme.typography.label, { color: theme.colors.text }]}
                {...testProps('quiz-score')}
              >
                {/* Percent, matching the result screen — the same 0.1 read "10점" here and
                    "10%" there. */}
                {t('result.percent', { percent: Math.round((item.score ?? 0) * 100) })}
              </Text>
              {item.reference_answer && (
                <Text style={[theme.typography.caption, { color: theme.colors.textSecondary }]}>
                  {t('run.reference', { answer: item.reference_answer })}
                </Text>
              )}
            </View>
          )}

          {answered && item.feedback && (
            <QuizFeedback
              feedback={item.feedback}
              rubric={item.rubric}
              learnerText={text}
              referenceText={item.reference_answer}
            />
          )}

          {/* The CODE goes in, not a sentence: the kernel decides what it means and carries
              the route out. This screen has `gestureEnabled: false` and no header, so its only
              exit abandons the run — a refusal here without a way to act on it stranded a
              learner who had already paid to have earlier answers graded. */}
          <AiRefusalNotice
            code={error}
            actionId="quiz_grade"
            onRetry={() => void requestGrade()}
            style={{ marginTop: 12 }}
          />
        </ScrollView>

        <View style={styles.footer}>
          {!answered ? (
            <Button
              title={t('run.submit')}
              onPress={() => void submitAnswer()}
              disabled={item.question_type === 'mcq' ? choice === null : text.trim() === ''}
              {...testProps('quiz-submit')}
            />
          ) : (
            <>
              {/* Grading sits BESIDE moving on, never instead of it. It used to REPLACE them,
                  so a learner who submitted a short answer had exactly two buttons — pay, or
                  leave — and on the last item no way to finish the run at all. Charging is a
                  choice we offer; it must never be the only exit. */}
              {item.question_type !== 'mcq' && item.score === null && (
                <Button
                  title={grading ? t('run.grading')
                    : t('run.grade')}
                  onPress={() => void requestGrade()}
                  disabled={grading || shownPrice === null}
                  {...testProps('quiz-grade')}
                />
              )}
              <Button
                title={isLast ? t('run.finish') : t('run.next')}
                variant={item.question_type !== 'mcq' && item.score === null ? 'secondary' : 'primary'}
                onPress={() => (isLast ? void finish() : goTo(index + 1))}
                {...testProps(isLast ? 'quiz-finish' : 'quiz-next')}
              />
              {/* What grading costs, or that it is covered. Beside the buttons rather than on
                  one: the learner is deciding whether to spend and needs the number first. It
                  used to be said nowhere at all. */}
              {item.question_type !== 'mcq' && item.score === null && costLine && (
                <Text style={[theme.typography.caption, {
                  color: theme.colors.textSecondary, textAlign: 'center',
                }]} {...testProps('quiz-grade-cost')}>
                  {t(costLine.key, costLine.params)}
                </Text>
              )}
            </>
          )}
        </View>
      </KeyboardAvoidingView>
    </Screen>
  )
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { textAlign: 'center', marginTop: 32 },
  topBar: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12 },
  body: { paddingHorizontal: 16, gap: 10, paddingBottom: 24 },
  stem: { padding: 14, borderRadius: 12, borderWidth: 1, gap: 4 },
  flaw: { marginTop: 4, marginLeft: 12, marginBottom: 4 },
  option: { padding: 12, borderRadius: 10, borderWidth: 1 },
  input: { padding: 12, borderRadius: 10, borderWidth: 1, textAlignVertical: 'top' },
  footer: { padding: 16 },
})
