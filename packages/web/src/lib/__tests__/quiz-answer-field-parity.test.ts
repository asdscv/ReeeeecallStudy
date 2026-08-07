/**
 * The edge copy of the quiz answer-field resolver must agree with the shared one, always.
 *
 * `supabase/functions/_shared/quiz-answer-field.ts` is duplicated rather than imported, for the
 * same reason `card-answer.ts` and `ai-prompts.ts` are: `supabase/functions/` is what gets
 * deployed, and reaching into `packages/` from there makes the deployed bundle depend on a
 * directory that is not part of it.
 *
 * Duplication without a guard is how two answers to the same question drift apart, and here the
 * two answers are worth money. The edge copy decides which field becomes the correct multiple
 * choice option and which text a PAID grading call is judged against; the shared copy decides
 * how many cards the setup screen says are quizzable and therefore what the learner is quoted.
 * A divergence would either charge for a set the server then refuses to build, or grade an
 * answer against a field the learner was never asked for — in production only, where the shared
 * copy's own tests never run.
 */
import { describe, expect, it } from 'vitest'
import {
  resolveQuizCardFaces as sharedResolve,
  quizReferenceAnswer as sharedReference,
  quizPromptText as sharedPrompt,
  quizContextLines as sharedContext,
} from '@reeeeecall/shared/lib/quiz-answer-field'
import {
  resolveQuizCardFaces as edgeResolve,
  quizReferenceAnswer as edgeReference,
  quizPromptText as edgePrompt,
  quizContextLines as edgeContext,
} from '../../../../../supabase/functions/_shared/quiz-answer-field.ts'

const t = (key: string) => ({ key, name: key, type: 'text', order: 0 })

/** Every case the shared module's own tests cover, plus the seeded templates from mig 097. */
const CASES: Array<{
  name: string
  template: unknown
  card: { field_values: Record<string, string> }
}> = [
  {
    name: 'seeded 영어 단어 — three text fields on the back, one primary',
    template: {
      fields: ['field_1', 'field_2', 'field_3', 'field_4'].map(t),
      front_layout: [{ field_key: 'field_1', style: 'primary' }],
      back_layout: [
        { field_key: 'field_2', style: 'primary' },
        { field_key: 'field_3', style: 'hint' },
        { field_key: 'field_4', style: 'detail' },
      ],
    },
    card: {
      field_values: {
        field_1: 'lend', field_2: '빌려주다', field_3: 'tuː lend', field_4: 'He lent me a book.',
      },
    },
  },
  {
    name: 'seeded 중국어 단어 — audio in the back layout',
    template: {
      fields: [...['field_1', 'field_2', 'field_3', 'field_4'].map(t),
        { key: 'field_5', name: '오디오', type: 'audio', order: 4 }],
      front_layout: [{ field_key: 'field_1', style: 'primary' }],
      back_layout: [
        { field_key: 'field_2', style: 'primary' },
        { field_key: 'field_3', style: 'hint' },
        { field_key: 'field_4', style: 'detail' },
        { field_key: 'field_5', style: 'media' },
      ],
    },
    card: {
      field_values: {
        field_1: '借', field_2: '빌리다', field_3: 'jiè', field_4: '我借了一本书。', field_5: 'a.mp3',
      },
    },
  },
  {
    name: 'lone candidate, no primary',
    template: {
      fields: ['a', 'b'].map(t),
      front_layout: [{ field_key: 'a', style: 'primary' }],
      back_layout: [{ field_key: 'b', style: 'secondary' }],
    },
    card: { field_values: { a: 'A', b: 'B' } },
  },
  {
    name: 'two primaries — refused',
    template: {
      fields: ['a', 'b', 'c'].map(t),
      front_layout: [{ field_key: 'a', style: 'primary' }],
      back_layout: [{ field_key: 'b', style: 'primary' }, { field_key: 'c', style: 'primary' }],
    },
    card: { field_values: { a: 'A', b: 'B', c: 'C' } },
  },
  {
    name: 'no primary, two candidates — refused',
    template: {
      fields: ['a', 'b', 'c'].map(t),
      front_layout: [{ field_key: 'a', style: 'primary' }],
      back_layout: [{ field_key: 'b', style: 'hint' }, { field_key: 'c', style: 'detail' }],
    },
    card: { field_values: { a: 'A', b: 'B', c: 'C' } },
  },
  {
    name: 'answer also on the front — refused',
    template: {
      fields: ['a', 'b'].map(t),
      front_layout: [{ field_key: 'a', style: 'primary' }, { field_key: 'b', style: 'detail' }],
      back_layout: [{ field_key: 'b', style: 'primary' }],
    },
    card: { field_values: { a: 'A', b: 'B' } },
  },
  {
    name: 'blank primary demotes to the remaining candidate',
    template: {
      fields: ['a', 'b', 'c'].map(t),
      front_layout: [{ field_key: 'a', style: 'primary' }],
      back_layout: [{ field_key: 'b', style: 'primary' }, { field_key: 'c', style: 'hint' }],
    },
    card: { field_values: { a: 'A', b: '   ', c: 'C' } },
  },
  {
    name: 'audio front — refused',
    template: {
      fields: [{ key: 'a', name: 'a', type: 'audio', order: 0 }, t('b')],
      front_layout: [{ field_key: 'a', style: 'primary' }],
      back_layout: [{ field_key: 'b', style: 'primary' }],
    },
    card: { field_values: { a: 'a.mp3', b: 'B' } },
  },
  {
    name: 'duplicate layout entry, first occurrence wins',
    template: {
      fields: ['a', 'b'].map(t),
      front_layout: [{ field_key: 'a', style: 'primary' }, { field_key: 'a', style: 'detail' }],
      back_layout: [{ field_key: 'b', style: 'primary' }, { field_key: 'b', style: 'hint' }],
    },
    card: { field_values: { a: 'A', b: 'B' } },
  },
  {
    name: 'empty back layout',
    template: {
      fields: ['a', 'b'].map(t),
      front_layout: [{ field_key: 'a', style: 'primary' }],
      back_layout: [],
    },
    card: { field_values: { a: 'A', b: 'B' } },
  },
]

describe('shared and edge quiz resolvers agree', () => {
  for (const { name, template, card } of CASES) {
    it(name, () => {
      /* eslint-disable @typescript-eslint/no-explicit-any */
      expect(edgeResolve(template as any, card)).toEqual(sharedResolve(template as any, card))
      expect(edgeReference(template as any, card)).toEqual(sharedReference(template as any, card))
      expect(edgePrompt(template as any, card)).toEqual(sharedPrompt(template as any, card))
      expect(edgeContext(template as any, card)).toEqual(sharedContext(template as any, card))
      /* eslint-enable @typescript-eslint/no-explicit-any */
    })
  }

  it('agrees on a missing template', () => {
    const card = { field_values: { a: 'A' } }

    expect(edgeResolve(null, card)).toEqual(sharedResolve(null, card))
    expect(edgeResolve(undefined, card)).toEqual(sharedResolve(undefined, card))
    expect(edgeContext(null, card)).toEqual(sharedContext(null, card))
  })
})
