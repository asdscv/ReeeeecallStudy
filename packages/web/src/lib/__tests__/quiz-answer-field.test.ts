/**
 * resolveQuizCardFaces — which single field a quiz grades.
 *
 * The templates below are the SEEDED ones, copied from migration 097, because the whole reason
 * this module exists is what the existing resolver does to them. 영어 단어 declares a back of
 * [Meaning primary, Pronunciation hint, Example detail]; 중국어 단어 adds an audio field to that
 * back. Those two shapes are between them the source of every case here.
 */
import { describe, it, expect } from 'vitest'
import {
  resolveQuizCardFaces, quizReferenceAnswer, quizPromptText, resolveQuizCardCandidates,
} from '@reeeeecall/shared/lib/quiz-answer-field'
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
    // This asserted `'c'` — the HINT — while its own comment said "the lone-candidate rule must
    // not then promote a hint into the answer slot either". The comment was right and the
    // assertion was the bug: with the primary blank, `b` dropped out of the candidate list, `c`
    // became the only one left, and the lone-candidate rule (sound when a template declares one
    // back field) fired on a template that declares two. The learner was then graded against a
    // pronunciation hint, on exactly the cards where the real answer was missing.
    //
    // What a template MEANT cannot depend on which values one card fills in, so the declaration
    // is now read from the layout and only then checked for a value here.
    expect(resolveQuizCardFaces({
      fields,
      front_layout: front,
      back_layout: [{ field_key: 'b', style: 'primary' }, { field_key: 'c', style: 'hint' }],
    }, { field_values: { a: 'A', b: '   ', c: 'C' } })).toBeNull()

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

/**
 * Four of five decks could not make a quiz at all.
 *
 * Measured on the reporting account: 342 of 771 cards refused, every one of them for a
 * DECLARATION rather than for anything missing on the card —
 *
 *     착 붙는 중국어   429/429 quizzable   one primary
 *     영어 회화!         0/114             three primaries
 *     중국어 발음        0/69              two primaries
 *     영작 오답노트      0/29              two primaries (틀린 표현 + 맞는 표현)
 *     50일 수학          0/130             no primary, three candidates
 *
 * `resolveQuizCardFaces` refuses those, and refusing was right while a positional rule had to
 * choose: on 영작 오답노트 the first primary is the learner's OWN MISTAKE, so guessing by layout
 * order would have graded every answer against the wrong expression.
 *
 * A model does not have to guess. It sees the labels the author wrote. So the loose resolver
 * hands it the candidates and lets it pick, and refuses only what is genuinely unusable.
 */
