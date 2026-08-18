/**
 * The quiz validators — the boundary between a model's answer and a learner's screen (and wallet).
 *
 * Same job as `weak-themes.test.ts`, one level up: there the model returned labels and card ids,
 * here it also returns questions, distractors, rubrics and grades. The cases below are the ways a
 * real model gets that wrong, plus the two failure modes that are specific to quizzing — an
 * option that is also correct, and a question that contains its own answer.
 *
 * Every case states what a learner would have seen if the check were absent. A validation rule
 * with no such sentence is a rule nobody can decide to remove.
 */
import { describe, it, expect } from 'vitest'
import {
  answerParts, buildQuizCardSource, containsNormalized, correctOptionIndex, dominantScript,
  gradeGate, normalizeAnswer, scriptCompatible,
  validateEssayGeneration, validateEssayGrade, validateMultipleChoiceGeneration,
  validateShortAnswerGeneration, validateShortAnswerGrade,
  ESSAY_WEIGHT_TOTAL, MAX_LEARNER_CHARS, MCQ_OPTION_COUNT, SHORT_ANSWER_BANDS,
  type EssayCriterion, type QuizCardSource, type QuizGradeInput,
  leaksSchemaWord,
  stripQuestionMarkup,
} from '../../../../../supabase/functions/_shared/ai-quiz.ts'

const itemId = (cardId: string, i: number) => `item-${cardId}-${i}`

const card = (over: Partial<QuizCardSource> = {}): QuizCardSource => ({
  cardId: 'c1',
  promptText: 'osmosis',
  answerText: 'water moving across a semipermeable membrane',
  extraFields: [],
  // No deck-mates by default, so a test that supplies too few distractors still fails on
  // `too_few_distractors` rather than being quietly topped up.
  fillers: [],
  crossLingual: false,
  ...over,
})

// ─── text primitives ────────────────────────────────────────────────────────

describe('normalizeAnswer', () => {
  it('folds the ways one string is typed on different keyboards', () => {
    // A learner on a half-width IME must not lose a mark to their keyboard.
    expect(normalizeAnswer('ｱｲｳ')).toBe(normalizeAnswer('アイウ'))
    expect(normalizeAnswer('ＡＢＣ')).toBe(normalizeAnswer('abc'))
    expect(normalizeAnswer('to lend.')).toBe(normalizeAnswer('To Lend'))
  })

  it('drops spaces, because half the supported locales do not write them', () => {
    // A space-respecting containment check works in English and not in Japanese.
    expect(normalizeAnswer('the cat')).toBe('thecat')
  })
})

describe('containsNormalized', () => {
  it('catches a leaked answer through spacing and punctuation', () => {
    expect(containsNormalized('Which term means "to lend"?', 'to lend')).toBe(true)
    expect(containsNormalized('What is t o   l e n d?', 'to lend')).toBe(true)
  })

  it('abstains on a reference too short to be evidence', () => {
    // 漢 is a substring of most sentences about kanji. Firing here would reject every question
    // ever written for a single-character deck.
    expect(containsNormalized('この漢字の読みは?', '漢')).toBe(false)
  })
})

describe('answerParts', () => {
  it('splits the separators card-answer.ts and deck authors both produce', () => {
    expect(answerParts('sodium / potassium')).toEqual(['sodium', 'potassium'])
    expect(answerParts('ナトリウム、カリウム')).toHaveLength(2)
  })

  it('reports a single part for an answer with no separators', () => {
    // This is what makes the `partial` flaw unavailable on such a card.
    expect(answerParts('osmosis')).toEqual(['osmosis'])
  })
})

describe('scriptCompatible', () => {
  it('treats kana and kanji as one language, because Japanese is', () => {
    expect(scriptCompatible('貸す', 'かりる')).toBe(true)
  })

  it('rejects an option in a script the answer is not written in', () => {
    expect(scriptCompatible('to borrow', '貸す')).toBe(false)
  })

  it('abstains when a string has no script at all', () => {
    // A numeric answer must not be rejected for having no letters.
    expect(dominantScript('1,024')).toBe('unknown')
    expect(scriptCompatible('1024', '貸す')).toBe(true)
  })
})

describe('correctOptionIndex', () => {
  it('is stable for an item and spread across items', () => {
    // Stable: a learner who backgrounds the app mid-question must not return to a moved answer.
    expect(correctOptionIndex('item-a')).toBe(correctOptionIndex('item-a'))
    const seen = new Set(
      Array.from({ length: 400 }, (_, i) => correctOptionIndex(`11111111-1111-4111-8111-${String(i).padStart(12, '0')}`)),
    )
    expect(seen.size).toBe(MCQ_OPTION_COUNT)
  })
})

describe('buildQuizCardSource', () => {
  it('refuses a card with an empty face rather than quizzing on nothing', () => {
    expect(buildQuizCardSource('c1', '  ', 'answer')).toBeNull()
    expect(buildQuizCardSource('c1', 'prompt', '')).toBeNull()
  })

  it('derives crossLingual from the card, never from a belief about the subject', () => {
    expect(buildQuizCardSource('c1', '貸す', 'to lend')?.crossLingual).toBe(true)
    expect(buildQuizCardSource('c1', 'osmosis', 'water movement')?.crossLingual).toBe(false)
  })
})

// ─── multiple choice generation ─────────────────────────────────────────────

