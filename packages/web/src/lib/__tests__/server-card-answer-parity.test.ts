/**
 * The edge copy of the answer resolver must agree with the shared one, always.
 *
 * `supabase/functions/_shared/card-answer.ts` is duplicated rather than imported from
 * `packages/shared`, for the same reason `ai-prompts.ts` is: `supabase/functions/` is what gets
 * deployed, and reaching into `packages/` from there makes the deployed bundle depend on a
 * directory that is not part of it.
 *
 * Duplication without a guard is how two answers to the same question drift apart. This one bites
 * hard on purpose: the server copy decides what a PAID `compare` is graded against, so a
 * divergence would mark a learner's correct answer wrong — and would do it only in production,
 * where the shared copy's own tests never run.
 */
import { describe, expect, it } from 'vitest'
import {
  resolveCardAnswerFaces as sharedResolve,
  cardReferenceAnswer as sharedReference,
} from '@reeeeecall/shared/lib/card-answer'
import {
  resolveCardAnswerFaces as edgeResolve,
  cardReferenceAnswer as edgeReference,
} from '../../../../../supabase/functions/_shared/card-answer.ts'

/** Every case the shared module's own tests cover, plus the official templates. */
const CASES: Array<{ name: string; template: unknown; card: { field_values: Record<string, string> } }> = [
  {
    name: 'plain front/back',
    template: {
      fields: [{ key: 'front', type: 'text' }, { key: 'back', type: 'text' }],
      front_layout: [{ field_key: 'front' }], back_layout: [{ field_key: 'back' }],
    },
    card: { field_values: { front: 'apple', back: '사과' } },
  },
  {
    name: 'official word template, reversed orientation',
    template: {
      fields: [{ key: 'front', type: 'text' }, { key: 'back', type: 'text' }],
      front_layout: [{ field_key: 'back' }], back_layout: [{ field_key: 'front' }],
    },
    card: { field_values: { front: 'apple', back: '사과' } },
  },
  {
    name: 'official word template, both example fields',
    template: {
      fields: [
        { key: 'front', type: 'text' }, { key: 'back', type: 'text' },
        { key: 'example_front', type: 'text' }, { key: 'example_back', type: 'text' },
      ],
      front_layout: [{ field_key: 'front' }, { field_key: 'example_front' }],
      back_layout: [{ field_key: 'back' }, { field_key: 'example_back' }],
    },
    card: { field_values: { front: 'apple', back: '사과', example_front: 'I ate one.', example_back: '하나 먹었다.' } },
  },
  { name: 'no template', template: null, card: { field_values: { front: 'a', back: 'b' } } },
  {
    name: 'empty back_layout (the column default)',
    template: {
      fields: [{ key: 'front', type: 'text' }, { key: 'back', type: 'text' }],
      front_layout: [{ field_key: 'front' }], back_layout: [],
    },
    card: { field_values: { front: 'a', back: 'b' } },
  },
  {
    name: 'layout names a key the card lacks',
    template: {
      fields: [{ key: 'front', type: 'text' }, { key: 'back', type: 'text' }],
      front_layout: [{ field_key: 'front' }], back_layout: [{ field_key: 'back' }],
    },
    card: { field_values: { front: 'a', meaning: 'b' } },
  },
  {
    name: 'blank reference value',
    template: {
      fields: [{ key: 'front', type: 'text' }, { key: 'back', type: 'text' }],
      front_layout: [{ field_key: 'front' }], back_layout: [{ field_key: 'back' }],
    },
    card: { field_values: { front: 'a', back: '   ' } },
  },
  {
    name: 'audio answer (the seeded 중국어 template)',
    template: {
      fields: [{ key: 'front', type: 'text' }, { key: 'sound', type: 'audio' }],
      front_layout: [{ field_key: 'front' }], back_layout: [{ field_key: 'sound' }],
    },
    card: { field_values: { front: '苹果', sound: 'a.mp3' } },
  },
  {
    name: 'partly-text answer',
    template: {
      fields: [{ key: 'front', type: 'text' }, { key: 'back', type: 'text' }, { key: 'sound', type: 'audio' }],
      front_layout: [{ field_key: 'front' }],
      back_layout: [{ field_key: 'back' }, { field_key: 'sound' }],
    },
    card: { field_values: { front: '苹果', back: '사과', sound: 'a.mp3' } },
  },
  {
    name: 'overlapping faces',
    template: {
      fields: [{ key: 'front', type: 'text' }, { key: 'back', type: 'text' }],
      front_layout: [{ field_key: 'front' }],
      back_layout: [{ field_key: 'front' }, { field_key: 'back' }],
    },
    card: { field_values: { front: 'a', back: 'b' } },
  },
]

describe('server/shared card-answer parity', () => {
  it.each(CASES)('agrees on the faces for: $name', ({ template, card }) => {
    expect(edgeResolve(template as never, card as never))
      .toEqual(sharedResolve(template as never, card as never))
  })

  it.each(CASES)('agrees on the reference text for: $name', ({ template, card }) => {
    expect(edgeReference(template as never, card as never))
      .toBe(sharedReference(template as never, card as never))
  })

  it('agrees that a null result is null on both sides, not undefined on one', () => {
    // `toEqual` treats null and undefined as different, but a caller doing `?? fallback` would
    // not — and the server's caller refuses on falsy. Pinned explicitly.
    const unresolvable = CASES.find((c) => c.name === 'no template')!
    expect(edgeResolve(unresolvable.template as never, unresolvable.card as never)).toBeNull()
    expect(sharedResolve(unresolvable.template as never, unresolvable.card as never)).toBeNull()
  })
})
