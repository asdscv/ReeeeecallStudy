import { describe, it, expect } from 'vitest'
import {
  validateMultipleChoiceGeneration, MCQ_EXPLANATION_AXES,
} from '../../../../../supabase/functions/_shared/ai-quiz.ts'

/**
 * 해설은 **문제와 함께** 만들어진다.
 *
 * 245 는 해설을 답한 뒤 파는 것으로 만들었습니다. 축이 학습자가 고른 보기에 달려 있으니 그
 * 순서가 자연스러워 보였는데, 값이 이랬습니다: 답할 때마다 프로바이더 호출 하나($0.05),
 * **학습자가 이미 답을 제출한 뒤에** 실패할 수 있는 호출, 그리고 해설을 보기 위한 제스처 하나.
 *
 * 오답 보기는 넉 개뿐입니다. 생성할 때 보기마다 축을 하나씩 쓰면 무엇을 고르든 해설이 이미
 * 거기 있습니다(252). 이 파일은 그 계약을 고정합니다.
 */
type Sources = Parameters<typeof validateMultipleChoiceGeneration>[1]

const card = (over: Record<string, unknown> = {}) => ({
  cardId: 'c1',
  promptText: 'lend',
  answerText: '빌려주다',
  extraFields: [],
  fillers: ['갚다', '임대하다', '맡기다'],
  crossLingual: false,
  ...over,
})

const run = (distractors: unknown[], over?: Record<string, unknown>) =>
  validateMultipleChoiceGeneration(
    { items: [{ cardId: 'c1', question: 'lend 의 뜻으로 옳은 것은?', distractors }] },
    [card(over)] as unknown as Sources,
    (c, i) => `${c}:${i}`,
  )

const mcq = (out: ReturnType<typeof run>) => {
  expect(out.items).toHaveLength(1)
  const item = out.items[0]
  if (item.type !== 'multiple_choice') throw new Error(`객관식이 아니다: ${item.type}`)
  return item
}

describe('보기마다 축', () => {
  it('축이 보기와 나란히, 정답 자리는 null', () => {
    const item = mcq(run([
      { text: '빌리다', flaw: 'opposite', axis: 'direction' },
      { text: '대여 계약', flaw: 'adjacent_sense', axis: 'scope' },
      { text: '기다리다', flaw: 'unrelated', axis: 'category' },
    ]))
    expect(item.axes).toHaveLength(item.options.length)
    expect(item.axes[item.correctIndex]).toBeNull()
    // 정답 자리를 뺀 나머지가 우리가 준 축들입니다. 순서는 셔플에 달렸으니 집합으로 봅니다.
    expect(item.axes.filter((a) => a !== null).sort())
      .toEqual(['category', 'direction', 'scope'])
  })

  it('축이 보기와 같은 자리에 붙는다 — 어긋나면 남의 실수를 설명한다', () => {
    const item = mcq(run([
      { text: '빌리다', flaw: 'opposite', axis: 'direction' },
      { text: '대여 계약', flaw: 'adjacent_sense', axis: 'scope' },
      { text: '기다리다', flaw: 'unrelated', axis: 'category' },
    ]))
    const pairs = new Map([['빌리다', 'direction'], ['대여 계약', 'scope'], ['기다리다', 'category']])
    item.options.forEach((opt, i) => {
      if (i === item.correctIndex) return
      expect(item.axes[i], opt).toBe(pairs.get(opt))
    })
  })

  it('모르는 축은 null 로 떨어뜨리고 문항은 살린다', () => {
    // 축은 덤입니다. 이것 때문에 보기를 버리면 `too_few_distractors` 로 문항이 통째로 날아가고,
    // 학습자는 더 나은 해설 대신 아무 문제도 못 받습니다.
    const item = mcq(run([
      { text: '빌리다', flaw: 'opposite', axis: 'made_up' },
      { text: '대여 계약', flaw: 'adjacent_sense' },
      { text: '기다리다', flaw: 'unrelated', axis: 42 },
    ]))
    expect(item.options).toHaveLength(4)
    expect(item.axes.filter((a) => a !== null)).toEqual([])
  })

  it('덱메이트로 채운 보기는 category — 모델에 묻지 않는다', () => {
    // 다른 카드의 답이니 정의상 다른 갈래입니다. 그걸 알아내려고 호출을 늘릴 이유가 없습니다.
    const item = mcq(run([{ text: '빌리다', flaw: 'opposite', axis: 'direction' }]))
    expect(item.options).toHaveLength(4)
    const axes = item.axes.filter((a) => a !== null)
    expect(axes).toContain('direction')
    expect(axes.filter((a) => a === 'category')).toHaveLength(2)
  })

  it('여덟 축 전부 통과한다 — 프롬프트가 제안하는 것과 검증이 받는 것이 같아야 한다', () => {
    for (const axis of MCQ_EXPLANATION_AXES) {
      const item = mcq(run([{ text: '빌리다', flaw: 'opposite', axis }]))
      expect(item.axes, axis).toContain(axis)
    }
  })
})