const mcq = (distractors: unknown, cardId = 'c1') => ({ items: [{ cardId, distractors }] })
/**
 * Three distractors that satisfy the DEFAULT band.
 *
 * `DEFAULT_DIFFICULTY` is the hardest one — all three near-misses — so the middle entry, which
 * used to be `right_category_wrong_item` (a FAR flaw), now uses a near one. The band is
 * enforced, not suggested, so a fixture that mixes near and far is a fixture for a different
 * band and has to say so.
 */
const threeGood = [
  { text: 'water moving through a solid wall', flaw: 'adjacent_sense' },
  { text: 'salt moving across a semipermeable membrane', flaw: 'plausible_form' },
  { text: 'a membrane moving across water', flaw: 'opposite' },
]

/** An EASY band: no near-misses at all, which is what makes a first-encounter quiz possible. */
const EASY = { level: 1, nearRequired: 0, nearMax: 0, optionCount: 4, allowedFlaws: [] as const }
const threeFar = [
  { text: 'the boiling point of mercury', flaw: 'unrelated' },
  { text: 'a kind of sedimentary rock', flaw: 'unrelated' },
  { text: 'any movement of any substance', flaw: 'overgeneral' },
]

describe('validateMultipleChoiceGeneration', () => {
  it('assembles four options with the card\'s own answer as the correct one', () => {
    const out = validateMultipleChoiceGeneration(mcq(threeGood), [card()], itemId)
    const item = out.items[0]
    expect(item.type).toBe('multiple_choice')
    if (item.type !== 'multiple_choice') throw new Error('narrowing')
    expect(item.options).toHaveLength(MCQ_OPTION_COUNT)
    // The model never typed this string; the server inserted it verbatim from the card.
    expect(item.options[item.correctIndex]).toBe(card().answerText)
    expect(item.flaws[item.correctIndex]).toBeNull()
    expect(item.question).toBe(card().promptText)
    expect(out.servable).toBe(true)
  })

  it('drops a card id it was never given', () => {
    // The load-bearing check, same as validateWeakThemes: an unknown id means the model is
    // hallucinating or was steered by card content, and the item would quiz on nothing we own.
    expect(validateMultipleChoiceGeneration(mcq(threeGood, 'ELSEWHERE'), [card()], itemId).items).toEqual([])
  })

  it('drops a distractor that is the answer again', () => {
    // Two correct options. The learner picks the right one and is marked wrong.
    const out = validateMultipleChoiceGeneration(
      mcq([...threeGood.slice(0, 2), { text: 'Water  moving across a Semipermeable membrane.', flaw: 'overgeneral' }]),
      [card()], itemId,
    )
    expect(out.items).toEqual([])
    expect(out.dropped.map((d) => d.reason)).toContain('distractor_equals_answer')
  })

  it('drops a distractor contained by the answer, and allows the one case that is legitimate', () => {
    // "a mammal" against "a mammal that lays eggs" leaves two defensible options...
    const strict = validateMultipleChoiceGeneration(
      mcq([...threeGood.slice(0, 2), { text: 'water moving', flaw: 'overgeneral' }]), [card()], itemId,
    )
    expect(strict.dropped.map((d) => d.reason)).toContain('distractor_contains_answer')

    // ...unless the answer genuinely has parts and the distractor is exactly one of them.
    const multi = card({ answerText: 'sodium / potassium' })
    const ok = validateMultipleChoiceGeneration({
      items: [{ cardId: 'c1', distractors: [
        { text: 'sodium', flaw: 'partial' },
        { text: 'calcium / magnesium', flaw: 'plausible_form' },
        { text: 'chloride / bicarbonate', flaw: 'adjacent_sense' },
      ] }],
    }, [multi], itemId)
    expect(ok.items).toHaveLength(1)
  })

  it('refuses `partial` on an answer that has no parts', () => {
    // Without this, "a substring of the answer" becomes an acceptable distractor.
    const out = validateMultipleChoiceGeneration(
      mcq([...threeGood.slice(0, 2), { text: 'water', flaw: 'partial' }]), [card()], itemId,
    )
    expect(out.dropped.map((d) => d.reason)).toContain('partial_not_applicable')
  })

  it('ACCEPTS three distractors that share a flaw', () => {
    // This was a refusal, and it was wrong. Run against a real eight-word deck
    // (lend / borrow / owe / repay / lease / rent …) the distinct-flaw rule dropped EVERY item:
    // the three best distractors for a vocabulary card genuinely are three `adjacent_sense`
    // neighbours. It also failed at what it was aimed at, because a model holding three
    // near-synonyms just mislabels one to get past it — and then the post-answer explanation
    // says the wrong thing. Substance is guarded by the equality, duplication and containment
    // checks; the flaw is a rendering hint.
    const out = validateMultipleChoiceGeneration(
      mcq(threeGood.map((d) => ({ ...d, flaw: 'adjacent_sense' }))), [card()], itemId,
    )
    expect(out.items).toHaveLength(1)
    const item = out.items[0]
    expect(item.type).toBe('multiple_choice')
    if (item.type !== 'multiple_choice') throw new Error('unreachable')
    expect(item.flaws.filter(Boolean)).toEqual(
      ['adjacent_sense', 'adjacent_sense', 'adjacent_sense'],
    )
  })

  it('refuses a flaw outside the set', () => {
    // An invented flaw has no translated string, so the post-answer explanation would render as
    // a raw identifier — exactly how the deleted feature leaked "ACTION / explain" to a learner.
    expect(validateMultipleChoiceGeneration(
      mcq([...threeGood.slice(0, 2), { text: 'diffusion of gases', flaw: 'too_hard' }]), [card()], itemId,
    ).items).toEqual([])
  })

  it('drops distractors in a script the answer is not written in', () => {
    const jp = card({ promptText: '貸す', answerText: 'かす（貸す）' })
    const out = validateMultipleChoiceGeneration({
      items: [{ cardId: 'c1', distractors: [
        { text: 'to borrow', flaw: 'opposite' },
        { text: 'かう（買う）', flaw: 'plausible_form' },
        { text: 'かえす（返す）', flaw: 'adjacent_sense' },
      ] }],
    }, [jp], itemId)
    expect(out.dropped.map((d) => d.reason)).toContain('script_mismatch')
    expect(out.items).toEqual([]) // only two survivors → no three-option question is shipped
  })

  it('drops an item whose correct option is the conspicuously longest', () => {
    // Length cueing: the long, careful option is the written one. The correct option is the
    // card's answer verbatim, so it cannot be shortened — the item goes instead.
    const out = validateMultipleChoiceGeneration({
      items: [{ cardId: 'c1', distractors: [
        { text: 'diffusion', flaw: 'adjacent_sense' },
        { text: 'osmolarity', flaw: 'plausible_form' },
        { text: 'filtration', flaw: 'right_category_wrong_item' },
      ] }],
    }, [card()], itemId)
    expect(out.dropped.map((d) => d.reason)).toContain('length_cue')
  })

  it('never ships a three-option question', () => {
    // Shipping the short item silently changes the guess rate the learner is scored against.
    const out = validateMultipleChoiceGeneration(mcq(threeGood.slice(0, 2)), [card()], itemId)
    expect(out.items).toEqual([])
    expect(out.dropped.map((d) => d.reason)).toContain('too_few_distractors')
  })

  it('marks a mostly-dropped batch unservable, so the job is released instead of charged', () => {
    const sources = Array.from({ length: 10 }, (_, i) => card({ cardId: `c${i}` }))
    const items = sources.slice(0, 3).map((s) => ({ cardId: s.cardId, distractors: threeGood }))
    const out = validateMultipleChoiceGeneration({ items }, sources, itemId)
    expect(out.items).toHaveLength(3)
    expect(out.servable).toBe(false) // 3 of 10 — a quiz that ends immediately is worse than none
  })

  it('survives every shape a broken response can take', () => {
    for (const bad of [null, undefined, 'items', 42, {}, { items: null }, { items: {} },
      { items: [null] }, { items: [{}] }, mcq(null), mcq('a,b'), mcq([null]), mcq([{}]),
      mcq([{ text: '', flaw: 'opposite' }]), mcq([{ text: 'x' }]),
      { items: [{ cardId: 42, distractors: threeGood }] }]) {
      expect(validateMultipleChoiceGeneration(bad, [card()], itemId).items).toEqual([])
    }
  })
})

