import { describe, it, expect } from 'vitest'
import { validateMultipleChoiceGeneration } from '../../../../../supabase/functions/_shared/ai-quiz.ts'

/**
 * 객관식 문항에는 **문제 문장**이 있어야 한다.
 *
 * 지금까지 객관식 지문은 `card.promptText` 였다 — 모델이 쓴 적이 없다. 프롬프트는 오답 보기만
 * 요청했고, 지문은 우리 코드가 카드 앞면을 그대로 넣었다. 어휘 카드에서는 그럭저럭 읽히지만
 * 앞면이 제목인 카드에서는 문제가 아니다:
 *
 *     지문: "인수분해 공식(1) - 완전제곱식"
 *     보기: a²+2ab+b²=(a+b)² …  (무엇을 고르라는 건지 아무 말이 없음)
 *
 * 이제 모델이 쓰고, 우리는 그것을 검사한 뒤 쓴다. 폴백은 남긴다 — 지문이 없거나 거절돼도
 * 문항 전체를 버리면 안 된다. 제목이라도 보여주는 편이 아무것도 없는 것보다 낫다.
 */
const card = (over: Record<string, unknown> = {}) => ({
  cardId: 'c1',
  promptText: '인수분해 공식(1) - 완전제곱식',
  answerText: 'a²+2ab+b²=(a+b)²',
  extraFields: [],
  fillers: ['경매', '빙하', '나침반'],
  crossLingual: false,
  ...over,
})

const raw = (question: unknown) => ({
  items: [{
    cardId: 'c1',
    question,
    distractors: [
      { text: 'a²+2ab+b²=(a+b)(a−b)', flaw: 'plausible_form' },
      { text: 'a²+2ab+b²=a²+b²', flaw: 'overgeneral' },
      { text: 'a²−b²=(a+b)(a−b)', flaw: 'right_category_wrong_item' },
    ],
  }],
})

const run = (question: unknown, over?: Record<string, unknown>) =>
  // deno-lint-ignore no-explicit-any
  validateMultipleChoiceGeneration(raw(question), [card(over)] as any, (c, i) => `${c}:${i}`)

describe('객관식 지문', () => {
  it('모델이 쓴 문제 문장을 쓴다', () => {
    const out = run('완전제곱식의 인수분해 공식으로 옳은 것은?')
    expect(out.items).toHaveLength(1)
    expect(out.items[0].question).toBe('완전제곱식의 인수분해 공식으로 옳은 것은?')
  })

  it('지문이 없으면 카드 앞면으로 물러난다 — 문항을 버리지 않는다', () => {
    // 예전 동작. 제목이라도 보여주는 게 문항을 통째로 잃는 것보다 낫다.
    for (const missing of [undefined, null, '', '   ', 42]) {
      const out = run(missing)
      expect(out.items, String(missing)).toHaveLength(1)
      expect(out.items[0].question, String(missing)).toBe('인수분해 공식(1) - 완전제곱식')
    }
  })

  it('정답이 든 지문은 쓰지 않는다 — 답을 알려주는 문제가 되므로', () => {
    const out = run('a²+2ab+b²=(a+b)² 가 맞는 것은?')
    expect(out.items).toHaveLength(1)
    expect(out.items[0].question).toBe('인수분해 공식(1) - 완전제곱식')
  })

  it('우리 JSON 키 이름이 든 지문도 쓰지 않는다', () => {
    const out = run('다음 카드의 prompt 에 해당하는 것은?')
    expect(out.items[0].question).toBe('인수분해 공식(1) - 완전제곱식')
  })

  it('너무 긴 지문은 쓰지 않는다', () => {
    expect(run('가'.repeat(401)).items[0].question).toBe('인수분해 공식(1) - 완전제곱식')
  })

  it('마크업은 벗겨서 쓴다 — 학습자가 태그를 읽게 되므로', () => {
    expect(run('<b>완전제곱식</b>의 공식으로 옳은 것은?').items[0].question)
      .toBe('완전제곱식의 공식으로 옳은 것은?')
  })
})

/**
 * 덱메이트 보기가 이미 있는 보기를 삼키면 같은 보기가 두 번 나온다.
 *
 * `seen` 은 정규화 후 **완전히 같은** 것만 잡는다. 답 필드가 공식 + 암기팁 두 줄인 덱메이트는
 * 모델이 쓴 한 줄짜리 오답과 같지 않아서 둘 다 보기에 올랐다 — 실제 수학 덱에서 신고됨.
 */
describe('덱메이트 보기 중복', () => {
  it('이미 있는 보기를 포함하거나 포함되는 덱메이트는 쓰지 않는다', () => {
    const out = validateMultipleChoiceGeneration(
      {
        items: [{
          cardId: 'c1',
          question: '옳은 것은?',
          // 두 개만 주고, 나머지 한 자리를 필러가 채우게 한다
          distractors: [
            { text: 'a²−b²=(a+b)(a−b)', flaw: 'right_category_wrong_item' },
            { text: 'a²+2ab+b²=a²+b²', flaw: 'overgeneral' },
          ],
        }],
      },
      // 첫 필러는 이미 있는 보기를 통째로 담고 있다 → 건너뛰고 다음 필러를 쓴다.
      // 두 번째 필러는 길이를 맞춘다 — 짧은 보기는 평균을 끌어내려 length_cue 로 문항이 버려진다.
      // deno-lint-ignore no-explicit-any
      [card({ fillers: ['a²−b²=(a+b)(a−b)\n(제곱)−(제곱)=(합)×(차)', 'x²+5x+6=(x+2)(x+3)'] })] as any,
      (c, i) => `${c}:${i}`,
    )
    expect(out.items).toHaveLength(1)
    const options = out.items[0].options
    expect(options).toContain('x²+5x+6=(x+2)(x+3)')
    expect(options.some((o) => o.includes('(제곱)−(제곱)'))).toBe(false)
    // 그리고 어떤 보기도 다른 보기를 삼키지 않는다
    for (const a of options) {
      for (const b of options) {
        if (a === b) continue
        expect(a.includes(b), `${a} ⊃ ${b}`).toBe(false)
      }
    }
  })
})
