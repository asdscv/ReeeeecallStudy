import { View, Text, StyleSheet } from 'react-native'
import { useTranslation } from 'react-i18next'
import {
  asMcqFeedback, asShortAnswerFeedback, asEssayFeedback, asStoredRubric, splitBySpan,
} from '@reeeeecall/shared/lib/quiz-feedback'
import { useTheme } from '../../theme'
import { testProps } from '../../utils/testProps'

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

  const mcq = asMcqFeedback(feedback)
  const short = asShortAnswerFeedback(feedback)
  const essay = asEssayFeedback(feedback)
  if (!mcq && !short && !essay) return null

  const textFor = (from: 'learner' | 'reference') =>
    from === 'learner' ? (learnerText ?? '') : (referenceText ?? '')

  return (
    <View style={[styles.box, { backgroundColor: theme.colors.surfaceElevated, borderColor: theme.colors.border }]}>
      {/* Multiple choice. The mark came from SQL on submit and is not repeated here; this is the
          part that was bought — what the two options differ on, and the words in the learner's
          own card that carry the difference. */}
      {mcq && (
        <>
          <Text style={[theme.typography.label, { color: theme.colors.text }]}
            {...testProps('quiz-mcq-axis')}>
            {t(`mcqAxis.${mcq.axis}`)}
          </Text>
          {mcq.spans.map((span, i) => {
            const { before, hit, after } = splitBySpan(textFor(span.from), span)
            if (hit === '') return null
            return (
              <Text key={i} style={[theme.typography.caption, { color: theme.colors.textSecondary }]}>
                {/* 같은 두 키 — "내 답에서"는 고른 보기, "카드에서"는 정답 보기. */}
                {t(`span.${span.from}`)}: {before}
                <Text style={{ color: theme.colors.primary, fontWeight: '600' }}>{hit}</Text>
                {after}
              </Text>
            )
          })}
        </>
      )}

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
            // The span the grader returned for THIS criterion — where it was met, or on a miss
            // what in the reference was missed. Paid for on every essay grade and drawn nowhere,
            // which left "not met" on screen with nothing to point at.
            const { before, hit, after } = splitBySpan(
              textFor(criterion.span?.from ?? 'learner'), criterion.span)
            return (
              <View key={criterion.criterionId} style={{ gap: 2 }}>
                <View style={styles.row}>
                  <Text style={[theme.typography.body, { color: theme.colors.text, flex: 1 }]}>
                    {aspect ? t(`aspect.${aspect.aspect}`) : t('aspect.covers_answer')}
                    {/* What this part was worth: "not met" three times over is unreadable
                        without knowing which one cost the grade. */}
                    {aspect && aspect.weight > 0 && (
                      <Text style={[theme.typography.caption, { color: theme.colors.textSecondary }]}>
                        {' '}{t('level.weight', { weight: aspect.weight })}
                      </Text>
                    )}
                  </Text>
                  <Text style={[theme.typography.caption, { color: theme.colors.textSecondary }]}>
                    {t(`level.${criterion.level}`)}
                  </Text>
                </View>
                {hit !== '' && (
                  <Text style={[theme.typography.caption, { color: theme.colors.textSecondary }]}>
                    {t(`span.${criterion.span?.from ?? 'learner'}`)}: {before}
                    <Text style={{ color: theme.colors.primary, fontWeight: '600' }}>{hit}</Text>
                    {after}
                  </Text>
                )}
                {/* WHAT was required. Carried in the rubric since generation — terms copied from
                    the learner's own card — and never rendered, so a failed criterion said
                    "미충족" and stopped. Only where something is missing. */}
                {aspect && aspect.mustMention.length > 0 && criterion.level !== 'met' && (
                  <Text style={[theme.typography.caption, { color: theme.colors.textSecondary }]}>
                    {t('level.mustMention')}{' '}
                    <Text style={{ color: theme.colors.text }}>
                      {aspect.mustMention.join(' · ')}
                    </Text>
                  </Text>
                )}
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