// ─── short answer generation ────────────────────────────────────────────────

describe('validateShortAnswerGeneration', () => {
  it('fills the expected answer from the card, not from the response', () => {
    const out = validateShortAnswerGeneration({
      items: [{ cardId: 'c1', angle: 'reverse', question: 'Which process is described by "water moving across a semipermeable membrane"?' }],
    }, [card()], itemId)
    const item = out.items[0]
    if (item.type !== 'short_answer') throw new Error('narrowing')
    // reverse → the learner must produce the card's PROMPT. Nothing in the response said so.
    expect(item.expected).toBe('osmosis')
    // Even a response that tried to name its own expected answer cannot: it is never read.
    expect((item as unknown as Record<string, unknown>).acceptable).toBeUndefined()
  })

  it('drops a question that contains the answer it is asking for', () => {
    // The whole point of the feature. A prompt that hands over what it asks for retrieves nothing.
    const out = validateShortAnswerGeneration({
      items: [{ cardId: 'c1', angle: 'cloze', question: 'osmosis is water moving across a semipermeable ____ membrane' }],
    }, [card()], itemId)
    expect(out.items).toEqual([])
    expect(out.dropped.map((d) => d.reason)).toContain('answer_leaked_in_question')
  })

  it('drops an anchored question that does not quote its anchor', () => {
    // A cloze that never quotes the card's prompt is not a cloze of this card — it is the model
    // writing a question about a subject it was told not to reason about.
    const out = validateShortAnswerGeneration({
      items: [{ cardId: 'c1', angle: 'cloze', question: 'Cells shrink in a hypertonic solution because of ____.' }],
    }, [card()], itemId)
    expect(out.dropped.map((d) => d.reason)).toContain('anchor_missing')
  })

  it('lets `restate` reword freely, and still refuses a leak', () => {
    const ok = validateShortAnswerGeneration({
      items: [{ cardId: 'c1', angle: 'restate', question: 'In one line, what happens in osmosis?' }],
    }, [card()], itemId)
    expect(ok.items).toHaveLength(1)
    const leak = validateShortAnswerGeneration({
      items: [{ cardId: 'c1', angle: 'restate', question: 'Is osmosis water moving across a semipermeable membrane?' }],
    }, [card()], itemId)
    expect(leak.items).toEqual([])
  })

  it('refuses a field_probe naming a field the card does not have', () => {
    // Same refusal as an unknown card id: the model named something it was not given.
    const out = validateShortAnswerGeneration({
      items: [{ cardId: 'c1', angle: 'field_probe', probeFieldKey: 'field_mnemonic', question: 'What is the mnemonic for osmosis?' }],
    }, [card()], itemId)
    expect(out.items).toEqual([])

    const withField = card({ extraFields: [{ key: 'field_example', label: 'Example', value: 'a raisin in water' }] })
    const ok = validateShortAnswerGeneration({
      items: [{ cardId: 'c1', angle: 'field_probe', probeFieldKey: 'field_example', question: 'Give the Example this card records for osmosis.' }],
    }, [withField], itemId)
    const item = ok.items[0]
    if (item?.type !== 'short_answer') throw new Error('narrowing')
    expect(item.expected).toBe('a raisin in water')
  })

  it('refuses an angle outside the set', () => {
    expect(validateShortAnswerGeneration({
      items: [{ cardId: 'c1', angle: 'translate', question: 'What is osmosis in Korean?' }],
    }, [card()], itemId).items).toEqual([])
  })

  it('survives every shape a broken response can take', () => {
    for (const bad of [null, undefined, 'items', 42, {}, { items: null }, { items: {} },
      { items: [null] }, { items: [{}] },
      { items: [{ cardId: 'c1', angle: 'restate' }] },
      { items: [{ cardId: 'c1', angle: 'restate', question: 42 }] },
      { items: [{ cardId: 'c1', angle: 'restate', question: 'x'.repeat(5000) }] }]) {
      expect(validateShortAnswerGeneration(bad, [card()], itemId).items).toEqual([])
    }
  })
})

