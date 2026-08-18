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
import { quizGrowth } from '@reeeeecall/shared/lib/quiz-shortfall'

describe('생성 진행 판정', () => {
  it('다 찼으면 조회도 경고도 없다', () => {
    expect(quizGrowth(20, 20, null)).toEqual({ polling: false, cameUpShort: false, missing: 0 })
    expect(quizGrowth(20, 20, 20).cameUpShort).toBe(false)
  })

  it('모자라고 아직 포기 전이면 조회만 한다', () => {
    const g = quizGrowth(8, 20, null)
    expect(g.polling).toBe(true)
    expect(g.cameUpShort).toBe(false)
    expect(g.missing).toBe(12)
  })

  it('그 수에서 포기했으면 조회를 그만두고 말한다', () => {
    const g = quizGrowth(4, 5, 4)
    expect(g.polling).toBe(false)
    expect(g.cameUpShort).toBe(true)
    expect(g.missing).toBe(1)
  })

  it('포기한 뒤에 문항이 더 도착하면 다시 기다린다', () => {
    // 4에서 포기했는데 5번째가 늦게 도착한 경우입니다. 그 자리에 "모자랍니다"가 남아
    // 있으면 다 찬 퀴즈에 경고가 붙습니다.
    expect(quizGrowth(6, 8, 4).polling).toBe(true)
    expect(quizGrowth(6, 8, 4).cameUpShort).toBe(false)
  })

  it('요청 수를 모르면 아무 말도 하지 않는다', () => {
    expect(quizGrowth(10, null, 10)).toEqual({ polling: false, cameUpShort: false, missing: 0 })
    expect(quizGrowth(10, undefined, 10).cameUpShort).toBe(false)
  })

  it('요청보다 많으면 모자란 것이 아니다', () => {
    expect(quizGrowth(12, 10, 12).cameUpShort).toBe(false)
  })
})
