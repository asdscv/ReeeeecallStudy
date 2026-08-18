import { useEffect, useMemo, useRef, useState } from 'react'
import {
  View, Text, StyleSheet, ScrollView, Pressable, TextInput, KeyboardAvoidingView, Platform,
} from 'react-native'
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { useTranslation } from 'react-i18next'
import { quizGrowth, QUIZ_GROWTH_POLL_MS } from '@reeeeecall/shared/lib/quiz-shortfall'
import {
  useQuizStore, QuizError, QUIZ_GRADE_ACTION, type QuizSubmitResult, type QuizQuote,
  optionFlaws, optionAxes, QUIZ_FEEDBACK_REASONS,
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
 * Multiple choice is MARKED the moment it is submitted, in SQL, free — and that mark is final;
 * no model revises it. Its EXPLANATION shipped with the question (one axis per wrong option,
 * mig 252), so the one matching their choice is already here. Short answer and essay buy the mark
 * itself, through a separate priced button rather than something that happens to the learner —
 * spending is always a gesture.
 *
 * Typed answers are held per item in a ref, so moving between questions never loses text. That
 * covers the realistic loss: a learner drafting an essay, tapping back to re-read question two,
 * and returning. It does NOT survive the app being killed — that needs a storage dependency this
 * package does not have, and it is stated here rather than implied by silence.
 */
/** 학습자가 고칠 수 있는 실패들 — 재시도가 아니라 무엇을 하면 되는지가 필요합니다. */
const QUIZ_SPECIFIC_ERRORS = new Set([
  'QUIZ_UNGRADEABLE', 'QUIZ_ITEM_GONE', 'QUIZ_NOT_ANSWERED', 'QUIZ_CARDS_TOO_SHORT',
])

export function QuizRunScreen() {
  const theme = useTheme()
  const { t } = useTranslation('quiz')
  const navigation = useNavigation<Nav>()
  const { runId } = useRoute<Rt>().params
  const {
    run, loading, loadRun, refreshRun, submit, gradeWithAi, quote, grading, finishRun,
    rateItem, itemRatings,
  } = useQuizStore()

  const [index, setIndex] = useState(0)
  const [choice, setChoice] = useState<number | null>(null)
  /** 이유 칩이 열려 있는지. 👎 를 누르면 열리고, 문항을 넘기면 닫힙니다. */
  const [reasonsOpen, setReasonsOpen] = useState(false)
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
  //
  // 그리고 **영원히 못 채우는 경우**가 있습니다: 덱이 작아 카드를 다 썼거나, 그 카드들로는
  // 그 유형의 문항을 만들 수 없을 때. 그때 예전에는 조회가 끝없이 돌고 학습자는 왜 5문항을
  // 골랐는데 4문항인지 아무 설명도 못 받았습니다.
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
    if (!stillGrowing) return
    const id = setInterval(() => {
      void refreshRun(runId)
      setIdleTicks((t) => t + 1)
    }, QUIZ_GROWTH_POLL_MS)
    return () => clearInterval(id)
  }, [runId, stillGrowing, refreshRun])

  const items = useMemo(() => run?.items ?? [], [run])
  const item = items[index]

  // Re-quoted per item: an essay costs four times a short answer, so one quote for the whole
  // run would show the wrong number on most of it.
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
    if (item) drafts.current[item.item_id] = text
    const nextItem = items[next]
    setIndex(next)
    setChoice(null)
    setReasonsOpen(false)
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
      // 제출과 채점은 한 동작입니다. 예전에는 답을 내고 채점을 한 번 더 눌러야 했고, 그 사이에서
      // 학습자는 "제출했는데 왜 점수가 없지"를 봤습니다. 값은 제출 버튼 아래에 미리 적혀 있으니
      // 이미 값을 보고 누른 제출이 그 제스처입니다. 객관식은 제출로 채점이 끝나 여기 오지 않습니다.
      if (item.question_type !== 'mcq' && submitted && submitted.graded !== true && shownPrice !== null) {
        await gradeWithAi(item.item_id, text.trim(), shownPrice)
      }
      await loadRun(runId)
    } catch (e) {
      setError(e instanceof QuizError ? e.code : 'UNKNOWN')
      // 채점이 거절돼도 답안은 서버에 있습니다. 다시 읽지 않으면 화면만 답하지 않은 상태로 남아
      // 같은 답을 또 제출하게 됩니다.
      await loadRun(runId)
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
  // Written with the question, revealed on answering (mig 252). Free, and already on the device.
  const axes = optionAxes(item)
  const isLast = index === items.length - 1
  /**
   * The option this learner chose, by text.
   *
   * From the stored response rather than local state: reopening a run leaves `choice` null while
   * the item is still answered.
   */
  const pickedIndex = typeof item.response?.choice === 'number' ? item.response.choice : choice
  const pickedOption = item.question_type === 'mcq' && pickedIndex !== null
    ? item.options?.[pickedIndex] ?? null
    : null

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

        {/* 요청한 수를 못 채운 채로 생성이 끝났습니다. 웹과 같은 판정(quizGrowth). */}
        {growth.cameUpShort && (
          <Text style={[theme.typography.caption, { color: theme.colors.textSecondary }]}
            {...testProps('quiz-shortfall')}>
            {t('run.shortfall', { requested: run?.requested_count ?? 0, made: items.length })}
          </Text>
        )}

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
                  {/* And, for the option they actually PICKED, what separates it from the answer.
                      Only there — printing all three axes buries the one about their own mistake. */}
                  {isPicked && axes[optionIndex]
                    ? ' ' + t(`mcqAxis.${axes[optionIndex]}`, { defaultValue: '' })
                    : ''}
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
              {/* 모범답안. 채점 뒤에만 옵니다(mig 262). */}
              {item.model_answer && (
                <View style={{ marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: theme.colors.border }}>
                  <Text style={[theme.typography.caption, { color: theme.colors.textSecondary, fontWeight: '600' }]}>
                    {t('run.modelAnswer')}
                  </Text>
                  <Text style={[theme.typography.body, { color: theme.colors.text, marginTop: 2 }]}>
                    {item.model_answer}
                  </Text>
                </View>
              )}
            </View>
          )}

          {answered && item.feedback && (
            <QuizFeedback
              feedback={item.feedback}
              rubric={item.rubric}
              // For multiple choice "what the learner wrote" is the option they picked — the
              // string the spans were computed against. Passing the (always empty) text box
              // would silently drop every highlight they just paid for.
              learnerText={item.question_type === 'mcq' ? (pickedOption ?? '') : text}
              referenceText={item.reference_answer}
            />
          )}

          {/* The CODE goes in, not a sentence: the kernel decides what it means and carries
              the route out. This screen has `gestureEnabled: false` and no header, so its only
              exit abandons the run — a refusal here without a way to act on it stranded a
              learner who had already paid to have earlier answers graded. */}
          {/* 이 문항이 괜찮았나요?
              문항은 전부 모델이 씁니다. 그런데 하나가 나쁘게 나왔을 때 그걸 알 경로가 없었고,
              그래서 다음에도 같은 프롬프트로 같은 문항이 나왔습니다. 👎 만으로 기록되고 이유는
              선택입니다 — 필수로 만들면 두 번째 탭이 생기고, 그러면 첫 번째도 안 눌립니다. */}
          {/* 채점이 끝난 뒤에만. `answered` 는 제출 직후를 포함하는데 그때는 점수도 해설도 아직
              없습니다. 객관식은 제출이 곧 채점이라 즉시 나타납니다. */}
          {answered && item.score !== null && (
            <View
              style={[styles.stem, {
                backgroundColor: theme.colors.surfaceElevated, borderColor: theme.colors.border,
                marginTop: 12,
              }]}
              {...testProps('quiz-item-rating', true)}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                <Text style={[theme.typography.caption, { color: theme.colors.textSecondary, flex: 1 }]}>
                  {t('rate.prompt')}
                </Text>
                <View style={{ flexDirection: 'row', gap: 6 }}>
                  {(['good', 'bad'] as const).map((verdict) => {
                    const chosen = itemRatings[item.item_id]?.verdict === verdict
                    return (
                      <Pressable
                        key={verdict}
                        accessibilityRole="button"
                        accessibilityLabel={t(`rate.${verdict}`)}
                        accessibilityState={{ selected: chosen }}
                        onPress={() => {
                          void rateItem(item.item_id, verdict)
                          setReasonsOpen(verdict === 'bad')
                        }}
                        style={{
                          paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8, borderWidth: 1,
                          borderColor: chosen ? theme.colors.primary : theme.colors.border,
                        }}
                        {...testProps(`quiz-rate-${verdict}`)}
                      >
                        <Text style={{ fontSize: 16 }}>{verdict === 'good' ? '👍' : '👎'}</Text>
                      </Pressable>
                    )
                  })}
                </View>
              </View>
              {reasonsOpen && (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                  {QUIZ_FEEDBACK_REASONS.map((reason) => {
                    const chosen = itemRatings[item.item_id]?.reason === reason
                    return (
                      <Pressable
                        key={reason}
                        accessibilityRole="button"
                        onPress={() => void rateItem(item.item_id, 'bad', reason)}
                        style={{
                          paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, borderWidth: 1,
                          borderColor: chosen ? theme.colors.primary : theme.colors.border,
                        }}
                      >
                        <Text style={[theme.typography.caption, {
                          color: chosen ? theme.colors.primary : theme.colors.textSecondary,
                        }]}>
                          {t(`rate.reason.${reason}`)}
                        </Text>
                      </Pressable>
                    )
                  })}
                </View>
              )}
            </View>
          )}

          {/* 정확한 이유가 있으면 그것을 말합니다. `refusalFrom` 의 default 는 모르는 코드를
              전부 "처리하지 못했어요 · 다시 시도"로 뭉갭니다 — 40자 미만이라 채점될 수 없는
              답안이 우리 쪽 장애처럼 보였고 재시도는 영원히 실패했습니다. */}
          {error && QUIZ_SPECIFIC_ERRORS.has(error) ? (
            <Text
              style={[theme.typography.caption, { color: theme.colors.error, marginTop: 12 }]}
              accessibilityRole="alert"
            >
              {error === 'QUIZ_UNGRADEABLE'
                ? t('run.length.tooShort', { min: length.min })
                : t(`error.${error}`, { defaultValue: t('error.UNKNOWN') })}
            </Text>
          ) : (
            <AiRefusalNotice
              code={error}
              actionId="quiz_grade"
              onRetry={() => void requestGrade()}
              style={{ marginTop: 12 }}
            />
          )}
        </ScrollView>

        <View style={styles.footer}>
          {!answered ? (
            <Button
              title={t('run.submit')}
              onPress={() => void submitAnswer()}
              // 제출이 곧 채점이므로 채점될 수 없는 길이는 제출도 막습니다. 예전에는 열 글자
              // 서술형도 제출됐다가 채점에서 거절됐고, 화면은 그걸 우리 잘못처럼 말했습니다.
              disabled={item.question_type === 'mcq'
                ? choice === null
                : text.trim() === '' || length.state === 'too_short' || length.state === 'too_long'}
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
                  title={grading ? t('run.grading') : t('run.grade')}
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