// ─── essay generation ───────────────────────────────────────────────────────

const essay = (over: Record<string, unknown> = {}) => ({
  items: [{
    cardId: 'c1',
    question: 'Explain osmosis and why it matters.',
    lengthBand: 'medium',
    criteria: [
      { aspect: 'covers_answer', weight: 60, mustMention: ['semipermeable membrane'] },
      { aspect: 'uses_key_terms', weight: 40, mustMention: ['osmosis'] },
    ],
    ...over,
  }],
})

describe('validateEssayGeneration', () => {
  it('keeps a well-formed rubric and stamps stable criterion ids', () => {
    const out = validateEssayGeneration(essay(), [card()], itemId)
    const item = out.items[0]
    if (item?.type !== 'essay') throw new Error('narrowing')
    expect(item.criteria.map((c) => c.aspect)).toEqual(['covers_answer', 'uses_key_terms'])
    expect(item.criteria.reduce((s, c) => s + c.weight, 0)).toBe(ESSAY_WEIGHT_TOTAL)
    expect(item.criteria[0].id).toBe('item-c1-0:0')
    expect(item.reference).toBe(card().answerText) // from the card, never from the response
  })

  it('drops a criterion whose required term is not in the card', () => {
    // A term the card never uses is a subject claim. The criterion goes; if that leaves fewer
    // than two, the item goes with it, and for the honest reason.
    const out = validateEssayGeneration(essay({
      criteria: [
        { aspect: 'covers_answer', weight: 60, mustMention: ['semipermeable membrane'] },
        { aspect: 'explains_why', weight: 40, mustMention: ['aquaporin channels'] },
      ],
    }), [card()], itemId)
    expect(out.items).toEqual([])
    expect(out.dropped.map((d) => d.reason)).toContain('ungrounded_mention')
  })

  it('requires covers_answer, and requires it to outweigh everything else', () => {
    // A rubric that ranks `structure` above the card's own content is grading composition.
    expect(validateEssayGeneration(essay({
      criteria: [
        { aspect: 'structure', weight: 50, mustMention: ['osmosis'] },
        { aspect: 'uses_key_terms', weight: 50, mustMention: ['membrane'] },
      ],
    }), [card()], itemId).items).toEqual([])

    const out = validateEssayGeneration(essay({
      criteria: [
        { aspect: 'covers_answer', weight: 30, mustMention: ['membrane'] },
        { aspect: 'structure', weight: 70, mustMention: ['osmosis'] },
      ],
    }), [card()], itemId)
    expect(out.dropped.map((d) => d.reason)).toContain('bad_weights')
  })

  it('rejects weights the model got wrong, but renormalises weights OUR drop broke', () => {
    // Two different situations. One is a contract violation; the other is our doing and must not
    // be charged to the learner.
    expect(validateEssayGeneration(essay({
      criteria: [
        { aspect: 'covers_answer', weight: 60, mustMention: ['membrane'] },
        { aspect: 'uses_key_terms', weight: 30, mustMention: ['osmosis'] },
      ],
    }), [card()], itemId).dropped.map((d) => d.reason)).toContain('bad_weights')

    const out = validateEssayGeneration(essay({
      criteria: [
        { aspect: 'covers_answer', weight: 50, mustMention: ['membrane'] },
        { aspect: 'uses_key_terms', weight: 30, mustMention: ['osmosis'] },
        { aspect: 'gives_example', weight: 20, mustMention: ['ATP synthase'] }, // ungrounded → dropped
      ],
    }), [card()], itemId)
    const item = out.items[0]
    if (item?.type !== 'essay') throw new Error('narrowing')
    expect(item.criteria).toHaveLength(2)
    expect(item.criteria.reduce((s, c) => s + c.weight, 0)).toBe(ESSAY_WEIGHT_TOTAL)
  })

  it('drops an essay question that leaks the answer or floats free of the card', () => {
    expect(validateEssayGeneration(essay({
      question: 'Explain why osmosis is water moving across a semipermeable membrane.',
    }), [card()], itemId).dropped.map((d) => d.reason)).toContain('answer_leaked_in_question')

    expect(validateEssayGeneration(essay({
      question: 'Discuss the role of transport proteins in cellular homeostasis.',
    }), [card()], itemId).dropped.map((d) => d.reason)).toContain('anchor_missing')
  })

  it('refuses an aspect or length band outside the set', () => {
    expect(validateEssayGeneration(essay({ lengthBand: 'epic' }), [card()], itemId).items).toEqual([])
    expect(validateEssayGeneration(essay({
      criteria: [
        { aspect: 'covers_answer', weight: 60, mustMention: ['membrane'] },
        { aspect: 'shows_insight', weight: 40, mustMention: ['osmosis'] },
      ],
    }), [card()], itemId).items).toEqual([])
  })

  it('survives every shape a broken response can take', () => {
    for (const bad of [null, undefined, 'items', 42, {}, { items: null }, { items: {} },
      { items: [null] }, { items: [{}] }, essay({ criteria: null }), essay({ criteria: 'two' }),
      essay({ criteria: [] }), essay({ criteria: [{ aspect: 'covers_answer', weight: 100, mustMention: null }] }),
      essay({ criteria: [{ aspect: 'covers_answer', weight: '100', mustMention: ['membrane'] }] }),
      essay({ criteria: [{ aspect: 'covers_answer', weight: 100.5, mustMention: ['membrane'] }] }),
      essay({ question: null })]) {
      expect(validateEssayGeneration(bad, [card()], itemId).items).toEqual([])
    }
  })
})

