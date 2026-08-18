/**
 * 모범답안은 문항을 떨어뜨리지 않는다.
 *
 * 서술형 검증은 이 저장소에서 이미 두 번 너무 빡세서 아무것도 안 남긴 적이 있습니다
 * (`ungrounded_mention` 으로 열 장짜리 덱에서 서술형이 0개 생성). 모범답안은 **있으면 좋은
 * 것**이지 문항의 조건이 아니므로, 못 쓰거나 이상하면 그 필드만 버리고 문항은 살아야 합니다.
 *
 * 그리고 상한이 있어야 합니다 — 한 호출이 서술형 3문항을 만들고, 잘린 JSON 은 파싱에 실패해
 * 문항이 통째로 안 나옵니다.
 */
import { describe, it, expect } from 'vitest'
import {
  validateEssayGeneration, MODEL_ANSWER_MAX_CHARS,
  type QuizCardSource,
} from '../../../../../supabase/functions/_shared/ai-quiz.ts'

const CARD_ID = '11111111-1111-4111-8111-111111111111'
const source: QuizCardSource = {
  cardId: CARD_ID,
  promptText: 'photosynthesis',
  answerText: '광합성',
  extraFields: [],
} as unknown as QuizCardSource

const makeItemId = (cardId: string, i: number) => `${cardId}:${i}`

function raw(modelAnswer?: unknown) {
  const item: Record<string, unknown> = {
    cardId: CARD_ID,
    question: 'photosynthesis 가 무엇인지 설명하세요.',
    lengthBand: 'medium',
    // 최소 2개(ESSAY_MIN_CRITERIA)이고 가중치 합이 정확히 100이어야 합니다.
    criteria: [
      { aspect: 'covers_answer', weight: 70, mustMention: ['광합성'] },
      { aspect: 'uses_key_terms', weight: 30, mustMention: ['photosynthesis'] },
    ],
  }
  if (modelAnswer !== undefined) item.modelAnswer = modelAnswer
  return { items: [item] }
}

function essay(modelAnswer?: unknown) {
  const out = validateEssayGeneration(raw(modelAnswer), [source], makeItemId)
  return out.items[0] as { modelAnswer: string | null } | undefined
}

describe('서술형 모범답안', () => {
  it('모델이 쓴 것을 그대로 싣는다', () => {
    expect(essay('광합성은 빛으로 양분을 만드는 과정입니다.')?.modelAnswer)
      .toBe('광합성은 빛으로 양분을 만드는 과정입니다.')
  })

  it('없으면 null 이고, 문항은 그대로 나온다', () => {
    const item = essay(undefined)
    expect(item).toBeDefined()
    expect(item?.modelAnswer).toBeNull()
  })

  it.each([
    ['빈 문자열', ''],
    ['공백뿐', '   \n  '],
    ['문자열이 아님', { text: '광합성' }],
    ['숫자', 42],
  ])('%s 이면 문항은 살리고 필드만 버린다', (_label, value) => {
    const item = essay(value)
    expect(item).toBeDefined()
    expect(item?.modelAnswer).toBeNull()
  })

  it('상한을 넘으면 버린다 — 문항은 산다', () => {
    // 상한에서 역산합니다. 숫자를 손으로 적으면 상한을 조정할 때마다 여기서 터집니다.
    const item = essay('가'.repeat(MODEL_ANSWER_MAX_CHARS + 1))
    expect(item).toBeDefined()
    expect(item?.modelAnswer).toBeNull()
  })

  it('상한 정확히는 통과한다', () => {
    const exact = '가'.repeat(MODEL_ANSWER_MAX_CHARS)
    expect(essay(exact)?.modelAnswer).toBe(exact)
  })

  it('우리 JSON 을 베껴 쓴 글은 버린다', () => {
    // 모델이 카드가 아니라 스키마에 대해 쓴 경우입니다. 문항 쪽에 이미 같은 검사가 있습니다.
    // `SCHEMA_WORDS` 에 실제로 들어 있는 낱말이어야 합니다 — prompt / cardId / otherFields 등.
    const item = essay('The cardId given in the prompt refers to photosynthesis.')
    expect(item).toBeDefined()
    expect(item?.modelAnswer).toBeNull()
  })

  it('앞뒤 공백은 다듬는다', () => {
    expect(essay('  광합성 설명입니다.  \n')?.modelAnswer).toBe('광합성 설명입니다.')
  })
})
