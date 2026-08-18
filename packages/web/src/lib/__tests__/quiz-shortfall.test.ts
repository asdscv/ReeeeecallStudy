/**
 * 못 채운 퀴즈는 그렇다고 말해야 하고, 조회는 멈춰야 한다.
 *
 * 회차 화면은 세트가 요청 수보다 적으면 4초마다 다시 읽었습니다. 배치가 뒤따라 오기
 * 때문인데, 영원히 못 채우는 경우가 있습니다 — 프로덕션에서 실제로 잰 것: 카드 5장짜리
 * 덱에 주관식 5문항을 요청하면 4문항이 만들어집니다(한 장이 그 유형에 안 맞고, 바꿔 쓸
 * 카드가 덱에 남아 있지 않습니다).
 *
 * 그때 두 가지가 같이 일어났습니다: 조회가 끝없이 돌고, 학습자는 왜 5문항을 골랐는데
 * 4문항인지 아무 설명도 못 받습니다.
 */
import { describe, it, expect } from 'vitest'
import {
  quizGrowth, QUIZ_GROWTH_IDLE_TICKS,
} from '@reeeeecall/shared/lib/quiz-shortfall'

describe('생성 진행 판정', () => {
  it('다 찼으면 조회도 경고도 없다', () => {
    expect(quizGrowth(20, 20, 0)).toEqual({ polling: false, cameUpShort: false, missing: 0 })
    // 늘어난 지 한참 지나도 마찬가지입니다.
    expect(quizGrowth(20, 20, 99).cameUpShort).toBe(false)
  })

  it('모자라고 아직 늘고 있으면 조회만 한다', () => {
    const g = quizGrowth(8, 20, 0)
    expect(g.polling).toBe(true)
    expect(g.cameUpShort).toBe(false)
    expect(g.missing).toBe(12)
  })

  it('멈춘 채로 한계에 닿으면 조회를 그만두고 말한다', () => {
    // 상한에서 역산합니다 — 손으로 적으면 조정할 때마다 여기서 터집니다.
    const g = quizGrowth(4, 5, QUIZ_GROWTH_IDLE_TICKS)
    expect(g.polling).toBe(false)
    expect(g.cameUpShort).toBe(true)
    expect(g.missing).toBe(1)
  })

  it('한계 직전까지는 아직 기다린다', () => {
    expect(quizGrowth(4, 5, QUIZ_GROWTH_IDLE_TICKS - 1).polling).toBe(true)
    expect(quizGrowth(4, 5, QUIZ_GROWTH_IDLE_TICKS - 1).cameUpShort).toBe(false)
  })

  it('요청 수를 모르면 아무 말도 하지 않는다', () => {
    // 옛 회차에는 없을 수 있습니다. 없는 것을 근거로 경고를 붙이면 멀쩡한 퀴즈에
    // "모자랍니다"가 뜹니다.
    expect(quizGrowth(10, null, 99)).toEqual({ polling: false, cameUpShort: false, missing: 0 })
    expect(quizGrowth(10, undefined, 99).cameUpShort).toBe(false)
  })

  it('요청보다 많으면 모자란 것이 아니다', () => {
    expect(quizGrowth(12, 10, 99).cameUpShort).toBe(false)
  })
})