// ─── grading ────────────────────────────────────────────────────────────────

const input = (over: Partial<QuizGradeInput> = {}): QuizGradeInput => ({
  question: 'What happens in osmosis?',
  reference: 'water moving across a semipermeable membrane',
  learner: 'water crosses a semi-permeable membrane',
  crossLingual: false,
  ...over,
})

describe('gradeGate', () => {
  it('grades nothing for free rather than paying a model to read an empty box', () => {
    expect(gradeGate('short_answer', '   ')).toEqual({ ok: false, refusal: 'empty_response' })
    // 짧은 서술형 답안은 **거절하지 않습니다**. 40자 하한이 있었고, 그건 무엇이 답인지를
    // 우리가 정한 것이었습니다. 그 하한이 실제로 한 일은 모델 호출 전 거절이었고, 화면에는
    // "처리하지 못했어요 · 다시 시도"로 나와 같은 답으로는 영원히 실패했습니다. 세 단어짜리
    // 답은 루브릭이 낮게 채점하면 될 진짜 답입니다.
    expect(gradeGate('essay', 'too short')).toEqual({ ok: true })
    expect(gradeGate('essay', '   ')).toEqual({ ok: false, refusal: 'empty_response' })
  })

  it('refuses an over-length response instead of truncating it', () => {
    // Grading the first 2000 characters of a 4000-character essay grades an essay the learner did
    // not write, and charges them for it. They can shorten it; we cannot un-grade it.
    expect(gradeGate('essay', 'x'.repeat(MAX_LEARNER_CHARS.essay + 1)))
      .toEqual({ ok: false, refusal: 'response_too_long' })
  })
})

describe('validateShortAnswerGrade', () => {
  it('keeps a well-formed grade', () => {
    const out = validateShortAnswerGrade(
      { verdict: 'equivalent', score: 0.95, gaps: [], spans: [{ from: 'learner', start: 0, end: 5 }] },
      input(),
    )
    expect(out).toEqual({
      graded: true,
      grade: { verdict: 'equivalent', score: 0.95, gaps: [], spans: [{ from: 'learner', start: 0, end: 5 }], clamped: false },
    })
  })

  it('lets the verdict win when the model disagrees with itself', () => {
    // A response saying "equivalent" and 0.2 is incoherent. The verdict is the thing that renders
    // and is drawn from a closed set, so the score is clamped into its band rather than the whole
    // grade being refused — a learner who paid for a grade must not get nothing.
    const out = validateShortAnswerGrade({ verdict: 'equivalent', score: 0.2, gaps: [] }, input())
    if (!out.graded) throw new Error('expected a grade')
    expect(out.grade.score).toBe(SHORT_ANSWER_BANDS.equivalent[0])
    expect(out.grade.clamped).toBe(true)
  })

  it('fills a missing score from the verdict\'s own band', () => {
    const out = validateShortAnswerGrade({ verdict: 'partial', gaps: ['missing_part'] }, input())
    if (!out.graded) throw new Error('expected a grade')
    expect(out.grade.score).toBe(0.5)
    expect(out.grade.clamped).toBe(true)
  })

  it('refuses, and refunds, when the model declines', () => {
    // The `no_pattern` of this enum. Without it the model forces a `different` and the learner
    // loses a mark to our bug — and normalized_score steers what they see tomorrow.
    expect(validateShortAnswerGrade({ verdict: 'unjudgeable', score: 0 }, input()))
      .toEqual({ graded: false, refusal: 'model_declined' })
  })

  it('costs marks for the wrong language only on a card that tests language', () => {
    const answered = { verdict: 'equivalent', score: 1, gaps: ['wrong_language'] }
    // Same-script card: the language the learner chose is not what is being tested.
    const same = validateShortAnswerGrade(answered, input())
    if (!same.graded) throw new Error('expected a grade')
    expect(same.grade.verdict).toBe('equivalent')
    expect(same.grade.score).toBe(1)

    // Cross-script card: producing the answer in its own language IS the point, and the evidence
    // for that came from the card's two faces, not from a belief about the subject.
    const cross = validateShortAnswerGrade(answered, input({ crossLingual: true }))
    if (!cross.graded) throw new Error('expected a grade')
    expect(cross.grade.verdict).toBe('partial')
    expect(cross.grade.score).toBeLessThanOrEqual(SHORT_ANSWER_BANDS.partial[1])
  })

  it('drops a bad span without losing the grade', () => {
    // A grade is not worth refusing over a bad offset; the verdict and gaps still render.
    const out = validateShortAnswerGrade({
      verdict: 'partial', score: 0.5, gaps: ['missing_part'],
      spans: [
        { from: 'learner', start: 0, end: 9999 },     // past the end of the learner's text
        { from: 'learner', start: 5, end: 5 },        // empty
        { from: 'nowhere', start: 0, end: 3 },        // a text we do not hold
        { from: 'reference', start: 0, end: 4 },      // valid
      ],
    }, input())
    if (!out.graded) throw new Error('expected a grade')
    expect(out.grade.spans).toEqual([{ from: 'reference', start: 0, end: 4 }])
  })

  it('drops an invented gap and de-duplicates the rest', () => {
    const out = validateShortAnswerGrade({
      verdict: 'partial', score: 0.5, gaps: ['missing_part', 'missing_part', 'needs_more_effort'],
    }, input())
    if (!out.graded) throw new Error('expected a grade')
    expect(out.grade.gaps).toEqual(['missing_part'])
  })

  it('survives every shape a broken response can take, and refunds each time', () => {
    for (const bad of [null, undefined, 'equivalent', 42, {}, { verdict: null }, { verdict: 'great' },
      { verdict: 'equivalent', gaps: 'missing_part' }, { score: 1 }]) {
      expect(validateShortAnswerGrade(bad, input()).graded).toBe(false)
    }
  })
})

