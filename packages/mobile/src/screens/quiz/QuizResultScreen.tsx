import { useEffect, useState } from 'react'
import { View, Text, StyleSheet, ScrollView, Pressable } from 'react-native'
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { useTranslation } from 'react-i18next'
import { useQuizStore, type QuizRunItem } from '@reeeeecall/shared/stores/quiz-store'
import { Screen, Button } from '../../components/ui'
import { testProps } from '../../utils/testProps'
import { useTheme } from '../../theme'
import { tallyQuiz, tallyLine } from '@reeeeecall/shared/lib/quiz-outcome'
import { QuizFeedback } from './QuizFeedback'
import type { QuizStackParamList } from '../../navigation/types'
import { retakeNoteKey } from '@reeeeecall/shared/lib/quiz-pricing'

type Nav = NativeStackNavigationProp<QuizStackParamList, 'QuizResult'>
type Rt = RouteProp<QuizStackParamList, 'QuizResult'>

/**
 * The score, and the control that makes it the learner's own.
 *
 * Overriding an AI grade is free and works in both directions. Free, because charging for a
 * correction would be a second sale on a failure we caused; both directions, because a
 * one-way "I was right" button is an appeals window that only ever inflates scores, not a
 * judgement.
 */
export function QuizResultScreen() {
  const theme = useTheme()
  const { t } = useTranslation('quiz')
  const navigation = useNavigation<Nav>()
  const { runId } = useRoute<Rt>().params
  const { run, loadRun, override, startRun } = useQuizStore()
  const [busy, setBusy] = useState<string | null>(null)

  useEffect(() => { void loadRun(runId) }, [runId, loadRun])

  const retake = async () => {
    if (!run) return
    // Always free: the questions are the asset, and a set that charged on every sitting would
    // never become a habit.
    const newRunId = await startRun(run.set_id)
    navigation.replace('QuizRun', { runId: newRunId })
  }

  const flip = async (item: QuizRunItem, score: number) => {
    setBusy(item.item_id)
    try { await override(item.item_id, score) } finally { setBusy(null) }
  }

  if (!run) {
    return <Screen><Text style={[theme.typography.body, styles.center, { color: theme.colors.textSecondary }]}>{t('run.loading')}</Text></Screen>
  }

  // COUNTS, not a percentage.
  //
  // The comment here used to say "over what was GRADED, not over what was asked" — and then
  // divided by `score_max`, the total question count set when the run starts. Answering six
  // short-answer questions, paying to grade one and getting it right read as 17%.
  //
  // Fixing the denominator would not have been enough: a quiz item has three outcomes and a
  // ratio has two. An ungraded answer is not a wrong answer.
  const tally = tallyQuiz(run.items.map((i) => ({ answered: i.answered, score: i.score })))
  const tallyText = tallyLine(tally)

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.body}>
        <View style={[styles.score, { backgroundColor: theme.colors.surfaceElevated, borderColor: theme.colors.border }]}>
          <Text style={[theme.typography.h1, { color: theme.colors.text }]}
                {...testProps('quiz-result-headline')}>
            {tally.judged === 0
              ? t('result.nothingGraded')
              : `${t('run.verdict.correct')} ${tally.correct}`}
          </Text>
          <Text style={[theme.typography.bodySmall, { color: theme.colors.textSecondary }]}
                {...testProps('quiz-result-tally')}>
            {/* The three numbers, because there are three outcomes. */}
            {tally.judged === 0
              ? t('result.nothingGradedBody')
              : t(tallyText.key, tallyText.params)}
          </Text>
          {tally.unanswered > 0 && (
            <Text style={[theme.typography.caption, { color: theme.colors.textTertiary }]}>
              {t('result.unanswered', { n: tally.unanswered })}
            </Text>
          )}
          <Text style={[theme.typography.caption, { color: theme.colors.textSecondary }]}>
            {t('result.attempt', { count: run.attempt_no })}
          </Text>
        </View>

        {run.items.map((item, i) => (
          <View key={item.item_id} style={[styles.card, { backgroundColor: theme.colors.surfaceElevated, borderColor: theme.colors.border }]}>
            <View style={styles.cardTop}>
              <View style={styles.cardBody}>
                <Text style={[theme.typography.caption, { color: theme.colors.textSecondary }]}>
                  {t('result.item', { n: i + 1 })}
                </Text>
                <Text style={[theme.typography.body, { color: theme.colors.text }]} numberOfLines={2}>
                  {item.stem}
                </Text>
                {item.reference_answer && (
                  <Text style={[theme.typography.caption, { color: theme.colors.textSecondary }]}>
                    {t('run.reference', { answer: item.reference_answer })}
                  </Text>
                )}
              </View>
              <Text style={[theme.typography.label, { color: theme.colors.text }]}>
                {item.score === null ? t('result.ungraded') : `${Math.round(item.score * 100)}%`}
              </Text>
            </View>

            {item.feedback && (
              <QuizFeedback
                feedback={item.feedback}
                rubric={item.rubric}
                /* Their own submission, back from the run item. Without it every
                   `from: "learner"` span renders as nothing, so the grading detail the learner
                   paid for is visible only during the sitting itself. */
                learnerText={typeof item.response?.text === 'string' ? item.response.text : undefined}
                referenceText={item.reference_answer}
              />
            )}

            {/* `answered`, not `score !== null`: an ungraded answer is precisely when the
                learner needs to mark it themselves. `override_quiz_grade` already accepts a
                null previous score. */}
            {item.answered && (
              <View style={styles.overrides}>
                <Pressable
                  disabled={busy === item.item_id || item.score === 1}
                  onPress={() => void flip(item, 1)}
                  style={[styles.chip, { borderColor: theme.colors.border, opacity: item.score === 1 ? 0.4 : 1 }]}
                  {...testProps(`quiz-mark-correct-${i}`)}
                >
                  <Text style={[theme.typography.caption, { color: theme.colors.text }]}>{t('result.markCorrect')}</Text>
                </Pressable>
                <Pressable
                  disabled={busy === item.item_id || item.score === 0}
                  onPress={() => void flip(item, 0)}
                  style={[styles.chip, { borderColor: theme.colors.border, opacity: item.score === 0 ? 0.4 : 1 }]}
                  {...testProps(`quiz-mark-wrong-${i}`)}
                >
                  <Text style={[theme.typography.caption, { color: theme.colors.text }]}>{t('result.markWrong')}</Text>
                </Pressable>
              </View>
            )}
          </View>
        ))}

        {/* Said before the button, not after the charge: the same questions come back, and the
            grading on them is a fresh call every sitting. */}
        <Text style={[theme.typography.caption, {
          color: theme.colors.textSecondary, textAlign: 'center',
        }]}>
          {t(retakeNoteKey(run.items[0]?.question_type))}
        </Text>
        <Button title={t('result.retake')} onPress={() => void retake()} {...testProps('quiz-retake')} />
        <Button
          title={t('run.backToQuiz')}
          variant="secondary"
          onPress={() => navigation.navigate('QuizHome')}
          {...testProps('quiz-back')}
        />
      </ScrollView>
    </Screen>
  )
}

const styles = StyleSheet.create({
  center: { textAlign: 'center', marginTop: 32 },
  body: { padding: 16, gap: 10, paddingBottom: 32 },
  score: { padding: 16, borderRadius: 12, borderWidth: 1, alignItems: 'center', gap: 2 },
  card: { padding: 12, borderRadius: 12, borderWidth: 1, gap: 8 },
  cardTop: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  cardBody: { flex: 1, gap: 2 },
  overrides: { flexDirection: 'row', gap: 8 },
  chip: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, borderWidth: 1 },
})
