/**
 * 한 글자 답을 가진 카드도 문항이 나와야 한다.
 *
 * `containsNormalized` 의 `minChars = 2` 는 **유출 검사**를 위해 있습니다: 한 글자 정답은
 * 아무 문장에나 들어 있으니, 못 판단할 때는 기권해서(false) 문항을 살립니다.
 *
 * 그런데 같은 함수가 **근거 검사**에도 쓰였고, 거기서는 같은 false 가 문항을 죽입니다 —
 * "카드에서 베꼈다는 용어가 카드에 없다". 그래서 한 글자 답은 카드에 **있어도** 근거 없음이
 * 됐습니다. 프로덕션 중국어 덱 429장 중 140장(32.6%)이 한 글자 답이고, 그 카드들은 서술형이
 * 한 번도 나올 수 없었습니다. "3문항 요청했는데 2문항만 온다"의 정체입니다.
 *
 * 규칙: **판단 불가는 언제나 문항을 살리는 쪽으로.**
 */
import { describe, it, expect } from 'vitest'
import {
  containsNormalized, mentionsTerm, anchorSatisfied, validateEssayGeneration,
  type QuizCardSource,
} from '../../../../../supabase/functions/_shared/ai-quiz.ts'

describe('한 글자 용어', () => {
  it('근거 검사는 한 글자도 인정한다', () => {
    // haystack 이 우리 카드의 글이라 우연히 섞여 들 걱정이 없습니다.
    expect(mentionsTerm('~입니까? 吗 ma', '吗')).toBe(true)
    expect(mentionsTerm('예쁘다 漂亮 piàoliang', '漂亮')).toBe(true)
    expect(mentionsTerm('지금 现在', '去')).toBe(false)
  })

  it('유출 검사는 기권한다 — 문항을 살리는 쪽으로', () => {
    // 한 글자 정답은 어떤 문장에도 들어 있을 수 있어 유출이라 단정할 수 없습니다.
    expect(containsNormalized('이 표현을 설명하세요', '吗')).toBe(false)
  })

  it('앵커도 판단 불가면 요구하지 않는다', () => {
    // 한 글자 질문면을 문항이 담았는지는 모델 산문 위에서 신뢰할 수 없습니다. 그때 떨어뜨리면
    // 짧은 카드를 가진 학습자만 조용히 손해를 봅니다.
    expect(anchorSatisfied('아무 상관 없는 문장', '吗')).toBe(true)
    // 판단할 수 있으면 여전히 따집니다.
    expect(anchorSatisfied('아무 상관 없는 문장', '예쁘다')).toBe(false)
    expect(anchorSatisfied('예쁘다를 중국어로 쓰세요', '예쁘다')).toBe(true)
  })
})

describe('한 글자 답 카드의 서술형', () => {
  const source = {
    cardId: '11111111-1111-4111-8111-111111111111',
    promptText: '~입니까?',
    answerText: '吗',
    extraFields: [{ key: 'p', label: '병음', value: 'ma' }],
  } as unknown as QuizCardSource

  it('문항이 만들어진다 — 고치기 전에는 ungrounded_mention 으로 전멸했다', () => {
    const out = validateEssayGeneration({
      items: [{
        cardId: source.cardId,
        question: '~입니까? 에 해당하는 중국어 어기조사를 쓰고 그 쓰임을 설명하세요.',
        lengthBand: 'short',
        criteria: [
          { aspect: 'covers_answer', weight: 70, mustMention: ['吗'] },
          { aspect: 'uses_key_terms', weight: 30, mustMention: ['ma'] },
        ],
      }],
    }, [source], (c, i) => `${c}:${i}`)

    expect(out.dropped).toEqual([])
    expect(out.items).toHaveLength(1)
  })

  it('그래도 카드에 없는 용어는 여전히 거절한다', () => {
    // 하한을 없앤 것이지 근거 검사를 없앤 것이 아닙니다.
    const out = validateEssayGeneration({
      items: [{
        cardId: source.cardId,
        question: '~입니까? 에 해당하는 표현을 설명하세요.',
        lengthBand: 'short',
        criteria: [
          { aspect: 'covers_answer', weight: 70, mustMention: ['呢'] },
          { aspect: 'uses_key_terms', weight: 30, mustMention: ['吧'] },
        ],
      }],
    }, [source], (c, i) => `${c}:${i}`)

    expect(out.items).toHaveLength(0)
    expect(out.dropped[0]?.reason).toBe('ungrounded_mention')
  })
})
