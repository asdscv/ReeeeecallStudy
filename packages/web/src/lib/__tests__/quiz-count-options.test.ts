/**
 * 화면이 제시하는 길이는 서버가 받는 길이여야 한다.
 *
 * 설정 화면은 [4, 6, 8, 10, 12, 20, 30, 50] 을 보여 주는데 스키마는 12 에서 막고 있었습니다.
 * 프로덕션에서 눌러 본 결과 20·30·50 은 전부 400(23514, CHECK 위반)이었습니다 — 학습자가
 * 고를 수 있는 선택지의 절반이 원시 제약 위반 에러였습니다.
 *
 * 두 숫자가 서로 다른 파일에 살면서 관계가 어디에도 적혀 있지 않으면 이런 일이 생깁니다.
 * `quiz-batch-size.test.ts` 가 배치 크기에 대해 하는 일을, 이 파일이 길이에 대해 합니다:
 * 상한을 **마이그레이션에서 읽어와** 목록과 맞춥니다.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const read = (p: string) => readFileSync(join(here, '../../../../../', p), 'utf8')

/** 마이그레이션 264 의 CHECK 에서 상한을 읽습니다. 손으로 적으면 조정할 때마다 갈라집니다. */
function serverMax(): number {
  const sql = read('supabase/migrations/264_a_quiz_may_be_twenty_questions.sql')
  const m = /requested_count >= 1 AND requested_count <= (\d+)/.exec(sql)
  if (!m) throw new Error('requested_count CHECK not found in migration 264')
  return Number(m[1])
}

/** 회차 쪽 상한. 하나만 열면 세트는 만들어지고 회차가 실패합니다. */
function runMax(): number {
  const sql = read('supabase/migrations/264_a_quiz_may_be_twenty_questions.sql')
  const m = /item_count >= 0 AND item_count <= (\d+)/.exec(sql)
  if (!m) throw new Error('item_count CHECK not found in migration 264')
  return Number(m[1])
}

function counts(file: string): number[] {
  const m = /const COUNTS = \[([^\]]+)\]/.exec(read(file))
  if (!m) throw new Error(`COUNTS not found in ${file}`)
  return m[1].split(',').map((n) => Number(n.trim()))
}

const SCREENS = [
  ['웹', 'packages/web/src/pages/quiz/QuizSetupPage.tsx'],
  ['모바일', 'packages/mobile/src/screens/quiz/QuizSetupScreen.tsx'],
] as const

describe('퀴즈 길이 선택지', () => {
  it.each(SCREENS)('%s 화면은 서버가 받는 길이만 제시한다', (_label, file) => {
    const max = serverMax()
    for (const n of counts(file)) {
      expect(n).toBeGreaterThanOrEqual(1)
      expect(n).toBeLessThanOrEqual(max)
    }
  })

  it('세트 상한과 회차 상한이 같다', () => {
    // 다르면 세트는 만들어지고 `start_quiz_run` 이 터집니다 — 값을 치른 뒤에.
    expect(serverMax()).toBe(runMax())
  })

  it('두 화면이 같은 목록을 쓴다', () => {
    // 한쪽만 고치면 다른 플랫폼에서 같은 400 이 계속 나옵니다.
    expect(counts(SCREENS[0][1])).toEqual(counts(SCREENS[1][1]))
  })

  it.each(SCREENS)('%s 화면의 직접 입력 상한도 서버 상한과 같다', (_label, file) => {
    // 칩만 고치고 이 상자를 놓쳤던 적이 있습니다 — 시뮬레이터 화면에 "직접 입력 1–50" 이
    // 남아 있었고, 21 을 타이핑하면 원시 제약 위반(23514)이 돌아왔습니다.
    const m = /const MAX_COUNT = (\d+)/.exec(read(file))
    if (!m) throw new Error(`MAX_COUNT not found in ${file}`)
    expect(Number(m[1])).toBe(serverMax())
  })

  it('상한 자체가 선택지에 있다', () => {
    // 열어 놓고 고를 수 없으면 연 것이 아닙니다.
    expect(counts(SCREENS[0][1])).toContain(serverMax())
  })
})
