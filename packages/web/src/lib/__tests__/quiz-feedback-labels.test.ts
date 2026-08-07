/**
 * Every closed-set member a quiz grade can contain has a translated string, in every locale, on
 * both platforms.
 *
 * ## Why this test and not the existing i18n gates
 *
 * `translation-keys.test.ts` proves the eight locales agree with `en`. `i18n-key-usage.test.ts`
 * proves that a key the code asks for exists — but only for STATIC literals, and the screens
 * render these with a computed key:
 *
 *     t(`verdict.${grade.verdict}`)
 *
 * So a verdict with no string is invisible to both: parity holds because it is missing
 * everywhere, and the usage gate never sees the key. It would render as the raw identifier
 * `equivalent_with_error` to a learner, in all eight languages. That is exactly how
 * `today.error.*` shipped absent from every bundle.
 *
 * The second half of the file is the other drift this invites: `quiz-feedback.ts` restates the
 * enums from `supabase/functions/_shared/ai-quiz.ts`, because that file is import-free by design
 * (it is what gets deployed to the edge runtime). A member added there and not here would be
 * dropped silently by the defensive parse and the learner would see a grade with no explanation.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  QUIZ_VERDICTS, QUIZ_GAPS, QUIZ_LEVELS, QUIZ_ASPECTS, QUIZ_FLAWS,
} from '@reeeeecall/shared/lib/quiz-feedback'
import { QUIZ_ERROR_CODES } from '@reeeeecall/shared/stores/quiz-store'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../../../..')
const LOCALES = ['en', 'ko', 'ja', 'zh', 'vi', 'th', 'id', 'es'] as const

const PLATFORMS = [
  { name: 'web', dir: join(ROOT, 'packages/web/public/locales') },
  { name: 'mobile', dir: join(ROOT, 'packages/mobile/src/i18n/locales') },
]

/** family → the members that must exist under it. */
const FAMILIES: Array<[string, readonly string[]]> = [
  ['verdict', QUIZ_VERDICTS],
  ['gap', QUIZ_GAPS],
  ['level', QUIZ_LEVELS],
  ['aspect', QUIZ_ASPECTS],
]

describe('every quiz grade label is translated', () => {
  for (const platform of PLATFORMS) {
    for (const locale of LOCALES) {
      it(`${platform.name}/${locale}`, () => {
        const data = JSON.parse(
          readFileSync(join(platform.dir, locale, 'quiz.json'), 'utf-8'),
        ) as Record<string, Record<string, string>>

        const missing: string[] = []
        for (const [family, members] of FAMILIES) {
          for (const member of members) {
            const value = data[family]?.[member]
            if (typeof value !== 'string' || value.trim() === '') {
              missing.push(`${family}.${member}`)
            }
          }
        }
        // Rendered only when the grader declines part of an essay, which no fixture produces —
        // so it is the single likeliest string to be forgotten.
        if (typeof data.level?.unjudgeableNote !== 'string') missing.push('level.unjudgeableNote')
        for (const side of ['learner', 'reference']) {
          if (typeof data.span?.[side] !== 'string') missing.push(`span.${side}`)
        }
        // Same computed-key hazard, on the path a learner only reaches when something has
        // already gone wrong — so a missing one is doubly unlikely to be noticed in testing.
        for (const code of QUIZ_ERROR_CODES) {
          if (typeof data.error?.[code] !== 'string') missing.push(`error.${code}`)
        }

        expect(missing, `${platform.name}/${locale}/quiz.json is missing computed-key strings`)
          .toEqual([])
      })
    }
  }
})

describe('the render-side enums match the edge contract', () => {
  const edge = readFileSync(
    join(ROOT, 'supabase/functions/_shared/ai-quiz.ts'), 'utf-8',
  )

  /** Pull `export const NAME = ['a', 'b'] as const` out of the edge module by name. */
  const edgeSet = (name: string): string[] => {
    const match = edge.match(new RegExp(`export const ${name} = \\[([^\\]]*)\\] as const`, 's'))
    if (!match) throw new Error(`${name} not found in ai-quiz.ts`)
    return [...match[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1])
  }

  it.each([
    ['SHORT_ANSWER_VERDICTS', QUIZ_VERDICTS],
    ['SHORT_ANSWER_GAPS', QUIZ_GAPS],
    ['ESSAY_LEVELS', QUIZ_LEVELS],
    ['ESSAY_ASPECTS', QUIZ_ASPECTS],
    ['MCQ_DISTRACTOR_FLAWS', QUIZ_FLAWS],
  ])('%s', (edgeName, renderSet) => {
    // Sorted: the order the model is offered them in is a prompt decision, not a contract.
    expect([...renderSet].sort()).toEqual(edgeSet(edgeName).sort())
  })
})
