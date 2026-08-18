/**
 * 모자라면 모자란 만큼 다시 물어본다.
 *
 * 엣지에는 이미 재시도가 있었지만 **배치가 전멸했을 때만** 돌았습니다. 그래서 프로덕션에서
 * 실제로 잰 "3문항 요청 → 2문항 도착"은 그대로 통과했습니다 — 학습자는 요청한 수를 못 받았고
 * 아무도 그렇다고 말해 주지 않았습니다.
 *
 * 소스를 읽어 확인합니다. 엣지는 Deno 런타임이라 여기서 실행할 수 없고, 확인하려는 것은
 * "그 분기가 존재하고, 올바른 자리에 있고, 청구를 늘리지 않는다"이기 때문입니다.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const src = readFileSync(join(here, '../../../../../supabase/functions/ai-generate/index.ts'), 'utf8')

/** 채우기 블록 전체. 끝은 그다음 주석 블록(`The drop reasons ARE`)이 시작하는 자리입니다. */
const topUp = (() => {
  const i = src.indexOf('outcome.servable && outcome.items.length < sources.length')
  expect(i).toBeGreaterThan(-1)
  const end = src.indexOf('The drop reasons ARE', i)
  expect(end).toBeGreaterThan(i)
  return src.slice(i, end)
})()

describe('보충 호출', () => {
  it('빠진 카드만 다시 물어본다', () => {
    // 전부 다시 물어보면 이미 만든 문항까지 다시 만들고, 중복이 저장됩니다.
    expect(topUp).toMatch(/sources\.filter\(\(s\) => !done\.has\(s\.cardId\)\)/)
    expect(topUp).toMatch(/promptFor\(subset\)/)
    expect(topUp).toMatch(/validateFor\(g2\.json, subset\)/)
  })

  it('토큰을 합친다 — 두 번 부른 원가가 한 번으로 기록되면 마진이 거짓이 된다', () => {
    expect(topUp).toMatch(/tokensIn.*\+.*g2\.usage/s)
    expect(topUp).toMatch(/tokensOut.*\+.*g2\.usage/s)
  })

  it('추가 예약을 하지 않는다 — 예약은 이미 잡혀 있다', () => {
    // 보충 안에서 reserve 를 다시 부르면 같은 요청에 두 번 청구됩니다.
    expect(topUp).not.toMatch(/reserve_ai_quiz/)
  })

  it('보충이 실패해도 첫 판을 잃지 않는다', () => {
    // 덤으로 하는 일이 본체를 죽이면 안 됩니다.
    expect(topUp).toMatch(/catch \(fillError\)/)
    expect(topUp).toMatch(/keeping what we have/)
  })

  it('두 단계다 — 같은 카드 재시도, 그다음 대체 카드', () => {
    // 학습자가 고른 카드를 지키는 쪽이 먼저입니다. 그래도 안 되면 덱의 다른 적격 카드로
    // 바꿉니다 — 어떤 카드는 그 유형에 정말 안 맞고(한 단어짜리 카드로 서술형 루브릭을
    // 세울 수 없습니다), 그때 모자란 채로 내놓는 것은 학습자가 고른 수를 포기하는 것입니다.
    expect(topUp).toMatch(/pass === 0/)
    expect(topUp).toMatch(/quiz_substitute_cards/)
    expect(topUp).toMatch(/pass < 2/)
  })

  it('적격성 규칙을 다시 쓰지 않는다', () => {
    // 엣지에서 cards 를 직접 골라 오면 규칙의 두 번째 사본이 생기고, 갈라지는 날
    // "견적에는 세어졌는데 생성에는 안 뽑히는 카드"가 나옵니다(mig 221).
    expect(topUp).not.toMatch(/from\('cards'\)[\s\S]{0,200}deck_id/)
  })

  it('요청한 수를 넘기지 않는다', () => {
    // 대체 카드를 넉넉히 받아 왔을 수 있습니다. 넘겨 만들면 학습자가 고른 수보다 많이
    // 만들고 많이 청구합니다.
    expect(topUp).toMatch(/slice\(0, room\)/)
  })

  it('덱에 남은 카드가 없으면 조용히 멈춘다', () => {
    // 정직하게 모자란 채로 끝내는 편이, 던져서 이미 만든 문항까지 잃는 것보다 낫습니다.
    expect(topUp).toMatch(/ids\.length === 0\) break/)
  })

  it('배달된 수만큼만 정산한다', () => {
    // 보충으로 늘어난 문항 수가 그대로 정산에 들어가야 합니다 — 요청 수가 아니라.
    expect(src).toMatch(/settleQuiz\(userId, meter\.job_ref, questions\.length/)
  })
})
