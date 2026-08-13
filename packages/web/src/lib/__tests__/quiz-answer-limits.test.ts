/**
 * The learner must be told the limit BEFORE they write past it.
 *
 * The server has always refused an over-length answer, and rightly — grading the first 2,000
 * characters of a 4,000-character essay grades an essay the learner did not write. But nothing
 * on either platform showed a counter, a maxLength, or the number. Measured against production:
 * a 3,000-character essay answer comes back QUIZ_UNGRADEABLE, charged 0, after the learner has
 * written all three thousand characters and pressed 채점. The message they get —
 * "이 답안은 채점할 수 없어요. 비어 있거나 너무 길어요." — covers two opposite problems at once.
 *
 * The first test here is the one that matters: the client's numbers are read back out of the
 * SERVER's file, so a copied constant cannot drift. `quiz-batch-size.test.ts` does the same
 * thing, and exists because a client count and a server cap once lived in separate packages
 * with no relationship expressed, both individually correct, while the feature was broken.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  MAX_ANSWER_CHARS, MIN_ANSWER_CHARS, answerLength,
} from '@reeeeecall/shared/lib/quiz-answer-limits'

const here = dirname(fileURLToPath(import.meta.url))
const serverFile = join(here, '../../../../../supabase/functions/_shared/ai-quiz.ts')

/** Pull a `{ short_answer: N, essay: M }` block out of the server source. */
function serverLimits(constName: string): { short: number; essay: number } {
  const src = readFileSync(serverFile, 'utf8')
  const block = new RegExp(constName + '[^{]*\\{([^}]*)\\}').exec(src)
  if (!block) throw new Error(`${constName} not found in the server file`)
  const short = /short_answer:\s*(\d+)/.exec(block[1])
  const essay = /essay:\s*(\d+)/.exec(block[1])
  if (!short || !essay) throw new Error(`could not read ${constName}`)
  return { short: Number(short[1]), essay: Number(essay[1]) }
}

describe('the limits the client shows', () => {
  it('are the limits the server enforces', () => {
    // Read from the server's own source, not restated. A number copied by hand is a number
    // that drifts the next time someone tunes the server.
    const max = serverLimits('MAX_LEARNER_CHARS')
    expect(MAX_ANSWER_CHARS.short).toBe(max.short)
    expect(MAX_ANSWER_CHARS.essay).toBe(max.essay)
  })

  it('agree on the minimum too', () => {
    // Below the minimum the server charges nothing and calls no model — so a learner who is
    // told "40 characters minimum" is being told something true about the money as well.
    const min = serverLimits('MIN_GRADEABLE_CHARS')
    expect(MIN_ANSWER_CHARS.short).toBe(min.short)
    expect(MIN_ANSWER_CHARS.essay).toBe(min.essay)
  })
})

describe('what the learner is told while typing', () => {
  it('says nothing is wrong with an empty box', () => {
    // An empty field is a starting state, not a mistake. Showing "too short" before a single
    // character is typed is nagging.
    const r = answerLength('', 'essay')
    expect(r.state).toBe('empty')
    expect(r.gradeable).toBe(false)
  })

  it('distinguishes too short from too long', () => {
    // The exact failure of today's message, which says "비어 있거나 너무 길어요" for both.
    expect(answerLength('짧음', 'essay').state).toBe('too_short')
    expect(answerLength('x'.repeat(2001), 'essay').state).toBe('too_long')
  })

  it('accepts the boundary values the server accepts', () => {
    // Off-by-one here means a counter that says "over" on an answer the server would grade.
    expect(answerLength('x'.repeat(2000), 'essay').gradeable).toBe(true)
    expect(answerLength('x'.repeat(40), 'essay').gradeable).toBe(true)
    expect(answerLength('x'.repeat(300), 'short').gradeable).toBe(true)
    expect(answerLength('x', 'short').gradeable).toBe(true)
  })

  it('warns before the ceiling, not at it', () => {
    // A counter that only turns red at the limit tells you after the sentence you were
    // writing is already lost.
    expect(answerLength('x'.repeat(1500), 'essay').state).toBe('ok')
    expect(answerLength('x'.repeat(1750), 'essay').state).toBe('near_limit')
    expect(answerLength('x'.repeat(1999), 'essay').gradeable).toBe(true)
  })

  it('counts what the server counts', () => {
    // The server trims before measuring. A counter that includes trailing whitespace would
    // disagree with the refusal, which is worse than having no counter.
    expect(answerLength('  ' + 'x'.repeat(2000) + '   \n', 'essay').state).not.toBe('too_long')
    expect(answerLength('     ', 'essay').state).toBe('empty')
  })

  it('holds short answers to a much tighter bound', () => {
    // 300 vs 2000 — a learner who writes an essay into a short-answer box needs to find out
    // early, not at 채점.
    expect(answerLength('x'.repeat(301), 'short').state).toBe('too_long')
    expect(answerLength('x'.repeat(301), 'essay').gradeable).toBe(true)
  })
})
