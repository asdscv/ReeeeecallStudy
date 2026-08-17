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
  QUIZ_VERDICTS, QUIZ_GAPS, QUIZ_LEVELS, QUIZ_ASPECTS, QUIZ_FLAWS, QUIZ_MCQ_AXES,
} from '@reeeeecall/shared/lib/quiz-feedback'
import {
  QUIZ_ERROR_CODES, QUIZ_GENERATE_ACTION, QUIZ_FEEDBACK_REASONS,
} from '@reeeeecall/shared/stores/quiz-store'

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
  // Rendered after answering, to explain why an option was wrong.
  ['flaw', QUIZ_FLAWS],
  // What the paid multiple-choice explanation says. Computed key, like every family here, and
  // the one a learner has actually spent money to read — a missing string would show them the
  // bare identifier `right_category_wrong_item` in exchange for a charge.
  ['mcqAxis', QUIZ_MCQ_AXES],
]

/**
 * Difficulty bands are ROWS, not an enum — adding one is an INSERT. Their labels are still
 * `t('difficulty.' || level)`, so a band shipped without translations would render a bare
 * number. The seeded levels are 1..3; this asserts a label and a hint for each, and the same
 * for any level added later, by reading the migration rather than hardcoding the list.
 */
const SEEDED_LEVELS = (() => {
  const sql = readFileSync(join(ROOT, 'supabase/migrations/197_quiz_difficulty.sql'), 'utf-8')
  const block = sql.match(/INSERT INTO public\.quiz_difficulty_levels[^;]*;/s)
  if (!block) throw new Error('difficulty seed block not found in 197')
  return [...block[0].matchAll(/\(\s*(\d+),\s*\d+,\s*\d+\s*\)/g)].map((m) => m[1])
})()

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
        // 문항 평가의 이유. `t(\`rate.reason.${reason}\`)` — 계산된 키이고, 서버의 CHECK 가
        // 진짜 목록입니다(mig 253). 번역이 없으면 학습자가 `options_confusing` 이라는 날
        // 문자열을 칩으로 보게 됩니다.
        for (const reason of QUIZ_FEEDBACK_REASONS) {
          const value = (data.rate as unknown as { reason?: Record<string, string> } | undefined)?.reason?.[reason]
          if (typeof value !== 'string' || value.trim() === '') missing.push(`rate.reason.${reason}`)
        }
        for (const key of ['prompt', 'good', 'bad']) {
          if (typeof (data.rate as unknown as Record<string, string> | undefined)?.[key] !== 'string') {
            missing.push(`rate.${key}`)
          }
        }
        for (const side of ['learner', 'reference']) {
          if (typeof data.span?.[side] !== 'string') missing.push(`span.${side}`)
        }
        // Same computed-key hazard, on the path a learner only reaches when something has
        // already gone wrong — so a missing one is doubly unlikely to be noticed in testing.
        for (const code of QUIZ_ERROR_CODES) {
          if (typeof data.error?.[code] !== 'string') missing.push(`error.${code}`)
        }
        // The generic fallback is what makes a hundred bands possible without a hundred
        // translations: an unnamed band renders "Level 7". Without it, inserting a band shows
        // a learner a bare number in every language.
        if (typeof data.difficulty?.generic !== 'string') missing.push('difficulty.generic')
        // The seeded bands are the ones we chose to name; a new one may rely on the fallback.
        for (const lvl of SEEDED_LEVELS) {
          if (typeof data.difficulty?.[lvl] !== 'string') missing.push(`difficulty.${lvl}`)
          // The HINT is per question type, not per band: since mig 202 a band carries separate
          // guidance for mcq / short / essay, and "the wrong options come from somewhere else"
          // is meaningless on an essay. The screens render `difficultyHint.<type>.<level>`.
          // The type list comes from the map the setup screen itself indexes, so a fourth
          // question type cannot be added without this failing.
          for (const type of Object.keys(QUIZ_GENERATE_ACTION)) {
            const hint = (data.difficultyHint as unknown as
              Record<string, Record<string, string>> | undefined)?.[type]?.[lvl]
            if (typeof hint !== 'string' || hint.trim() === '') {
              missing.push(`difficultyHint.${type}.${lvl}`)
            }
          }
        }

        expect(missing, `${platform.name}/${locale}/quiz.json is missing computed-key strings`)
          .toEqual([])
      })
    }
  }
})

describe('평가 이유는 서버의 CHECK 와 같아야 한다', () => {
  // 이 목록의 진짜 출처는 마이그레이션 253 의 CHECK 입니다. 클라이언트가 더 많이 알면 서버가
  // 거절하는 이유를 칩으로 내놓고, 적게 알면 학습자가 고를 수 없는 이유가 생깁니다.
  it('mig 253', () => {
    const sql = readFileSync(
      join(ROOT, 'supabase/migrations/253_the_learner_can_say_the_question_was_bad.sql'), 'utf-8')
    const block = sql.match(/reason\s+text CHECK \(reason IS NULL OR reason IN \(([\s\S]*?)\)\)/)
    if (!block) throw new Error('reason CHECK not found in migration 253')
    const server = [...block[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1])
    expect([...QUIZ_FEEDBACK_REASONS].sort()).toEqual(server.sort())
  })
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
    ['MCQ_EXPLANATION_AXES', QUIZ_MCQ_AXES],
  ])('%s', (edgeName, renderSet) => {
    // Sorted: the order the model is offered them in is a prompt decision, not a contract.
    expect([...renderSet].sort()).toEqual(edgeSet(edgeName).sort())
  })
})
