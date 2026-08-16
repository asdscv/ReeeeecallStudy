import { View, Text } from 'react-native'
import { useTranslation } from 'react-i18next'
import { itemOutcome, type QuizItemLike } from '@reeeeecall/shared/lib/quiz-outcome'
import { testProps } from '../../utils/testProps'
import { useTheme } from '../../theme'

/**
 * 맞음 / 부분 / 틀림 / 채점 안 함 — the four words, and never a percentage.
 *
 * The run screen has said this since the report "맞췄다는 걸 알기가 힘들다". The RESULT screen did
 * not: it printed `Math.round(score * 100)%` beside each item, so a correct answer read "100%" and
 * a wrong one "0%" — a verdict wearing a number's clothes. The only other signal on the row was
 * which override button happened to be disabled, which reads as an instruction, not a state.
 */
export function QuizVerdictBadge({ item }: { item: QuizItemLike }) {
  const { t } = useTranslation('quiz')
  const theme = useTheme()
  const outcome = itemOutcome(item)

  const color = outcome === 'correct' ? theme.colors.success
    : outcome === 'partial' ? theme.colors.warning
      : outcome === 'wrong' ? theme.colors.error
        : theme.colors.textSecondary

  return (
    <View
      style={{
        flexDirection: 'row', alignItems: 'center', gap: 4,
        paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999,
        borderWidth: 1, borderColor: color + '66', backgroundColor: color + '1A',
      }}
      {...testProps('quiz-verdict-badge')}
    >
      {/* A mark as well as a colour: "which grey means I got it" is not a question a learner
          should have to answer, and for a colour-blind one it is not answerable at all. */}
      <Text style={[theme.typography.caption, { color }]}>
        {outcome === 'correct' ? '✓' : outcome === 'wrong' ? '✕'
          : outcome === 'partial' ? '≈' : '…'}
      </Text>
      <Text style={[theme.typography.caption, { color, fontWeight: '600' }]}>
        {t(`run.verdict.${outcome === 'unanswered' ? 'ungraded' : outcome}`)}
      </Text>
    </View>
  )
}