describe('resolving a card for a model that reads the whole back', () => {
  const tpl = (back: Array<{ field_key: string; style: string }>) => ({
    fields: [
      { key: 'front', type: 'text', name: '한국어' },
      { key: 'wrong', type: 'text', name: '틀린 표현' },
      { key: 'correct', type: 'text', name: '맞는 표현' },
      { key: 'note', type: 'text', name: '설명' },
    ],
    front_layout: [{ field_key: 'front', style: 'primary' }],
    back_layout: back,
  })
  const card = {
    field_values: {
      front: '나는 어제 학교에 갔다',
      wrong: 'I go to school yesterday',
      correct: 'I went to school yesterday',
      note: '과거형',
    },
  }

  it('no longer refuses a card with two declared answers', () => {
    // The 영작 오답노트 shape — 29 cards, all refused before.
    const faces = resolveQuizCardCandidates(
      tpl([{ field_key: 'wrong', style: 'primary' }, { field_key: 'correct', style: 'primary' }]) as never,
      card as never)
    expect(faces).not.toBeNull()
    expect(faces!.answerKey).toBeNull()
    expect(faces!.candidates.map((c) => c.key)).toEqual(['wrong', 'correct'])
  })

  it('hands the model the author\'s own labels, not the field keys', () => {
    // The whole reason a model can do better than layout order: "틀린 표현" vs "맞는 표현" is
    // the signal, and it only exists if the labels travel.
    const faces = resolveQuizCardCandidates(
      tpl([{ field_key: 'wrong', style: 'primary' }, { field_key: 'correct', style: 'primary' }]) as never,
      card as never)
    expect(faces!.candidates.map((c) => c.label)).toEqual(['틀린 표현', '맞는 표현'])
    expect(faces!.candidates[1].value).toBe('I went to school yesterday')
  })

  it('does not ask the model when the author already said', () => {
    // One primary is a declaration. Spending a choice on it would be paying to second-guess
    // the author, and the existing path is well tested.
    const faces = resolveQuizCardCandidates(
      tpl([{ field_key: 'correct', style: 'primary' }, { field_key: 'note', style: 'detail' }]) as never,
      card as never)
    expect(faces!.answerKey).toBe('correct')
  })

  it('offers every candidate when nothing is declared', () => {
    // The 50일 수학 shape — 130 cards, no primary at all.
    const faces = resolveQuizCardCandidates(
      tpl([{ field_key: 'correct', style: 'secondary' }, { field_key: 'note', style: 'detail' }]) as never,
      card as never)
    expect(faces!.answerKey).toBeNull()
    expect(faces!.candidates.map((c) => c.key)).toEqual(['correct', 'note'])
  })

  it('narrows to the primaries when the author declared some', () => {
    // Widening past a declaration would throw away the one signal the author did give.
    const faces = resolveQuizCardCandidates(
      tpl([
        { field_key: 'wrong', style: 'primary' },
        { field_key: 'correct', style: 'primary' },
        { field_key: 'note', style: 'detail' },
      ]) as never, card as never)
    expect(faces!.candidates.map((c) => c.key)).toEqual(['wrong', 'correct'])
  })

  it('still refuses what is genuinely unusable', () => {
    // Nothing to ask, nothing to grade, and the answer already on show — the three cases where
    // a question would be worthless rather than merely imperfect.
    expect(resolveQuizCardCandidates(null as never, card as never)).toBeNull()
    expect(resolveQuizCardCandidates(
      { ...tpl([{ field_key: 'correct', style: 'primary' }]), front_layout: [] } as never,
      card as never)).toBeNull()
    expect(resolveQuizCardCandidates(
      tpl([]) as never, card as never)).toBeNull()
    // Answer repeated on the front: every candidate is a front key, so nothing is left.
    expect(resolveQuizCardCandidates(
      { ...tpl([{ field_key: 'front', style: 'primary' }]) } as never,
      card as never)).toBeNull()
  })

  it('asks with the primary front field only, like the strict resolver', () => {
    const faces = resolveQuizCardCandidates(
      { ...tpl([{ field_key: 'correct', style: 'primary' }]),
        front_layout: [{ field_key: 'front', style: 'primary' }, { field_key: 'note', style: 'hint' }] } as never,
      card as never)
    expect(faces!.promptKeys).toEqual(['front'])
  })
})

/**
 * The stored choice — the half that was missing, and the reason the fix did not work.
 *
 * Migration 219 added `card_templates.quiz_answer_key`, taught `_quiz_eligible_cards` to read it,
 * and the ambiguous decks went from 0 quizzable to all of them. Generation still failed 422
 * QUIZ_NOT_ENOUGH_CARDS, because the edge function resolves each card AGAIN through this module,
 * which refused every one of them from the same layout the SQL had just stopped refusing.
 *
 * Two resolvers reading one card have to read the same tie-breaker. These pin that, and pin the
 * two ways the stored key must NOT win.
 */
