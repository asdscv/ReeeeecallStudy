/**
 * The question is written in a language the learner can read.
 *
 * ## Why this needs a test at all
 *
 * The rule that governs question language is `Write the question in the same language as
 * the text it quotes` — the CARD decides, not the interface, because a French deck should
 * ask French questions to a learner reading the app in Thai.
 *
 * That rule is complete for a monolingual card and decides NOTHING for a cross-lingual one.
 * `lend / 빌려주다` quotes both languages, so "the language it quotes" has two answers, and
 * a live run served a Korean learner `What is the English word for 갚다?` next to
 * `What is the Korean word for "to let someone off the hook"?` — in one batch, from one
 * deck, because nothing in the prompt broke the tie.
 *
 * The interface language breaks it. Two things about that are easy to get wrong and are
 * what this file pins:
 *
 *   1. The locale must reach ALL THREE generation prompts. The first attempt reached only
 *      short-answer, because the instruction was appended to one rule list rather than to
 *      the shared preamble, and nothing failed.
 *   2. It must name the language. `write the question in "ko"` produced English output from
 *      a real provider call; `write the question in Korean` did not. A BCP-47 tag is what
 *      the database stores, not an instruction a model follows.
 */
import { describe, it, expect } from 'vitest'
import {
  buildMcqGenerationPrompt,
  buildShortAnswerGenerationPrompt,
  buildEssayGenerationPrompt,
} from '../../../../../supabase/functions/_shared/ai-quiz-prompts.ts'

const CARD = {
  itemId: 'set:card:0',
  cardId: 'card',
  promptText: 'lend',
  answerText: '빌려주다',
  extraFields: [] as { key: string; name: string; value: string }[],
}

/** Every builder that writes a question. Grading prompts judge text the learner wrote. */
const BUILDERS = [
  ['mcq', buildMcqGenerationPrompt],
  ['short', buildShortAnswerGenerationPrompt],
  ['essay', buildEssayGenerationPrompt],
] as const

/** The eight interface languages, and the name each must be referred to by. */
const LOCALES: Array<[string, string]> = [
  ['en', 'English'], ['ko', 'Korean'], ['ja', 'Japanese'], ['zh', 'Chinese'],
  ['vi', 'Vietnamese'], ['th', 'Thai'], ['id', 'Indonesian'], ['es', 'Spanish'],
]

describe('the question is written in a language the learner reads', () => {
  for (const [kind, build] of BUILDERS) {
    for (const [locale, name] of LOCALES) {
      it(`${kind} names ${name} for "${locale}"`, () => {
        const { systemPrompt } = build([CARD], undefined, locale)
        expect(systemPrompt).toContain(name)
        // The tag itself must NOT be what the model is asked to write in — that is the
        // exact instruction a real provider ignored.
        expect(systemPrompt).not.toContain(`write the question in "${locale}"`)
      })
    }

    it(`${kind} still defers to the card, not the interface`, () => {
      const { systemPrompt } = build([CARD], undefined, 'ko')
      // The card-decides rule has to survive alongside the tie-breaker, or a Thai learner
      // studying a French deck gets Thai questions about French words.
      expect(systemPrompt).toContain('same language as the text it quotes')
      expect(systemPrompt).toContain('cross-lingual')
      // And the tie-breaker must never license translating the material itself.
      expect(systemPrompt).toContain("Never translate the card's own words")
    })

    it(`${kind} says nothing about language when the locale is unknown`, () => {
      // A locale we do not have a name for must produce no instruction rather than a
      // half-written one — an empty language sentence is worse than none.
      const { systemPrompt } = build([CARD], undefined, 'xx')
      expect(systemPrompt).not.toContain('LANGUAGE:')
    })
  }

  it('handles a regional tag', () => {
    // `i18n.language` is what the client sends, and it is `zh-CN` / `es-419` as often as
    // it is a bare code.
    const { systemPrompt } = buildShortAnswerGenerationPrompt([CARD], undefined, 'zh-CN')
    expect(systemPrompt).toContain('Chinese')
  })
})
