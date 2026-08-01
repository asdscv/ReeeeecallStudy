/**
 * card-answer — which field of a card is the ANSWER.
 *
 * The reason every case here is a `null` case rather than a fallback: this function's output is
 * meant to become the reference a paid AI comparison is graded against. A wrong reference does
 * not degrade the feature, it inverts it — the learner is told they were wrong for writing the
 * right thing. So "we cannot tell" has to be expressible, and has to be the default.
 *
 * The fixtures are the REAL templates: the official word template (mig 089) in both
 * orientations, and the seeded 중국어 단어 template (mig 001) whose back_layout genuinely
 * contains an audio field.
 */
import { describe, expect, it } from 'vitest'
import { resolveCardAnswerFaces, cardReferenceAnswer } from '@reeeeecall/shared/lib/card-answer'
import type { Card, CardTemplate } from '@reeeeecall/shared/types/database'

const template = (over: Partial<CardTemplate> = {}): CardTemplate => ({
  id: 'tpl-1', user_id: 'user-1', name: 'T',
  fields: [
    { key: 'front', name: 'Front', type: 'text', order: 0 },
    { key: 'back', name: 'Back', type: 'text', order: 1 },
  ],
  front_layout: [{ field_key: 'front', style: 'primary' }],
  back_layout: [{ field_key: 'back', style: 'primary' }],
  created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
  ...over,
} as CardTemplate)

const card = (field_values: Record<string, string>) => ({ field_values }) as Pick<Card, 'field_values'>

describe('resolveCardAnswerFaces', () => {
  it('reads the faces the template author declared', () => {
    const faces = resolveCardAnswerFaces(template(), card({ front: 'apple', back: '사과' }))

    expect(faces).toEqual({ promptKeys: ['front'], referenceKeys: ['back'] })
  })

  it('follows the declaration when the deck is reversed, not the key order', () => {
    // The whole point. jsonb returns keys shortest-then-bytewise, so `{ front, back }` arrives
    // as `{ back, front }` and a positional guess takes the ANSWER as the question. A reversed
    // template declares the opposite faces, and only the declaration can tell the two apart.
    const reversed = template({
      front_layout: [{ field_key: 'back', style: 'primary' }],
      back_layout: [{ field_key: 'front', style: 'primary' }],
    })

    expect(resolveCardAnswerFaces(reversed, card({ front: 'apple', back: '사과' })))
      .toEqual({ promptKeys: ['back'], referenceKeys: ['front'] })
  })

  it('carries every declared answer field, in layout order', () => {
    // The official word template answers with the word AND its example sentence (mig 089).
    const official = template({
      fields: [
        { key: 'front', name: 'Front', type: 'text', order: 0 },
        { key: 'back', name: 'Back', type: 'text', order: 1 },
        { key: 'example_front', name: 'Front Example', type: 'text', order: 2 },
        { key: 'example_back', name: 'Back Example', type: 'text', order: 3 },
      ],
      front_layout: [
        { field_key: 'front', style: 'primary' }, { field_key: 'example_front', style: 'detail' },
      ],
      back_layout: [
        { field_key: 'back', style: 'primary' }, { field_key: 'example_back', style: 'detail' },
      ],
    })
    const row = card({
      front: 'apple', back: '사과', example_front: 'I ate an apple.', example_back: '사과를 먹었다.',
    })

    expect(resolveCardAnswerFaces(official, row)?.referenceKeys).toEqual(['back', 'example_back'])
    expect(cardReferenceAnswer(official, row)).toBe('사과 / 사과를 먹었다.')
  })

  // ── the null cases: every one of these would otherwise be a wrong reference ──

  it('refuses when there is no template at all', () => {
    expect(resolveCardAnswerFaces(null, card({ front: 'a', back: 'b' }))).toBeNull()
    expect(resolveCardAnswerFaces(undefined, card({ front: 'a', back: 'b' }))).toBeNull()
  })

  it('refuses an empty back_layout — the column default, so this is the common case', () => {
    expect(resolveCardAnswerFaces(template({ back_layout: [] }), card({ front: 'a', back: 'b' })))
      .toBeNull()
  })

  it('refuses when the layout names a field the card does not have', () => {
    // Templates are edited after cards are written; a stale key must not silently resolve to
    // whatever else is lying around.
    expect(resolveCardAnswerFaces(template(), card({ front: 'a', meaning: 'b' }))).toBeNull()
  })

  it('refuses when the declared answer is present but blank', () => {
    expect(resolveCardAnswerFaces(template(), card({ front: 'a', back: '   ' }))).toBeNull()
  })

  it('refuses a non-text answer field', () => {
    // The seeded 중국어 단어 template really does put an audio field in back_layout. You cannot
    // compare typed words against a sound file.
    const withAudio = template({
      fields: [
        { key: 'front', name: '단어', type: 'text', order: 0 },
        { key: 'sound', name: '발음', type: 'audio', order: 1 },
      ],
      back_layout: [{ field_key: 'sound', style: 'media' }],
    })

    expect(resolveCardAnswerFaces(withAudio, card({ front: '苹果', sound: 'a.mp3' }))).toBeNull()
  })

  it('refuses a partly-text answer rather than silently dropping the rest', () => {
    // Answering with the word AND its audio is a different task from answering with the word.
    // Filtering to the text half would quietly change what the learner is being asked to do.
    const mixed = template({
      fields: [
        { key: 'front', name: '단어', type: 'text', order: 0 },
        { key: 'back', name: '뜻', type: 'text', order: 1 },
        { key: 'sound', name: '발음', type: 'audio', order: 2 },
      ],
      back_layout: [
        { field_key: 'back', style: 'primary' }, { field_key: 'sound', style: 'media' },
      ],
    })

    expect(resolveCardAnswerFaces(mixed, card({ front: '苹果', back: '사과', sound: 'a.mp3' })))
      .toBeNull()
  })

  it('refuses when a field is on both faces — the answer would be the question', () => {
    const overlapping = template({
      back_layout: [{ field_key: 'front', style: 'primary' }, { field_key: 'back', style: 'detail' }],
    })

    expect(resolveCardAnswerFaces(overlapping, card({ front: 'a', back: 'b' }))).toBeNull()
  })

  it('never returns the prompt as the reference, on any input', () => {
    // The invariant the whole file protects, asserted directly rather than inferred from the
    // cases above.
    const inputs: Array<[CardTemplate | null, Record<string, string>]> = [
      [template(), { front: 'a', back: 'b' }],
      [template({ back_layout: [] }), { front: 'a' }],
      [template(), { front: 'only' }],
      [null, { front: 'a', back: 'b' }],
    ]

    for (const [tpl, values] of inputs) {
      const faces = resolveCardAnswerFaces(tpl, card(values))
      if (!faces) continue
      expect(faces.referenceKeys.some((key) => faces.promptKeys.includes(key))).toBe(false)
    }
  })
})
