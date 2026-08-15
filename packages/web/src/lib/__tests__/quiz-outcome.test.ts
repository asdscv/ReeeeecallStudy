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
  itemOutcome, tallyQuiz, tallyLine, minCardsForMcq, tallyFromCounts, dateLine, calendarParts, isRunUnfinished,
  CORRECT_AT, PARTIAL_AT,
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

/**
 * How few cards a multiple-choice quiz really needs.
 *
 * Both setup screens hardcoded 4, with the comment "multiple choice needs three other cards to
 * draw plausible distractors from" — true of the easiest band and of nothing else. The model
 * writes the near-misses; the FAR slots come from other answers in the deck, because a model
 * asked for a deliberately unrelated wrong answer returns a near-miss at every phrasing. So the
 * number of deck-mates required is the number of far slots, which is what the band says.
 */
describe('the multiple-choice minimum', () => {
  const band = (near_max: number, option_count = 4) => ({ near_max, option_count })

  it('follows the band instead of asserting four', () => {
    // Production's three bands, in order. Only the easiest one ever needed 4.
    expect(minCardsForMcq(band(0))).toBe(4)   // all three distractors far
    expect(minCardsForMcq(band(1))).toBe(3)   // two far
    expect(minCardsForMcq(band(3))).toBe(1)   // the model writes every one
  })

  it('lets a six-card deck make a hard quiz', () => {
    // The case that found this: 6 quizzable cards, refused for deck-mates it did not need.
    expect(minCardsForMcq(band(3))).toBeLessThanOrEqual(6)
  })

  it('follows option_count too, so a band is a row rather than an edit', () => {
    expect(minCardsForMcq(band(0, 6))).toBe(6)
    expect(minCardsForMcq(band(2, 6))).toBe(4)
  })

  it('clamps a nonsense band rather than blocking or admitting everything', () => {
    expect(minCardsForMcq(band(0, 99))).toBe(6)
    expect(minCardsForMcq(band(0, 0))).toBe(2)
    expect(minCardsForMcq(band(99))).toBe(1)
    expect(minCardsForMcq(band(-3))).toBe(4)
  })

  it('assumes the shipped default when no band is resolved yet', () => {
    // The screens ask for bands asynchronously; before they arrive the gate must not be either
    // "block everything" or "let anything through".
    expect(minCardsForMcq(null)).toBe(4)
    expect(minCardsForMcq(undefined)).toBe(4)
    expect(minCardsForMcq({})).toBe(4)
  })
})

/**
 * The set list's history line — dates and the counts beside them.
 *
 * Both come from the server: `_quiz_run_tally` (migration 225) totals a sitting from
 * `answer_attempts` with the same 0.75 band this file defines, so a run cannot read one way on
 * the result screen and another in the history list.
 */
describe('a sitting, as the server counted it', () => {
  it('reads the server shape through the same summary the screens use', () => {
    const t = tallyFromCounts({ total: 6, answered: 6, correct: 4, wrong: 1, ungraded: 1 })
    expect(t).toMatchObject({ correct: 4, wrong: 1, ungraded: 1, unanswered: 0, judged: 5, total: 6 })
    expect(tallyLine(t).key).toBe('run.tally.withUngraded')
  })

  it('counts what was never answered as unanswered, not wrong', () => {
    // A run abandoned halfway is not a run of wrong answers, and `score_raw / score_max` — the
    // arithmetic that reported 17% — is exactly the sum that says it is.
    const t = tallyFromCounts({ total: 10, answered: 3, correct: 3, wrong: 0, ungraded: 0 })
    expect(t.unanswered).toBe(7)
    expect(t.wrong).toBe(0)
    expect(t.judged).toBe(3)
  })

  it('survives a missing or malformed tally', () => {
    expect(tallyFromCounts(null)).toMatchObject({ total: 0, judged: 0 })
    expect(tallyFromCounts({ total: -5, answered: 99, correct: NaN, wrong: 1, ungraded: 0 } as never))
      .toMatchObject({ total: 0, correct: 0, unanswered: 0 })
  })
})

describe('dating a set without Intl', () => {
  const now = new Date('2026-08-15T00:00:00Z')

  it('drops the year inside the current one', () => {
    // "2026년 8월 15일" on every row is noise; "8월 15일" is what a learner reads it as.
    expect(dateLine('2026-03-02T10:00:00Z', now))
      .toEqual({ key: 'history.dateThisYear', params: { m: 3, d: 2 } })
  })

  it('keeps the year when it is a different one', () => {
    expect(dateLine('2025-12-31T10:00:00Z', now))
      .toEqual({ key: 'history.dateWithYear', params: { y: 2025, m: 12, d: 31 } })
  })

  it('returns parts and a key, never a formatted string', () => {
    // The whole point. `toLocaleDateString` on Hermes has no ICU and returns the same English
    // on every device, so the ORDER has to live in the locale files.
    const line = dateLine('2026-08-15T10:00:00Z', now)
    expect(typeof line?.key).toBe('string')
    expect(Object.values(line!.params).every((v) => typeof v === 'number')).toBe(true)
  })

  it('is null rather than "Invalid Date" on junk', () => {
    expect(dateLine('not a date', now)).toBeNull()
    expect(calendarParts('', now)).toBeNull()
  })
})

describe('a run that was never formally finished', () => {
  it('is only "in progress" while answers are actually missing', () => {
    // `quiz_runs.status` stays `in_progress` until `finish_quiz_run` is called, and nothing
    // makes a learner call it — they answer the last question and leave. The history list was
    // reporting "진행 중" for runs whose every answer was already in, hiding the result.
    expect(isRunUnfinished('in_progress', { total: 4, answered: 4, correct: 2, wrong: 2, ungraded: 0 }))
      .toBe(false)
    expect(isRunUnfinished('in_progress', { total: 4, answered: 1, correct: 1, wrong: 0, ungraded: 0 }))
      .toBe(true)
  })

  it('never calls a completed or abandoned run in progress', () => {
    expect(isRunUnfinished('completed', { total: 4, answered: 1, correct: 1, wrong: 0, ungraded: 0 }))
      .toBe(false)
    expect(isRunUnfinished('abandoned', { total: 4, answered: 0, correct: 0, wrong: 0, ungraded: 0 }))
      .toBe(false)
    expect(isRunUnfinished(null, null)).toBe(false)
  })
})
