/**
 * `replayed: true` 는 "이미 예약했다"가 아니라 "이미 했다"이다.
 *
 * `reserve_ai_quiz` 는 같은 `client_ref` 를 advisory lock 으로 직렬화하고 두 번째부터
 * `replayed: true` 를 돌려줍니다. 그런데 엣지가 그 값을 **읽지 않았습니다.** 프로덕션에서
 * 실제로 재 본 결과:
 *
 *       같은 clientRef 로 동시에 8번  →  청구 1회(20,000) · 저장된 문항 16개 · 모델 호출 8회
 *
 * 지갑은 지켜졌지만 두 가지가 망가집니다. 학습자가 2문항으로 만든 세트에 16문항이 들어가고,
 * 우리는 한 번 받고 여덟 번 냅니다. 네트워크가 끊겨 재시도하는 정상 클라이언트도 같은 자리를
 * 밟습니다 — 재시도는 잘못이 아니고, 그래서 `client_ref` 가 있는 것입니다.
 *
 * 소스를 읽어 확인합니다. 엣지 함수는 Deno 런타임이라 여기서 실행할 수 없고, 확인하려는 것은
 * "그 분기가 존재하고, 모델을 부르기 전에 있다"이기 때문입니다.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const src = readFileSync(join(here, '../../../../../supabase/functions/ai-generate/index.ts'), 'utf8')

/** `kind === '<name>'` 분기 하나의 본문. */
function branch(name: string): string {
  const start = src.indexOf(`kind === '${name}'`)
  expect(start).toBeGreaterThan(-1)
  const rest = src.slice(start)
  const next = rest.slice(10).search(/kind === '/)
  return next === -1 ? rest : rest.slice(0, next + 10)
}

describe('replay 가드', () => {
  it.each(['quiz_generate', 'quiz_grade'])('%s 가 replayed 를 읽는다', (name) => {
    expect(branch(name)).toMatch(/meter\.replayed === true/)
  })

  it.each(['quiz_generate', 'quiz_grade'])('%s 는 모델을 부르기 전에 빠져나간다', (name) => {
    const b = branch(name)
    const guard = b.indexOf('meter.replayed === true')
    // `generate(` 는 이 파일에서 모델을 부르는 유일한 함수입니다.
    const call = b.search(/\bawait generate\(/)
    expect(guard).toBeGreaterThan(-1)
    expect(call).toBeGreaterThan(-1)
    expect(guard).toBeLessThan(call)
  })

  it('replay 응답은 잔액을 건드리지 않았다고 말한다', () => {
    // `balance: null` 이 "그대로"라는 뜻입니다 — 해설/진단 쪽이 이미 같은 약속을 씁니다.
    for (const name of ['quiz_generate', 'quiz_grade']) {
      const b = branch(name)
      const seg = b.slice(b.indexOf('meter.replayed === true'))
      expect(seg.slice(0, 900)).toMatch(/balance: null/)
      expect(seg.slice(0, 900)).toMatch(/replayed: true/)
    }
  })
})