// ─── essay grading ──────────────────────────────────────────────────────────

const rubric: EssayCriterion[] = [
  { id: 'k1', aspect: 'covers_answer', weight: 60, mustMention: ['membrane'] },
  { id: 'k2', aspect: 'uses_key_terms', weight: 40, mustMention: ['osmosis'] },
]

describe('validateEssayGrade', () => {
  it('derives the score from levels and weights, because the model never returns one', () => {
    // A grader that returns an overall number can say every criterion was met and hand back 0.6,
    // and there is no principled way to reconcile that.
    const out = validateEssayGrade({
      criteria: [{ criterionId: 'k1', level: 'met' }, { criterionId: 'k2', level: 'partial' }],
      score: 0.1, // ignored on purpose
    }, rubric, input())
    if (!out.graded) throw new Error('expected a grade')
    expect(out.grade.score).toBeCloseTo((60 * 1 + 40 * 0.5) / 100)
  })

  it('removes a declined criterion from the total rather than scoring it zero', () => {
    // Charging a learner for the grader's blind spot is fabricating a grade, just quieter.
    const out = validateEssayGrade({
      criteria: [{ criterionId: 'k1', level: 'met' }, { criterionId: 'k2', level: 'unjudgeable' }],
    }, rubric, input())
    if (!out.graded) throw new Error('expected a grade')
    expect(out.grade.score).toBe(1)
    expect(out.grade.unjudgeableWeight).toBeCloseTo(0.4)
  })

  it('treats an omitted criterion as declined, not as failed', () => {
    // Silence is not evidence the learner missed it.
    const out = validateEssayGrade({ criteria: [{ criterionId: 'k1', level: 'met' }] }, rubric, input())
    if (!out.graded) throw new Error('expected a grade')
    expect(out.grade.criteria[1]).toEqual({ criterionId: 'k2', level: 'unjudgeable', span: null })
  })

  it('refuses when most of the rubric went ungraded', () => {
    // Scoring the 40% it could read and calling that the essay's mark is a fabrication dressed
    // as leniency.
    expect(validateEssayGrade({
      criteria: [{ criterionId: 'k1', level: 'unjudgeable' }, { criterionId: 'k2', level: 'met' }],
    }, rubric, input()).graded).toBe(false)
  })

  it('ignores a criterion id it was never given', () => {
    expect(validateEssayGrade({
      criteria: [{ criterionId: 'INVENTED', level: 'met' }, { criterionId: 'k1', level: 'met' }, { criterionId: 'k2', level: 'met' }],
    }, rubric, input()).graded).toBe(true)
    // ...and an all-invented response grades nothing, so it refunds.
    expect(validateEssayGrade({
      criteria: [{ criterionId: 'INVENTED', level: 'met' }],
    }, rubric, input()).graded).toBe(false)
  })

  it('survives every shape a broken response can take, and refunds each time', () => {
    for (const bad of [null, undefined, 'met', 42, {}, { criteria: null }, { criteria: {} },
      { criteria: [null] }, { criteria: [{}] }, { criteria: [{ criterionId: 'k1', level: 'A+' }] }]) {
      expect(validateEssayGrade(bad, rubric, input()).graded).toBe(false)
    }
    // An empty rubric is our bug, not the model's, and is still not a grade.
    expect(validateEssayGrade({ criteria: [] }, [], input()).graded).toBe(false)
  })
})

describe('a question written about our JSON instead of the learner\'s card', () => {
  // A real production generation returned "What is the prompt for '빌려주다'?" — the model
  // copied the noun straight out of the instruction describing the angle. The instruction was
  // fixed, but an instruction the model is asked to follow is not the same as one it cannot
  // break, and the question is the ONE model-authored string this feature renders.
  it('catches the identifiers that name our payload', () => {
    for (const q of [
      "What is the prompt for '빌려주다'?",
      'Which cardId does this belong to?',
      'Pick one of the otherFields.',
      'What goes in field_2?',
      'Which answer field is this?',
    ]) {
      expect(leaksSchemaWord(q), q).toBe(true)
    }
  })

  it('leaves a real question alone, including one that happens to say "card"', () => {
    // Matched on word boundaries and only against the question, so a deck about poker or
    // payment terminals is not collateral damage.
    for (const q of [
      'Which English word means 빌려주다?',
      'What is the pronunciation of lend?',
      'Name the card that beats a full house.',
      '이 단어의 뜻은?',
      'Prompted by what?',
    ]) {
      expect(leaksSchemaWord(q), q).toBe(false)
    }
  })
})

