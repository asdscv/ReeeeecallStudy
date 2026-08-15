/**
 * resolveQuizCardFaces — which single field a quiz grades.
 *
 * The templates below are the SEEDED ones, copied from migration 097, because the whole reason
 * this module exists is what the existing resolver does to them. 영어 단어 declares a back of
 * [Meaning primary, Pronunciation hint, Example detail]; 중국어 단어 adds an audio field to that
 * back. Those two shapes are between them the source of every case here.
 */
import { describe, it, expect } from 'vitest'
import { resolveQuizCardFaces, quizReferenceAnswer, quizPromptText } from '@reeeeecall/shared/lib/quiz-answer-field'
import { resolveCardAnswerFaces, cardReferenceAnswer } from '@reeeeecall/shared/lib/card-answer'

const text = (key: string, order: number) => ({ key, name: key, type: 'text' as const, order })

/** 영어 단어, migration 097 verbatim. */
const EN = {
  fields: [text('field_1', 0), text('field_2', 1), text('field_3', 2), text('field_4', 3)],
  front_layout: [{ field_key: 'field_1', style: 'primary' as const }],
  back_layout: [
    { field_key: 'field_2', style: 'primary' as const },
    { field_key: 'field_3', style: 'hint' as const },
    { field_key: 'field_4', style: 'detail' as const },
  ],
}

/** 중국어 단어, migration 097 verbatim — note the audio field in the BACK layout. */
const ZH = {
  fields: [...EN.fields, { key: 'field_5', name: '오디오', type: 'audio' as const, order: 4 }],
  front_layout: EN.front_layout,
  back_layout: [...EN.back_layout, { field_key: 'field_5', style: 'media' as const }],
}

const EN_CARD = {
  field_values: {
    field_1: 'lend', field_2: '빌려주다', field_3: 'tuː lend', field_4: 'He lent me a book.',
  },
}
const ZH_CARD = {
  field_values: {
    field_1: '借', field_2: '빌리다', field_3: 'jiè', field_4: '我借了一本书。', field_5: 'a.mp3',
  },
}

describe('the graded field is one field, not the whole back', () => {
  it('grades only the primary field of a seeded English card', () => {
    const faces = resolveQuizCardFaces(EN, EN_CARD)

    expect(faces).toEqual({
      promptKeys: ['field_1'],
      answerKey: 'field_2',
      contextKeys: ['field_3', 'field_4'],
    })
    expect(quizReferenceAnswer(EN, EN_CARD)).toBe('빌려주다')
  })

  it('differs from cardReferenceAnswer on exactly the card that matters', () => {
    // This is the defect being fixed, stated as an equality. The existing resolver hands back a
    // three-part string: grading a correct one-word answer against it marks the learner wrong,
    // and four choices built from it contain the answer and are pickable by length alone.
    expect(cardReferenceAnswer(EN, EN_CARD)).toBe('빌려주다 / tuː lend / He lent me a book.')
    expect(quizReferenceAnswer(EN, EN_CARD)).toBe('빌려주다')
  })

  it('keeps a card the existing resolver throws away', () => {
    // 중국어 단어 puts audio in back_layout, so resolveCardAnswerFaces nulls the entire card and
    // that template's decks would have zero quizzable cards. The audio sits beside the answer;
    // it is not the answer, and it changes nothing about what the learner must produce.
    expect(resolveCardAnswerFaces(ZH, ZH_CARD)).toBeNull()

    expect(resolveQuizCardFaces(ZH, ZH_CARD)).toEqual({
      promptKeys: ['field_1'],
      answerKey: 'field_2',
      contextKeys: ['field_3', 'field_4'],
    })
  })
})