describe('the stored answer key', () => {
  const fields = [
    { key: 'front', type: 'text', name: '한국어' },
    { key: 'wrong', type: 'text', name: '틀린 표현' },
    { key: 'correct', type: 'text', name: '맞는 표현' },
  ]
  const front_layout = [{ field_key: 'front', style: 'primary' }]
  const card = {
    field_values: {
      front: '나는 어제 학교에 갔다',
      wrong: 'I go to school yesterday',
      correct: 'I went to school yesterday',
    },
  }
  const ambiguous = (quiz_answer_key?: string | null) => ({
    fields,
    front_layout,
    back_layout: [
      { field_key: 'wrong', style: 'primary' },
      { field_key: 'correct', style: 'primary' },
    ],
    quiz_answer_key,
  })

  it('resolves a card the layout alone could not', () => {
    expect(resolveQuizCardFaces(ambiguous() as never, card as never)).toBeNull()
    const faces = resolveQuizCardFaces(ambiguous('correct') as never, card as never)
    expect(faces?.answerKey).toBe('correct')
    // And the field it did NOT pick stays available to the grader as context, which is what
    // lets an explanation say "you wrote the 틀린 표현".
    expect(faces?.contextKeys).toEqual(['wrong'])
  })

  it('grades against the chosen field, never the learner\'s own mistake', () => {
    // The whole reason a positional rule was refused: on this template the FIRST primary is the
    // wrong expression. A guess by layout order would have marked every correct answer wrong.
    expect(quizReferenceAnswer(ambiguous('correct') as never, card as never))
      .toBe('I went to school yesterday')
  })

  it('does not override an unambiguous declaration', () => {
    // The author marked one field. Preferring a model's reading of their labels over their own
    // mark would be paying to overrule the one signal they gave.
    const declared = {
      fields,
      front_layout,
      back_layout: [
        { field_key: 'correct', style: 'primary' },
        { field_key: 'wrong', style: 'detail' },
      ],
      quiz_answer_key: 'wrong',
    }
    expect(resolveQuizCardFaces(declared as never, card as never)?.answerKey).toBe('correct')
  })

  it('names nothing when the template moved on, and the card is refused again', () => {
    // A key left behind by a template edit must not resurrect a field that is gone, and must not
    // silently fall through to some other field either.
    expect(resolveQuizCardFaces(ambiguous('deleted_field') as never, card as never)).toBeNull()
    // Same for a card that simply has no value there.
    expect(resolveQuizCardFaces(ambiguous('correct') as never,
      { field_values: { front: 'x', wrong: 'y', correct: '  ' } } as never)).toBeNull()
  })

  it('spares the loose resolver a model call it has already paid for', () => {
    // Without this the edge function would ask for the same choice on every single generation.
    const loose = resolveQuizCardCandidates(ambiguous('correct') as never, card as never)
    expect(loose?.answerKey).toBe('correct')
    expect(resolveQuizCardCandidates(ambiguous() as never, card as never)?.answerKey).toBeNull()
  })
})

/**
 * The deck the strict reading would have taken away.
 *
 * 착 붙는 중국어 is 429 cards and, before any of this, the ONE deck on the reporting account that
 * could make a quiz at all. Its back declares two primaries — and the second is empty on every
 * single card, so it is a field the author added and never used. Deciding the answer purely from
 * the template would call that ambiguous and refuse all 429.
 *
 * So presence still narrows, but only as the last rule, and only on a template nobody has
 * resolved. Rules 1–3 fire first, which is what keeps a blank answer from promoting the field
 * beside it.
 */
describe('an unused second primary is not ambiguity', () => {
  const fields = [
    { key: 'front', type: 'text', name: '중국어' },
    { key: 'back', type: 'text', name: '뜻' },
    { key: 'extra', type: 'text', name: '안 쓰는 칸' },
  ]
  const template = {
    fields,
    front_layout: [{ field_key: 'front', style: 'primary' }],
    back_layout: [
      { field_key: 'back', style: 'primary' },
      { field_key: 'extra', style: 'primary' },
    ],
  }
  const card = { field_values: { front: '借', back: '빌리다', extra: '' } }

  it('resolves by what the card has when nothing else can decide', () => {
    expect(resolveQuizCardFaces(template as never, card as never)?.answerKey).toBe('back')
  })

  it('still refuses when both are filled in — that is ambiguity', () => {
    expect(resolveQuizCardFaces(
      template as never,
      { field_values: { front: '借', back: '빌리다', extra: 'jiè' } } as never)).toBeNull()
  })

  it('and a stored key ends the guessing for good', () => {
    // Once a model has read the labels, presence stops being consulted — including on the card
    // where presence would have got it right by luck.
    const resolved = { ...template, quiz_answer_key: 'extra' }
    expect(resolveQuizCardFaces(resolved as never, card as never)).toBeNull()
    expect(resolveQuizCardFaces(
      resolved as never,
      { field_values: { front: '借', back: '빌리다', extra: 'jiè' } } as never)?.answerKey)
      .toBe('extra')
  })
})