describe('inline markup in a model-authored question', () => {
  // A real production generation returned "When you <b>pledge</b> something, you ____." The
  // screens render a question as text, so the learner would read the tags — the same failure as
  // the AI feature that printed raw JSON, arriving through a narrower door.
  it('strips the tags a model reaches for, and keeps the words', () => {
    expect(stripQuestionMarkup('When you <b>pledge</b> something, you ____.'))
      .toBe('When you pledge something, you ____.')
    expect(stripQuestionMarkup('<p>What is <em>lend</em>?</p><br/>')).toBe('What is lend?')
    expect(stripQuestionMarkup('  spaced   out  ')).toBe('spaced out')
  })

  it('leaves comparisons alone', () => {
    // A whitelist of tag names, not `<[^>]*>`: a maths deck must keep its own text.
    expect(stripQuestionMarkup('Is x<y>z true?')).toBe('Is x<y>z true?')
    expect(stripQuestionMarkup('When is a < b?')).toBe('When is a < b?')
  })
})

describe('difficulty bands', () => {
  // The band is ENFORCED, not requested. A model told "make it easy" writes near-misses anyway,
  // because easy is the shape it has least practice at.
  it('SHIPS an off-band batch, and marks it', () => {
    // The band stopped being a gate in mig 202. Enforcing an exact near-count dropped every
    // item on the easy bands across three deploys, it cannot be evaluated for short answer or
    // essay at all, and "did the model follow the instruction" is not mechanically checkable.
    // A question outside the band is easier or harder than asked for — not BROKEN — and the
    // learner paid for it.
    const easy = validateMultipleChoiceGeneration(mcq(threeFar), [card()], itemId, EASY)
    expect(easy.items).toHaveLength(1)
    const onBand = easy.items[0]
    if (onBand.type !== 'multiple_choice') throw new Error('unreachable')
    expect(onBand.offBand).toBe(false)

    const hard = validateMultipleChoiceGeneration(mcq(threeFar), [card()], itemId)
    expect(hard.items).toHaveLength(1)
    const drifted = hard.items[0]
    if (drifted.type !== 'multiple_choice') throw new Error('unreachable')
    // Recorded so a band whose instruction has stopped working is visible in the logs.
    expect(drifted.offBand).toBe(true)
  })

  it('still refuses what is actually broken', () => {
    // The structural checks are unchanged, because those ARE checkable and they are what
    // makes an item unusable rather than merely off-band.
    const brokenSet = [
      { list: [...threeGood.slice(0, 2), { text: card().answerText, flaw: 'adjacent_sense' }],
        reason: 'distractor_equals_answer' },
      { list: [...threeGood.slice(0, 2), { text: 'water', flaw: 'unrelated' }],
        reason: 'distractor_contains_answer' },
      { list: [...threeGood.slice(0, 2), { text: threeGood[0].text, flaw: 'opposite' }],
        reason: 'distractor_duplicated' },
    ]
    for (const { list, reason } of brokenSet) {
      const out = validateMultipleChoiceGeneration(mcq(list), [card()], itemId)
      expect(out.dropped.map((d) => d.reason), reason).toContain(reason)
    }
  })

  it('builds as many options as the band asks for', () => {
    // The option count is a band property (2..6), not a constant. A six-option question needs
    // five distractors, and the correct answer still lands at a position the model cannot see.
    const six = { level: 9, nearRequired: 5, nearMax: 5, optionCount: 6, allowedFlaws: [] as const }
    const five = [
      { text: 'water moving through an impermeable solid wall', flaw: 'adjacent_sense' },
      { text: 'a semipermeable membrane moving across water', flaw: 'opposite' },
      { text: 'water moving across a semipermeable membraine', flaw: 'plausible_form' },
      { text: 'salt moving across a semipermeable barrier', flaw: 'opposite' },
      { text: 'water moving through a mechanical sieve', flaw: 'adjacent_sense' },
    ]
    const out = validateMultipleChoiceGeneration(mcq(five), [card()], itemId, six)

    expect(out.items).toHaveLength(1)
    const item = out.items[0]
    if (item.type !== 'multiple_choice') throw new Error('unreachable')
    expect(item.options).toHaveLength(6)
    expect(item.correctIndex).toBeGreaterThanOrEqual(0)
    expect(item.correctIndex).toBeLessThan(6)
    expect(item.options[item.correctIndex]).toBe(card().answerText)
  })

  it('keeps a distractor that CONTAINS the answer, and drops one that is PART of it', () => {
    // Two directions that used to be one check, and are not the same thing.
    //
    // A distractor inside the answer ("발효" against 발효시키다) is not wrong, it is
    // incomplete — marking a learner down for it is indefensible, so it stays a drop.
    //
    // A distractor that contains the answer is a different word sharing a stem: 빙하 →
    // 빙하기, rent → rented. That is what a near-miss IS. Dropping it killed band 3 — the
    // DEFAULT band — outright on a Korean noun deck: every item lost distractors, then lost
    // itself to `too_few_distractors`, and the learner got AI_EMPTY_RESULT.
    const glacier = card({ promptText: 'glacier', answerText: '빙하' })
    // 빙하기 is what `plausible_form` is for — the answer's own shape, meaning something else.
    const out = validateMultipleChoiceGeneration(
      mcq([
        { text: '빙하기', flaw: 'plausible_form' },   // contains the answer — a real word
        { text: '화산', flaw: 'adjacent_sense' },
        { text: '산맥', flaw: 'adjacent_sense' },
      ]),
      [glacier], itemId,
    )
    expect(out.dropped).toEqual([])
    const item = out.items[0]
    if (item.type !== 'multiple_choice') throw new Error('unreachable')
    expect(item.options).toContain('빙하기')
    expect(item.options).toContain('빙하')
  })

  it('still drops a distractor that is part of the answer', () => {
    const ferment = card({ promptText: 'ferment', answerText: '발효시키다' })
    const out = validateMultipleChoiceGeneration(
      mcq([
        { text: '발효', flaw: 'adjacent_sense' },     // a substring of the answer
        { text: '냉동시키다', flaw: 'adjacent_sense' },
        { text: '건조시키다', flaw: 'adjacent_sense' },
      ]),
      [ferment], itemId,
    )
    expect(out.dropped.map((d) => d.reason)).toContain('distractor_contains_answer')
  })

  it('marks an item that breaks the band restriction, and still delivers it', () => {
    // Band conformance is ADVISORY, not a gate. Dropping off-band items is what produced runs
    // of zero questions on bands 1 and 2 — the learner paid, got nothing, and the reason
    // ("the model would not write an unrelated distractor") was not their problem to solve.
    // A slightly-too-hard question a learner can answer beats no question at all, so the item
    // ships carrying `offBand` and the band is retuned from that signal instead.
    const lookalikeOnly = {
      level: 7, nearRequired: 3, nearMax: 3, optionCount: 4, allowedFlaws: ['plausible_form'] as const,
    }
    const out = validateMultipleChoiceGeneration(mcq(threeGood), [card()], itemId, lookalikeOnly)

    expect(out.items).toHaveLength(1)
    const item = out.items[0]
    if (item.type !== 'multiple_choice') throw new Error('unreachable')
    expect(item.offBand).toBe(true)
    // Used a flaw the band forbids — which is exactly what `offBand` is recording.
    expect(item.flaws.some((f) => f !== null && f !== 'plausible_form')).toBe(true)
    expect(out.dropped).toEqual([])
  })

  it('does not mark an item that stays inside the band restriction', () => {
    // The other half of the claim: `offBand` has to be able to be false, or it is not a signal.
    const lookalikeOnly = {
      level: 7, nearRequired: 3, nearMax: 3, optionCount: 4, allowedFlaws: ['plausible_form'] as const,
    }
    const allLookalike = [
      { text: 'water moving across a semipermeable membraine', flaw: 'plausible_form' },
      { text: 'water moving accross a semipermeable membrane', flaw: 'plausible_form' },
      { text: 'water moving across a semi-permeable membrain', flaw: 'plausible_form' },
    ]
    const out = validateMultipleChoiceGeneration(mcq(allLookalike), [card()], itemId, lookalikeOnly)

    expect(out.items).toHaveLength(1)
    const item = out.items[0]
    if (item.type !== 'multiple_choice') throw new Error('unreachable')
    expect(item.offBand).toBe(false)
  })
})

