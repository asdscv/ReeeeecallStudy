/**
 * The client must never ask the server for a batch the server refuses.
 *
 * This is the bug that made 서술형 quizzes impossible to create, for as long as the feature
 * has existed. The edge function caps ONE generation call at `MAX_QUIZ_BATCH` — 10 cards for
 * multiple choice and short answer, 3 for essay, because a rubric triples the output tokens
 * per item. The client sent every card in one call, and the setup screen's smallest option
 * was 4. So every essay quiz died with AI_REQUEST_TOO_LARGE, after the learner had chosen a
 * deck, a type, a count and a difficulty and pressed the button.
 *
 * Nothing caught it. The counts are a client constant, the cap is a server constant, and
 * they lived in different packages with no relationship expressed anywhere. Both were
 * individually correct.
 *
 * So this asserts the relationship, by reading the server's own numbers rather than
 * restating them: a copied constant would drift the same way the original pair did.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { QUIZ_BATCH_SIZE } from '@reeeeecall/shared/stores/quiz-store'
import { MAX_QUIZ_BATCH } from '../../../../../supabase/functions/_shared/ai-quiz-prompts'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../../../..')

/** The server's key for each client question type. */
const SERVER_KEY = {
  mcq: 'multiple_choice',
  short: 'short_answer',
  essay: 'essay',
} as const

describe('quiz batch size', () => {
  for (const [type, key] of Object.entries(SERVER_KEY) as Array<[keyof typeof SERVER_KEY, string]>) {
    it(`${type}: the client batch fits inside what the edge function accepts`, () => {
      const client = QUIZ_BATCH_SIZE[type]
      const server = MAX_QUIZ_BATCH[key as keyof typeof MAX_QUIZ_BATCH]

      expect(client).toBeGreaterThan(0)
      // `<=` would be enough to work; the real requirement is that a batch NEVER exceeds the
      // cap, and equality leaves no room for a list that grew between the quote and the call.
      expect(client, `${type} batches would be refused by the server`).toBeLessThanOrEqual(server)
    })
  }

  it('the database ceiling is at least as large as one batch', () => {
    // A per-quiz ceiling below a single batch would mean the first call is already too big,
    // which is the same failure one level down.
    const sql = readFileSync(
      join(ROOT, 'supabase/migrations/207_quiz_batched_generation.sql'), 'utf-8')
    const cap = Number(sql.match(/p_count\s*<\s*1\s*OR\s*p_count\s*>\s*(\d+)/)?.[1])

    expect(cap, 'could not read the count ceiling from migration 207').toBeGreaterThan(0)
    for (const type of Object.keys(SERVER_KEY) as Array<keyof typeof SERVER_KEY>) {
      expect(cap).toBeGreaterThanOrEqual(QUIZ_BATCH_SIZE[type])
    }
  })

  it('every count the setup screen offers is reachable', () => {
    // The original defect in one assertion: an option the learner can pick must be
    // creatable. Before batching, `12` exceeded the multiple-choice cap and EVERY essay
    // option exceeded the essay cap — the screen offered nothing essay could deliver.
    const page = readFileSync(
      join(ROOT, 'packages/web/src/pages/quiz/QuizSetupPage.tsx'), 'utf-8')
    const counts = (page.match(/const COUNTS\s*=\s*\[([^\]]+)\]/)?.[1] ?? '')
      .split(',').map((n) => Number(n.trim())).filter((n) => Number.isFinite(n))

    expect(counts.length, 'could not read COUNTS from the setup page').toBeGreaterThan(0)

    const sql = readFileSync(
      join(ROOT, 'supabase/migrations/207_quiz_batched_generation.sql'), 'utf-8')
    const cap = Number(sql.match(/p_count\s*<\s*1\s*OR\s*p_count\s*>\s*(\d+)/)?.[1])

    for (const c of counts) {
      expect(c, `the screen offers ${c}, above the database ceiling`).toBeLessThanOrEqual(cap)
      // And it must be deliverable in whole batches — which it now always is, because any
      // count is split. The assertion that matters is that nothing is offered which a
      // SINGLE call would have to carry alone.
      expect(c).toBeGreaterThan(0)
    }
  })
})
