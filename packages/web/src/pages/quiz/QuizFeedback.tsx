import { useTranslation } from 'react-i18next'
import {
  asShortAnswerFeedback, asEssayFeedback, asStoredRubric, splitBySpan,
} from '@reeeeecall/shared/lib/quiz-feedback'

/**
 * What the grader said, rendered without a word the model wrote.
 *
 * The grader returns a verdict from a closed set, gap labels from a closed set, and character
 * spans into text the client already holds — the learner's own submission, or their own card's
 * answer. Every sentence below is a hand-translated string keyed off one of those labels; the
 * only model-authored text on screen is the question itself.
 *
 * This component exists because the spans were being paid for and thrown away: the result screen
 * showed a percentage and nothing else, so the tokens that produced "which part of your sentence
 * this is about" bought nothing.
 */
export function QuizFeedback({ feedback, rubric, learnerText, referenceText }: {
  feedback: unknown
  rubric?: unknown
  learnerText?: string
  referenceText?: string | null
}) {
  const { t } = useTranslation('quiz')

  const short = asShortAnswerFeedback(feedback)
  const essay = asEssayFeedback(feedback)
  if (!short && !essay) return null

  const textFor = (from: 'learner' | 'reference') =>
    from === 'learner' ? (learnerText ?? '') : (referenceText ?? '')

  return (
    <div className="p-3 bg-card rounded-lg border border-border space-y-2">
      {short && (
        <>
          <p className="text-sm font-medium text-foreground">
            {t(`verdict.${short.verdict}`)}
          </p>
          {short.gaps.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {short.gaps.map((gap) => (
                <span
                  key={gap}
                  className="px-2 py-0.5 text-xs rounded-full bg-accent text-content-tertiary"
                >
                  {t(`gap.${gap}`)}
                </span>
              ))}
            </div>
          )}
          {short.spans.map((span, i) => {
            const { before, hit, after } = splitBySpan(textFor(span.from), span)
            if (hit === '') return null
            return (
              <p key={i} className="text-xs text-content-tertiary">
                <span className="text-content-tertiary">{t(`span.${span.from}`)}: </span>
                {before}
                <mark className="bg-brand/20 text-foreground rounded px-0.5">{hit}</mark>
                {after}
              </p>
            )
          })}
        </>
      )}

      {essay && (
        <>
          {/* Per criterion, so a learner can see WHICH part they missed rather than one number.
              The aspect comes from the rubric stored with the question — the rubric they were
              graded against, not whatever the generator would produce today. */}
          <ul className="space-y-1.5">
            {essay.criteria.map((criterion) => {
              const aspect = asStoredRubric(rubric).find((c) => c.id === criterion.criterionId)
              // The span the grader returned for THIS criterion — "here is where you met it",
              // or on a miss, what in the reference was missed. It was being paid for on every
              // essay grade and drawn nowhere, which left the screen saying "not met" with no
              // way to see what that referred to.
              const { before, hit, after } = splitBySpan(
                textFor(criterion.span?.from ?? 'learner'), criterion.span)
              return (
                <li key={criterion.criterionId}>
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-sm text-foreground">
                      {aspect ? t(`aspect.${aspect.aspect}`) : t('aspect.covers_answer')}
                      {/* What this part was worth. A learner reading "not met" three times
                          cannot otherwise tell which one cost them the grade. */}
                      {aspect && aspect.weight > 0 && (
                        <span className="text-xs text-content-tertiary ml-1.5">
                          {t('level.weight', { weight: aspect.weight })}
                        </span>
                      )}
                    </span>
                    <span className="text-xs text-content-tertiary shrink-0">
                      {t(`level.${criterion.level}`)}
                    </span>
                  </div>
                  {hit !== '' && (
                    <p className="text-xs text-content-tertiary mt-0.5">
                      <span>{t(`span.${criterion.span?.from ?? 'learner'}`)}: </span>
                      {before}
                      <mark className="bg-brand/20 text-foreground rounded px-0.5">{hit}</mark>
                      {after}
                    </p>
                  )}
                  {/* WHAT was required. The rubric has carried these since generation — terms
                      copied from the learner's own card — and nothing rendered them, so a failed
                      criterion said "미충족" and stopped. On a wrong answer this is the single
                      most useful line on the screen, and it was already paid for. Shown only
                      where something is missing: on a met criterion it is a spoiler for nothing. */}
                  {aspect && aspect.mustMention.length > 0 && criterion.level !== 'met' && (
                    <p className="text-xs text-content-tertiary mt-0.5">
                      {t('level.mustMention')}{' '}
                      {aspect.mustMention.map((term, i) => (
                        <span key={term}>
                          {i > 0 && ' · '}
                          <span className="text-foreground">{term}</span>
                        </span>
                      ))}
                    </p>
                  )}
                </li>
              )
            })}
          </ul>
          {essay.unjudgeableWeight > 0 && (
            <p className="text-xs text-content-tertiary">{t('level.unjudgeableNote')}</p>
          )}
        </>
      )}
    </div>
  )
}