describe('filling the FAR slots from the deck', () => {
  // The model is asked only for the NEAR distractors it is good at. Asked for a deliberately
  // unrelated wrong answer it returns another near-miss instead — at every phrasing tried,
  // which dropped every item on bands 1 and 2 before this existed.
  const MEDIUM = { level: 2, nearRequired: 0, nearMax: 1, optionCount: 4, allowedFlaws: [] as const }
  const withDeck = (fillers: string[]) => card({ fillers })

  it('tops a short batch up from the deck', () => {
    const out = validateMultipleChoiceGeneration(
      mcq([{ text: 'water through a solid wall of similar length here', flaw: 'adjacent_sense' }]),
      [withDeck(['the boiling point of mercury at sea level', 'a kind of sedimentary rock formation'])],
      itemId, MEDIUM,
    )

    expect(out.items).toHaveLength(1)
    const item = out.items[0]
    if (item.type !== 'multiple_choice') throw new Error('unreachable')
    expect(item.options).toHaveLength(4)
    // One near-miss from the model, two from the deck — which is what the band asked for.
    expect(item.flaws.filter((f) => f === 'right_category_wrong_item')).toHaveLength(2)
  })

  it('never fills with the answer itself, or a duplicate', () => {
    const answer = 'water moving across a semipermeable membrane'
    const out = validateMultipleChoiceGeneration(
      mcq([{ text: 'water through a solid wall of similar length here', flaw: 'adjacent_sense' }]),
      [withDeck([answer, 'a kind of sedimentary rock formation',
                 'a kind of sedimentary rock formation', 'the boiling point of mercury today'])],
      itemId, MEDIUM,
    )

    const item = out.items[0]
    if (item?.type !== 'multiple_choice') throw new Error('unreachable')
    expect(new Set(item.options).size).toBe(4)
    expect(item.options.filter((o) => o === answer)).toHaveLength(1)  // the correct one only
  })

  it('still drops the item when the deck cannot fill it either', () => {
    // A two-card deck has nothing to spare, and a three-option question is not the question
    // the learner was quoted for.
    const out = validateMultipleChoiceGeneration(
      mcq([{ text: 'water through a solid wall of similar length here', flaw: 'adjacent_sense' }]),
      [withDeck([])], itemId, MEDIUM,
    )

    expect(out.items).toEqual([])
    expect(out.dropped.map((d) => d.reason)).toContain('too_few_distractors')
  })
})
