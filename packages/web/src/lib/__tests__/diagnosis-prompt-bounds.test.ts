/**
 * 진단 프롬프트에는 상한이 있어야 한다.
 *
 * `buildDiagnosisPrompt` 는 넘어온 카드 목록을 그대로 직렬화했습니다. 그 목록은 50개까지
 * 받고(`asUuidList`), 카드 한 장은 2,000자까지 됩니다(mig 259). 그래서 진단 한 번이 10만 자를
 * 모델에 밀어 넣을 수 있었습니다 — 프로덕션에서 실측한 보통 요청은 카드 6장 · 입력 1,348토큰
 * 이었고, 값은 둘 다 같은 $0.05 입니다.
 *
 * 값과 상한은 한 쌍입니다. 값을 원가의 98배로 내리면서 입력 상한을 안 두면, 내린 값으로 훨씬
 * 큰 요청을 파는 셈이 됩니다. 이 파일이 그 쌍의 한쪽을 붙잡습니다.
 */
import { describe, it, expect } from 'vitest'
import {
  buildDiagnosisPrompt, DIAGNOSIS_MAX_PROMPT_CARDS, DIAGNOSIS_MAX_CARD_CHARS,
} from '../../../../../supabase/functions/_shared/ai-diagnosis.ts'

const evidence = { goal_id: 'g', days: 30, attempts: 62, scored: 62, known: 52 } as never

/** 상한에서 역산합니다 — 숫자를 손으로 적으면 상한을 조정할 때마다 여기서 터집니다. */
function cards(n: number, chars: number) {
  return Array.from({ length: n }, (_, i) => ({
    id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
    prompt: '가'.repeat(chars),
    answer: '나'.repeat(chars),
  }))
}

describe('진단 프롬프트', () => {
  it('카드 수를 상한까지만 싣는다', () => {
    const many = cards(DIAGNOSIS_MAX_PROMPT_CARDS + 20, 10)
    const { userPrompt } = buildDiagnosisPrompt({ evidence, cards: many })
    const parsed = JSON.parse(userPrompt)
    expect(parsed.cards).toHaveLength(DIAGNOSIS_MAX_PROMPT_CARDS)
  })

  it('카드 한 장의 글자 수를 자른다', () => {
    const long = cards(2, DIAGNOSIS_MAX_CARD_CHARS + 1800)
    const parsed = JSON.parse(buildDiagnosisPrompt({ evidence, cards: long }).userPrompt)
    for (const c of parsed.cards) {
      expect(c.prompt.length).toBe(DIAGNOSIS_MAX_CARD_CHARS)
      expect(c.answer.length).toBe(DIAGNOSIS_MAX_CARD_CHARS)
    }
  })

  it('최악의 요청이 실측의 몇 배 안쪽으로 묶인다', () => {
    // 카드 50장 x 2,000자 = 10만 자가 들어오던 자리입니다. 상한이 붙은 뒤의 최악을 잽니다.
    const worst = buildDiagnosisPrompt({ evidence, cards: cards(50, 2000) }).userPrompt
    expect(worst.length).toBeLessThan(
      DIAGNOSIS_MAX_PROMPT_CARDS * (DIAGNOSIS_MAX_CARD_CHARS * 2 + 200) + 2000)
    // 그리고 자르기 전이었다면 넘었을 크기보다 확실히 작습니다.
    expect(worst.length).toBeLessThan(50 * 2000 / 4)
  })

  it('상한 안쪽 요청은 손대지 않는다', () => {
    // 보통 요청이 잘려 나가면 진단의 근거가 조용히 얇아집니다.
    const normal = cards(6, 40)
    const parsed = JSON.parse(buildDiagnosisPrompt({ evidence, cards: normal }).userPrompt)
    expect(parsed.cards).toHaveLength(6)
    expect(parsed.cards[0].prompt).toBe(normal[0].prompt)
  })

  it('아직 근거는 그대로 실린다', () => {
    const parsed = JSON.parse(buildDiagnosisPrompt({ evidence, cards: cards(3, 10) }).userPrompt)
    expect(parsed.evidence).toEqual(evidence)
  })
})
