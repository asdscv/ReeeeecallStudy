/**
 * `clientRef` 는 UUID 여야 한다.
 *
 * 멱등키로 그대로 `reserve_ai_quiz(p_client_ref uuid)` 에 넘어갑니다. 문자열이기만 하면
 * 통과시켰더니 캐스트가 SQL 에서 터졌고 — 프로덕션에서 실제로 확인했습니다 —
 * `clientRef: "not-a-uuid"` 한 줄이 **500 AI_METER_ERROR** 로 나갔습니다. 400 이어야 할
 * 자리입니다. 500 은 "서버가 잘못했다"는 뜻이고, 이건 요청이 잘못한 경우입니다.
 *
 * 서버 소스에서 정규식을 직접 읽습니다 — 여기 다시 적으면 서버가 바뀔 때 조용히 갈라집니다.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const src = readFileSync(join(here, '../../../../../supabase/functions/ai-generate/index.ts'), 'utf8')

function serverPattern(): RegExp {
  const m = /const CLIENT_REF = (\/.*\/i)/.exec(src)
  if (!m) throw new Error('CLIENT_REF not found in the edge function')
  const body = m[1].slice(1, -2)
  return new RegExp(body, 'i')
}

describe('clientRef', () => {
  const re = serverPattern()

  it('crypto.randomUUID() 가 만드는 값을 받는다', () => {
    // 클라이언트가 실제로 보내는 것입니다. 이 검사로 정상 요청을 잃으면 안 됩니다.
    for (let i = 0; i < 50; i++) expect(re.test(crypto.randomUUID())).toBe(true)
  })

  it.each([
    ['빈 문자열', ''],
    ['UUID 아님', 'not-a-uuid'],
    ['SQL 조각', "'; DROP TABLE quiz_questions; --"],
    ['하이픈 없는 32자', '0123456789abcdef0123456789abcdef'],
    ['버전 자리가 0', '00000000-0000-0000-8000-000000000000'],
    ['variant 자리가 틀림', '00000000-0000-4000-0000-000000000000'],
    ['앞뒤 공백', ' 11111111-1111-4111-8111-111111111111 '],
  ])('%s 는 거절한다', (_label, value) => {
    expect(re.test(value)).toBe(false)
  })

  it('두 분기가 같은 검사기를 쓴다', () => {
    // 생성과 채점 둘 다입니다. 하나만 고치면 나머지 하나로 같은 500 이 계속 나옵니다.
    const uses = src.match(/asClientRef\(body\.clientRef\)/g) ?? []
    expect(uses).toHaveLength(2)
  })
})
