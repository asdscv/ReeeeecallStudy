import { describe, it, expect } from 'vitest'
import { affordableQuestionCount } from '@reeeeecall/shared/lib/quiz-pricing'

/** 이 함수가 실제로 읽는 필드만 담은 최소 견적. `as any` 는 eslint 가 막습니다. */
type Quote = Parameters<typeof affordableQuestionCount>[0]

/**
 * 크레딧이 모자랄 때 **몇 문항이면 되는지**를 화면이 말할 수 있어야 한다.
 *
 * 예약은 설계상 전부 아니면 전무입니다 — 값을 미리 합의하고, 지갑이 못 대면 P0002 로
 * 거절합니다. 그 자체는 맞는 모양인데, 화면은 그 위에 빨간 줄 하나와 막힌 버튼만 뒀습니다.
 *
 * 실제 함수로 재 보면: 잔액 0, 무료 5문항 남은 학습자가 10문항을 요청하면 견적이
 * `무료 5 / 유료 5 / $0.50 / sufficient false` 이고 예약은 P0002 입니다. **5개도 안 만들어
 * 집니다.** 정확히 5를 찍은 학습자만 무료분을 쓸 수 있었습니다.
 */
const quote = (over: Record<string, unknown> = {}) => ({
  count: 10,
  price_micro: 500000,
  free_items: 5,
  trial_items: 0,
  paid_items: 5,
  free_items_limit: 5,
  free_items_remaining_today: 5,
  units_each: 2,
  unit_price_micro: 50000,   // 문항당 2 × 50,000 = 100,000 = $0.10
  balance_micro: 0,
  trial_remaining: 0,
  sufficient: false,
  ...over,
}) as unknown as Quote

describe('만들 수 있는 문항 수', () => {
  it('잔액 0 · 무료 5 남음 → 5', () => {
    // 프로덕션 함수로 실제 측정한 그 상황.
    expect(affordableQuestionCount(quote(), 10)).toBe(5)
  })

  it('잔액으로 살 수 있는 만큼 더해진다', () => {
    // $0.25 면 문항당 $0.10 이니 두 문항. 무료 5 + 유료 2 = 7.
    expect(affordableQuestionCount(quote({ balance_micro: 250000 }), 10)).toBe(7)
  })

  it('요청한 수를 넘지 않는다', () => {
    // "지금 살 수 있는 최대"가 아니라 "원한 것 중 가능한 만큼"입니다. 요청보다 많이 제안하면
    // 크레딧이 모자란다는 화면에서 더 많이 사라고 권하는 셈입니다.
    expect(affordableQuestionCount(quote({ balance_micro: 100000000 }), 10)).toBe(10)
    expect(affordableQuestionCount(quote({ free_items_remaining_today: 50 }), 4)).toBe(4)
  })

  it('체험분은 유닛이라 유형마다 다른 수가 된다', () => {
    // 체험 6유닛: 객관식(2유닛)이면 3문항, 서술형(3유닛)이면 2문항. 유닛을 그대로 문항 수로
    // 쓰면 서술형에서 실제보다 많이 약속하고 예약이 다시 거절됩니다.
    expect(affordableQuestionCount(
      quote({ free_items_remaining_today: 0, trial_remaining: 6, units_each: 2 }), 10)).toBe(3)
    expect(affordableQuestionCount(
      quote({ free_items_remaining_today: 0, trial_remaining: 6, units_each: 3 }), 10)).toBe(2)
  })

  it('아무것도 못 하면 0 — 화면은 제안을 숨긴다', () => {
    expect(affordableQuestionCount(
      quote({ free_items_remaining_today: 0, trial_remaining: 0, balance_micro: 0 }), 10)).toBe(0)
    expect(affordableQuestionCount(null, 10)).toBe(0)
    expect(affordableQuestionCount(undefined, 10)).toBe(0)
  })

  it('이미 충분하면 요청한 수를 그대로 돌려준다', () => {
    // 호출자가 `sufficient` 를 먼저 검사하지 않고도 쓸 수 있어야 합니다.
    expect(affordableQuestionCount(quote({ sufficient: true, balance_micro: 0 }), 10)).toBe(10)
  })

  it('단가가 0이면 잔액으로 나누지 않는다', () => {
    // 0으로 나누면 Infinity 가 되고, 화면이 "10000문항으로 만들기"를 권하게 됩니다.
    const out = affordableQuestionCount(
      quote({ unit_price_micro: 0, free_items_remaining_today: 2, balance_micro: 500000 }), 10)
    expect(Number.isFinite(out)).toBe(true)
    expect(out).toBe(2)
  })
})