describe('it refuses rather than guesses', () => {
  const card = { field_values: { a: 'A', b: 'B', c: 'C' } }
  const fields = [text('a', 0), text('b', 1), text('c', 2)]
  const front = [{ field_key: 'a', style: 'primary' as const }]

  it('accepts a lone candidate even with no primary', () => {
    // Not a guess: one text field on the back is the answer by elimination.
    const faces = resolveQuizCardFaces(
      { fields, front_layout: front, back_layout: [{ field_key: 'b', style: 'secondary' }] },
      card,
    )

    expect(faces?.answerKey).toBe('b')
    expect(faces?.contextKeys).toEqual([])
  })

  it('refuses when the author declared two answers', () => {
    expect(resolveQuizCardFaces({
      fields,
      front_layout: front,
      back_layout: [{ field_key: 'b', style: 'primary' }, { field_key: 'c', style: 'primary' }],
    }, card)).toBeNull()
  })

  it('refuses when nothing is primary and there is more than one candidate', () => {
    // Layout order is not a declaration. Taking the first would be the positional guess that
    // card-answer.ts exists to refuse.
    expect(resolveQuizCardFaces({
      fields,
      front_layout: front,
      back_layout: [{ field_key: 'b', style: 'hint' }, { field_key: 'c', style: 'detail' }],
    }, card)).toBeNull()
  })

  it('refuses when the answer is also on the front', () => {
    expect(resolveQuizCardFaces({
      fields,
      front_layout: [{ field_key: 'a', style: 'primary' }, { field_key: 'b', style: 'detail' }],
      back_layout: [{ field_key: 'b', style: 'primary' }],
    }, card)).toBeNull()
  })

  it('refuses with no text on the front, and with no text on the back', () => {
    const audioFront = [{ key: 'a', name: 'a', type: 'audio' as const, order: 0 }, text('b', 1)]

    expect(resolveQuizCardFaces({
      fields: audioFront,
      front_layout: front,
      back_layout: [{ field_key: 'b', style: 'primary' }],
    }, card)).toBeNull()

    expect(resolveQuizCardFaces({
      fields: [text('a', 0), { key: 'b', name: 'b', type: 'audio' as const, order: 1 }],
      front_layout: front,
      back_layout: [{ field_key: 'b', style: 'primary' }],
    }, card)).toBeNull()
  })

  it('treats a blank value as absent', () => {
    // A primary field declared but left empty is not an answer, and the lone-candidate rule must
    // not then promote a hint into the answer slot either.
    expect(resolveQuizCardFaces({
      fields,
      front_layout: front,
      back_layout: [{ field_key: 'b', style: 'primary' }, { field_key: 'c', style: 'hint' }],
    }, { field_values: { a: 'A', b: '   ', c: 'C' } })?.answerKey).toBe('c')

    expect(resolveQuizCardFaces({
      fields,
      front_layout: front,
      back_layout: [{ field_key: 'b', style: 'primary' }],
    }, { field_values: { a: 'A', b: '' } })).toBeNull()
  })

  it('survives a missing template and a missing layout', () => {
    expect(resolveQuizCardFaces(null, card)).toBeNull()
    expect(resolveQuizCardFaces(undefined, card)).toBeNull()
    expect(quizReferenceAnswer(null, card)).toBeNull()
    expect(resolveQuizCardFaces(
      { fields, front_layout: front, back_layout: [] }, card,
    )).toBeNull()
  })
})

/**
 * "너 그 드라마 봤어? 완전 빠졌어 / 드라마 추천"
 *
 * Photographed from the app. The official bilingual template's front is
 * [front/primary, situation/hint], and the stem was built by joining every non-empty front text
 * field with ' / ' — so a hint field meant to sit beside the question ended up inside it. Every
 * question on every official conversation deck read this way.
 *
 * Two things wrong with it at once: it reads like a rendering bug, and `situation` is the
 * CATEGORY, so the learner is handed the topic of the sentence they are being asked to produce.
 */
describe('the question stem', () => {
  const template = {
    fields: [
      { key: 'front', type: 'text' }, { key: 'situation', type: 'text' },
      { key: 'back', type: 'text' }, { key: 'note', type: 'text' },
    ],
    front_layout: [
      { field_key: 'front', style: 'primary' },
      { field_key: 'situation', style: 'hint' },
    ],
    back_layout: [
      { field_key: 'back', style: 'primary' },
      { field_key: 'note', style: 'detail' },
    ],
  }
  const card = {
    field_values: {
      front: '너 그 드라마 봤어? 완전 빠졌어',
      situation: '드라마 추천',
      back: "Have you watched that drama? I'm totally hooked.",
      note: 'hooked = 푹 빠진',
    },
  }

  it('asks only the primary front field', () => {
    expect(quizPromptText(template as never, card as never))
      .toBe('너 그 드라마 봤어? 완전 빠졌어')
  })

  it('does not leak the hint field into the question', () => {
    // The exact regression. A hint is context beside the question, never part of it.
    expect(quizPromptText(template as never, card as never)).not.toContain('드라마 추천')
    expect(quizPromptText(template as never, card as never)).not.toContain(' / ')
  })

  it('still uses the whole front when nothing is declared primary', () => {
    // With no primary there is no declaration to honour, and dropping fields would silently
    // narrow the question on templates that legitimately ask with two fields.
    const undeclared = {
      ...template,
      front_layout: [{ field_key: 'front', style: 'detail' }, { field_key: 'situation', style: 'detail' }],
    }
    expect(quizPromptText(undeclared as never, card as never))
      .toBe('너 그 드라마 봤어? 완전 빠졌어 / 드라마 추천')
  })

  it('still refuses a card whose answer sits anywhere on the front', () => {
    // Tightened alongside: the old check looked only at the STEM keys, so once the stem
    // narrowed to the primary, an answer repeated in a hint field would have slipped through
    // and shown the learner exactly what to produce.
    const leaky = {
      ...template,
      front_layout: [{ field_key: 'front', style: 'primary' }, { field_key: 'back', style: 'hint' }],
    }
    expect(quizPromptText(leaky as never, card as never)).toBeNull()
  })
})
