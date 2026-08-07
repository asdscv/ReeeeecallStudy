import { useEffect, useMemo, useRef, useState } from 'react'
import {
  View, Text, StyleSheet, ScrollView, Pressable, TextInput, KeyboardAvoidingView, Platform,
} from 'react-native'
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { useTranslation } from 'react-i18next'
import {
  useQuizStore, QuizError, QUIZ_GRADE_ACTION, type QuizSubmitResult,
} from '@reeeeecall/shared/stores/quiz-store'
import { formatUsdMicro } from '@reeeeecall/shared/lib/ai/server-client'
import { Screen, Button, EmptyState } from '../../components/ui'
import { testProps } from '../../utils/testProps'
import { useTheme } from '../../theme'
import { QuizFeedback } from './QuizFeedback'
import type { QuizStackParamList } from '../../navigation/types'

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
  const { run, loading, loadRun, submit, gradeWithAi, quote, grading, finishRun } = useQuizStore()

  const [index, setIndex] = useState(0)
  const [choice, setChoice] = useState<number | null>(null)
  const [text, setText] = useState('')
  const [result, setResult] = useState<QuizSubmitResult | null>(null)
  // Keyed by item: an essay costs four times a short answer, so an unkeyed price would quote
  // the previous question's on this one — and clearing it in the effect is a cascading render.
  const [gradePrice, setGradePrice] = useState<{ itemId: string; micro: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const drafts = useRef<Record<string, string>>({})
  const startedAt = useRef(Date.now())

  useEffect(() => { void loadRun(runId) }, [runId, loadRun])

  const items = useMemo(() => run?.items ?? [], [run])
  const item = items[index]

  // Re-quoted per item: an essay costs four times a short answer, so one quote for the whole
  // run would show the wrong number on most of it.
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
      setError(t(`error.${e instanceof QuizError ? e.code : 'UNKNOWN'}`))
    }
  }

  const requestGrade = async () => {
    if (!item || shownPrice === null) return
    setError(null)
    try {
      await gradeWithAi(item.item_id, text.trim(), shownPrice)
    } catch (e) {
      setError(t(`error.${e instanceof QuizError ? e.code : 'UNKNOWN'}`))
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

  const answered = item.answered || result !== null
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
            return (
              <Pressable
                key={optionIndex}
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
            )
          })}

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

          {answered && item.score !== null && (
            <View style={[styles.stem, { backgroundColor: theme.colors.surfaceElevated, borderColor: theme.colors.border }]}>
              <Text style={[theme.typography.label, { color: theme.colors.text }]}>
                {t('run.scored', { score: Math.round((item.score ?? 0) * 100) })}
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

          {error && <Text style={[theme.typography.caption, { color: theme.colors.error }]}>{error}</Text>}
        </ScrollView>

        <View style={styles.footer}>
          {!answered ? (
            <Button
              title={t('run.submit')}
              onPress={() => void submitAnswer()}
              disabled={item.question_type === 'mcq' ? choice === null : text.trim() === ''}
              {...testProps('quiz-submit')}
            />
          ) : item.question_type !== 'mcq' && item.score === null ? (
            // A separate, priced gesture. Submitting recorded the answer for free; paying to
            // have it judged is the learner's call, and the price is on the button.
            <Button
              title={grading ? t('run.grading')
                : t('run.gradeFor', { price: shownPrice === 0 ? t('setup.free') : formatUsdMicro(shownPrice ?? 0) })}
              onPress={() => void requestGrade()}
              disabled={grading || shownPrice === null}
              {...testProps('quiz-grade')}
            />
          ) : isLast ? (
            <Button title={t('run.finish')} onPress={() => void finish()} {...testProps('quiz-finish')} />
          ) : (
            <Button title={t('run.next')} onPress={() => goTo(index + 1)} {...testProps('quiz-next')} />
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
  option: { padding: 12, borderRadius: 10, borderWidth: 1 },
  input: { padding: 12, borderRadius: 10, borderWidth: 1, textAlignVertical: 'top' },
  footer: { padding: 16 },
})
