import { View, Text, StyleSheet } from 'react-native'
import { useTranslation } from 'react-i18next'
import {
  asShortAnswerFeedback, asEssayFeedback, asStoredRubric, splitBySpan,
} from '@reeeeecall/shared/lib/quiz-feedback'
import { useTheme } from '../../theme'

/**
 * What the grader said, rendered without a word the model wrote.
 *
 * The grader returns a verdict from a closed set, gap labels from a closed set, and character
 * spans into text the client already holds. Every string below is hand-translated and keyed off
 * one of those labels; the only model-authored text on screen is the question.
 *
 * Without this the spans were being paid for and thrown away — the result screen showed a
 * percentage, so the tokens that produced "which part of your sentence this is about" bought
 * nothing.
 */
export function QuizFeedback({ feedback, rubric, learnerText, referenceText }: {
  feedback: unknown
  rubric?: unknown
  learnerText?: string
  referenceText?: string | null
}) {
  const theme = useTheme()
  const { t } = useTranslation('quiz')

  const short = asShortAnswerFeedback(feedback)
  const essay = asEssayFeedback(feedback)
  if (!short && !essay) return null

  const textFor = (from: 'learner' | 'reference') =>
    from === 'learner' ? (learnerText ?? '') : (referenceText ?? '')

  return (
    <View style={[styles.box, { backgroundColor: theme.colors.surfaceElevated, borderColor: theme.colors.border }]}>
      {short && (
        <>
          <Text style={[theme.typography.label, { color: theme.colors.text }]}>
            {t(`verdict.${short.verdict}`)}
          </Text>
          {short.gaps.length > 0 && (
            <View style={styles.chips}>
              {short.gaps.map((gap) => (
                <View key={gap} style={[styles.chip, { borderColor: theme.colors.border }]}>
                  <Text style={[theme.typography.caption, { color: theme.colors.textSecondary }]}>
                    {t(`gap.${gap}`)}
                  </Text>
                </View>
              ))}
            </View>
          )}
          {short.spans.map((span, i) => {
            const { before, hit, after } = splitBySpan(textFor(span.from), span)
            if (hit === '') return null
            return (
              <Text key={i} style={[theme.typography.caption, { color: theme.colors.textSecondary }]}>
                {t(`span.${span.from}`)}: {before}
                <Text style={{ color: theme.colors.primary, fontWeight: '600' }}>{hit}</Text>
                {after}
              </Text>
            )
          })}
        </>
      )}

      {essay && (
        <>
          {/* Per criterion, so a learner sees WHICH part they missed rather than one number. The
              aspect comes from the rubric stored with the question — the one they were graded
              against, not whatever the generator would produce today. */}
          {essay.criteria.map((criterion) => {
            const aspect = asStoredRubric(rubric).find((c) => c.id === criterion.criterionId)
            return (
              <View key={criterion.criterionId} style={styles.row}>
                <Text style={[theme.typography.body, { color: theme.colors.text, flex: 1 }]}>
                  {aspect ? t(`aspect.${aspect.aspect}`) : t('aspect.covers_answer')}
                </Text>
                <Text style={[theme.typography.caption, { color: theme.colors.textSecondary }]}>
                  {t(`level.${criterion.level}`)}
                </Text>
              </View>
            )
          })}
          {essay.unjudgeableWeight > 0 && (
            <Text style={[theme.typography.caption, { color: theme.colors.textSecondary }]}>
              {t('level.unjudgeableNote')}
            </Text>
          )}
        </>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  box: { padding: 12, borderRadius: 12, borderWidth: 1, gap: 6 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, borderWidth: 1 },
  row: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
})
