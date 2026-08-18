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

const topUp = (() => {
  const i = src.indexOf('outcome.servable && outcome.items.length < sources.length')
  expect(i).toBeGreaterThan(-1)
  return src.slice(i, i + 2600)
})()

describe('보충 호출', () => {
  it('빠진 카드만 다시 물어본다', () => {
    // 전부 다시 물어보면 이미 만든 문항까지 다시 만들고, 중복이 저장됩니다.
    expect(topUp).toMatch(/sources\.filter\(\(s\) => !done\.has\(s\.cardId\)\)/)
    expect(topUp).toMatch(/promptFor\(missing\)/)
    expect(topUp).toMatch(/validateFor\(g2\.json, missing\)/)
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
    expect(topUp).toMatch(/catch \(topUpError\)/)
    expect(topUp).toMatch(/keeping the first pass/)
  })

  it('한 번만 한다', () => {
    // 두 번째까지 못 만든 카드는 뽑기 운이 아니라 유형이 안 맞는 것이고, 그건 정직하게
    // dropped 로 돌려주는 편이 맞습니다.
    const loops = topUp.match(/\b(for|while)\s*\(/g) ?? []
    expect(loops).toHaveLength(0)
  })

  it('배달된 수만큼만 정산한다', () => {
    // 보충으로 늘어난 문항 수가 그대로 정산에 들어가야 합니다 — 요청 수가 아니라.
    expect(src).toMatch(/settleQuiz\(userId, meter\.job_ref, questions\.length/)
  })
})
