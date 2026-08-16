import { useTranslation } from 'react-i18next'
import { itemOutcome, type QuizItemLike } from '@reeeeecall/shared/lib/quiz-outcome'

/**
 * 맞음 / 부분 / 틀림 / 채점 안 함 — the four words, and never a percentage.
 *
 * The run screen has said this since the report "맞췄다는 걸 알기가 힘들다". The RESULT screen did
 * not: it printed `Math.round(score * 100)%` beside each item, so a correct answer read "100%" and
 * a wrong one "0%". A percentage over one item has no meaning to express — it is a verdict wearing
 * a number's clothes — and the only other signal on the row was which override button happened to
 * be disabled, which reads as an instruction rather than a state.
 *
 * Extracted so the two screens cannot drift: one function decides the outcome, one component
 * draws it, and both read `run.verdict.*`.
 */
export function QuizVerdictBadge({ item, size = 'md' }: { item: QuizItemLike; size?: 'sm' | 'md' }) {
  const { t } = useTranslation('quiz')
  const outcome = itemOutcome(item)

  const tone = outcome === 'correct'
    ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
    : outcome === 'partial'
      ? 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400'
      : outcome === 'wrong'
        ? 'border-destructive/40 bg-destructive/10 text-destructive'
        : 'border-border bg-card text-muted-foreground'

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border font-medium shrink-0 ${tone} ${
        size === 'sm' ? 'px-2 py-0.5 text-xs' : 'px-2.5 py-1 text-sm'
      }`}
      data-testid="quiz-verdict-badge"
      data-outcome={outcome}
    >
      {/* A mark as well as a colour: "which grey means I got it" is not a question a learner
          should have to answer, and for a colour-blind one it is not answerable at all. */}
      <span aria-hidden="true">
        {outcome === 'correct' ? '✓' : outcome === 'wrong' ? '✕'
          : outcome === 'partial' ? '≈' : '…'}
      </span>
      {t(`run.verdict.${outcome === 'unanswered' ? 'ungraded' : outcome}`)}
    </span>
  )
}
