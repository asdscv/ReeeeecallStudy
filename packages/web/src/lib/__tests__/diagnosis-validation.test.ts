import { describe, it, expect } from 'vitest'
import {
  validateDiagnosis, diagnosisGroundingError,
  DIAGNOSIS_MIN_SCORED, DIAGNOSIS_MAX_STEPS,
} from '../../../../../supabase/functions/_shared/ai-diagnosis.ts'

/**
 * 진단은 산문을 팔지 않는다. 그리고 근거가 없으면 **아무것도** 팔지 않는다.
 *
 * "학습 진단"은 정답률 한 줄이었습니다. 이제 실제로 AI를 쓰고 크레딧을 씁니다 — 그래서 두
 * 가지가 참이어야 합니다: 돌려주는 것이 화면이 그릴 수 있는 닫힌 집합일 것, 그리고 얇은
 * 근거 위에서는 지갑에 손대기 전에 거절할 것. 세 개의 데이터 위에서 찾은 패턴은 운세이고,
 * 운세를 $1에 파는 것은 이 기능이 존재하는 이유와 정반대입니다.
 */
const CARDS = ['c1', 'c2', 'c3', 'c4']

describe('진단 결과 검증', () => {
  it('발견과 처방을 받아들인다', () => {
    const out = validateDiagnosis({
      findings: [{ theme: 'similar_meaning', cardIds: ['c1', 'c2'], confidence: 0.8 }],
      steps: [{ action: 'drill_cards', cardIds: ['c1', 'c2'] }],
    }, CARDS)
    expect(out.findings).toHaveLength(1)
    expect(out.findings[0].theme).toBe('similar_meaning')
    expect(out.steps).toEqual([{ action: 'drill_cards', cardIds: ['c1', 'c2'] }])
  })

  it('준 적 없는 카드 id 는 버린다', () => {
    // 지어냈거나 카드 내용에 끌려간 것이고, 어느 쪽이든 학습자의 실패와 무관한 카드를
    // 가리킵니다. 두 장 최소선 아래로 떨어지면 발견 자체가 사라집니다.
    const out = validateDiagnosis({
      findings: [{ theme: 'similar_form', cardIds: ['c1', 'ghost'], confidence: 0.9 }],
    }, CARDS)
    expect(out.findings).toEqual([])
  })

  it('얼버무린 발견은 버린다', () => {
    expect(validateDiagnosis({
      findings: [{ theme: 'similar_form', cardIds: ['c1', 'c2'], confidence: 0.4 }],
    }, CARDS).findings).toEqual([])
  })

  it('"패턴 없음"은 발견이 아니다', () => {
    // 모델이 그렇게 **말할 수 있어야** 합니다 — 없으면 지어냅니다. 다만 화면에 그릴 것은
    // 아닙니다.
    expect(validateDiagnosis({
      findings: [{ theme: 'no_pattern', cardIds: ['c1', 'c2'], confidence: 0.99 }],
    }, CARDS).findings).toEqual([])
  })

  it('확신도 순으로 카드를 가져간다 — 배열 위치로 이기지 못한다', () => {
    // 모델 순서대로 가져가게 두면 앞의 약한 발견이 강한 발견의 카드를 먹고, 강한 쪽이 두 장
    // 최소선 아래로 떨어집니다. 약한 답이 순전히 위치로 이기는 것입니다.
    const out = validateDiagnosis({
      findings: [
        { theme: 'long_answer', cardIds: ['c1', 'c2', 'c3'], confidence: 0.55 },
        { theme: 'similar_meaning', cardIds: ['c1', 'c2'], confidence: 0.95 },
      ],
    }, CARDS)
    expect(out.findings.map((f) => f.theme)).toEqual(['similar_meaning'])
    expect(out.findings[0].cardIds).toEqual(['c1', 'c2'])
  })

  it('처방은 세 개까지, 중복 없이', () => {
    const out = validateDiagnosis({
      findings: [],
      steps: [
        { action: 'drill_cards', cardIds: ['c1'] },
        { action: 'drill_cards', cardIds: ['c2'] },
        { action: 'split_card', cardIds: [] },
        { action: 'clarify_prompt', cardIds: [] },
        { action: 'slow_down', cardIds: [] },
      ],
    }, CARDS)
    expect(out.steps).toHaveLength(DIAGNOSIS_MAX_STEPS)
    expect(out.steps.map((s) => s.action)).toEqual(['drill_cards', 'split_card', 'clarify_prompt'])
  })

  it('모르는 라벨은 조용히 버린다 — throw 하지 않는다', () => {
    // 나쁜 모델 응답은 평범한 사건입니다. 호출자의 대안은 아무것도 안 보여주는 것이고,
    // 엣지는 그때 홀드를 풀고 청구하지 않습니다.
    for (const bad of [null, 42, 'nope', {}, { findings: 'x' }]) {
      expect(() => validateDiagnosis(bad, CARDS)).not.toThrow()
      expect(validateDiagnosis(bad, CARDS)).toEqual({ findings: [], steps: [] })
    }
    expect(validateDiagnosis({
      findings: [{ theme: 'made_up', cardIds: ['c1', 'c2'], confidence: 1 }],
      steps: [{ action: 'buy_more_credits', cardIds: [] }],
    }, CARDS)).toEqual({ findings: [], steps: [] })
  })
})

describe('팔기 전 근거 검사', () => {
  const enough = {
    scored: 40, known: 25,
    mcq_flaws: { adjacent_sense: 7, right_category_wrong_item: 3 },
  }

  it('충분하면 통과', () => {
    expect(diagnosisGroundingError(enough)).toBeNull()
  })

  it('답이 적으면 거절 — 지갑에 닿기 전에', () => {
    expect(diagnosisGroundingError({ ...enough, scored: DIAGNOSIS_MIN_SCORED - 1 }))
      .toBe('NOT_ENOUGH_ANSWERS')
    expect(diagnosisGroundingError({})).toBe('NOT_ENOUGH_ANSWERS')
  })

  it('전부 맞혔으면 진단할 것이 없다', () => {
    // 정답률만으로는 "무엇을 많이 틀리는가"에 답할 수 없습니다. 답할 수 없는 것을 팔지
    // 않겠다는 것이 이 검사의 전부입니다.
    expect(diagnosisGroundingError({ scored: 40, known: 40, mcq_flaws: {} }))
      .toBe('NOT_ENOUGH_MISSES')
  })

  it('라벨이 없어도 오답이 충분하면 통과한다', () => {
    // 퀴즈를 한 번도 안 풀고 플랜 자기평가만 한 학습자에게는 flaw 라벨이 없습니다. 그래도
    // 카드끼리 닮았는지는 물어볼 수 있습니다.
    expect(diagnosisGroundingError({ scored: 40, known: 30 })).toBeNull()
  })
})
