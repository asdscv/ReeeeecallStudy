/**
 * "맞고 틀림 표시 불명확" — reported from a Galaxy, and not what it sounds like.
 *
 * The owner's clarification: "틀리게 표시한다는 게 아니라 사용자 입장에서 맞췄다는 걸 알기가
 * 힘들다는거야. 그냥 딱 설명만 있잖아." The app never says whether you got it. It shows the
 * grader's explanation and leaves the verdict to be inferred.
 *
 * And the result screen's percentage was worse than unclear, it was wrong: the comment above it
 * says "over what was GRADED" while the arithmetic is `score_raw / score_max`, and `score_max`
 * is the total question count set when the run starts. Answer six short-answer questions, pay to
 * grade one, get it right — 17%.
 *
 * The fix is to stop expressing this as a ratio at all. A quiz item has three outcomes and a
 * fraction has two: an ungraded answer is not a wrong answer, and putting it in either half of
 * a ratio asserts something false about a learner who simply has not paid to have it judged.
 */
import { describe, it, expect } from 'vitest'
import {
  itemOutcome, tallyQuiz, tallyLine, CORRECT_AT, PARTIAL_AT,
} from '@reeeeecall/shared/lib/quiz-outcome'

describe('one item', () => {
  it('separates ungraded from wrong', () => {
    // THE point of the module. Declining to pay for a grade is not getting it wrong.
    expect(itemOutcome({ answered: true, score: null })).toBe('ungraded')
    expect(itemOutcome({ answered: true, score: 0 })).toBe('wrong')
  })

  it('separates unanswered from both', () => {
    expect(itemOutcome({ answered: false, score: null })).toBe('unanswered')
  })

  it('reads a score the way the grader does', () => {
    // CORRECT_AT is the grader's own KNOWN band, so the mark on screen and the score in the
    // ledger cannot disagree about the same answer.
    expect(itemOutcome({ answered: true, score: 1 })).toBe('correct')
    expect(itemOutcome({ answered: true, score: CORRECT_AT })).toBe('correct')
    expect(itemOutcome({ answered: true, score: CORRECT_AT - 0.01 })).toBe('partial')
    expect(itemOutcome({ answered: true, score: PARTIAL_AT })).toBe('partial')
    expect(itemOutcome({ answered: true, score: PARTIAL_AT - 0.01 })).toBe('wrong')
  })

  it('treats a graded status as answered even without the flag', () => {
    expect(itemOutcome({ status: 'graded', score: 1 })).toBe('correct')
    expect(itemOutcome({ status: 'answered', score: null })).toBe('ungraded')
  })

  it('does not read a broken score as a verdict', () => {
    expect(itemOutcome({ answered: true, score: NaN })).toBe('ungraded')
    expect(itemOutcome({ answered: true, score: undefined })).toBe('ungraded')
  })
})

describe('a run', () => {
  const run = [
    { answered: true, score: 1 },
    { answered: true, score: 1 },
    { answered: true, score: 0 },
    { answered: true, score: null },
    { answered: true, score: null },
    { answered: false, score: null },
  ]

  it('counts all three outcomes, and never invents a denominator', () => {
    const t = tallyQuiz(run)
    expect(t).toMatchObject({ correct: 2, wrong: 1, ungraded: 2, unanswered: 1, total: 6 })
    // The only honest denominator, and notably NOT 6.
    expect(t.judged).toBe(3)
  })

  it('is the case that read 17%', () => {
    // Six answered, one paid for and correct. The old screen divided 1 by 6.
    const six = [
      { answered: true, score: 1 },
      ...Array.from({ length: 5 }, () => ({ answered: true, score: null })),
    ]
    const t = tallyQuiz(six)
    expect(t.correct).toBe(1)
    expect(t.judged).toBe(1)
    expect(t.ungraded).toBe(5)
    // A ratio over what was judged is 100%, over what was asked is 17%, and neither sentence
    // is worth saying — which is why the screen now says the three numbers.
  })

  it('says the shortest true thing', () => {
    expect(tallyLine(tallyQuiz([{ answered: true, score: 1 }, { answered: true, score: 0 }])).key)
      .toBe('run.tally.plain')
    expect(tallyLine(tallyQuiz(run)).key).toBe('run.tally.withUngraded')
    expect(tallyLine(tallyQuiz([{ answered: false, score: null }])).key).toBe('run.tally.none')
  })

  it('folds partial in with wrong when summarising, and not when counting', () => {
    // A learner scanning a one-line summary wants "got it / did not". The detail stays
    // available in the tally for the screen that has room for it.
    const t = tallyQuiz([{ answered: true, score: 0.5 }, { answered: true, score: 0 }])
    expect(t.partial).toBe(1)
    expect(tallyLine(t).params.wrong).toBe(2)
  })

  it('is empty-safe', () => {
    expect(tallyQuiz([])).toMatchObject({ judged: 0, total: 0 })
    expect(tallyLine(tallyQuiz([])).key).toBe('run.tally.none')
  })
})
