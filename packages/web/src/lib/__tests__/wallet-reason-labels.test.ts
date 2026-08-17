/**
 * 지갑 사용 내역의 모든 이유에 번역이 있고, 서버가 쓸 수 있는 이유와 정확히 일치한다.
 *
 * 화면은 계산된 키로 그립니다:
 *
 *     t(`reason.${e.reason}`, { defaultValue: e.reason })      // CreditLedgerList.tsx:108
 *
 * `defaultValue` 때문에 번역이 없어도 **터지지 않고 원문이 그대로 찍힙니다.** 프로덕션에서
 * 실제로 그랬습니다: `settle_ai_quiz` 가 `spend_quiz` 를 52건 기록하는 동안 어느 로케일에도
 * 그 키가 없어서, 학습자의 사용 내역에 `spend_quiz` 라는 날 문자열이 그대로 보였습니다.
 * 정적 리터럴만 보는 `i18n-key-usage.test.ts` 도, 여덟 로케일이 en 과 같은지만 보는
 * `translation-keys.test.ts` 도 이걸 볼 수 없습니다 — 모든 로케일에서 똑같이 빠진 키니까요.
 *
 * 그래서 진짜 출처인 **DB의 CHECK 제약**에서 목록을 읽습니다. 서버가 새 이유를 쓰기 시작하면
 * CHECK 가 먼저 넓어져야 하고(안 그러면 INSERT 가 거부됩니다), 그 순간 이 테스트가 번역을
 * 요구합니다. 마이그레이션 파일을 읽는 것이지 하드코딩한 목록이 아닙니다.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../../../..')
const LOCALES = ['en', 'ko', 'ja', 'zh', 'vi', 'th', 'id', 'es'] as const
const PLATFORMS = [
  { name: 'web', dir: join(ROOT, 'packages/web/public/locales') },
  { name: 'mobile', dir: join(ROOT, 'packages/mobile/src/i18n/locales') },
]

/**
 * The reasons the database will accept, read out of the CHECK that enforces them.
 *
 * Migration 250 owns the current list. Parsed rather than copied so that widening the constraint
 * without adding strings fails here instead of on a learner's screen.
 */
const REASONS = (() => {
  const sql = readFileSync(join(ROOT, 'supabase/migrations/250_the_ledger_says_what_was_bought.sql'), 'utf-8')
  const block = sql.match(/ADD CONSTRAINT ai_credit_ledger_reason_check\s*\n?\s*CHECK \(reason IN \(([^)]*)\)\)/s)
  if (!block) throw new Error('reason CHECK not found in migration 250')
  return [...block[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1])
})()

describe('every ledger reason has a label', () => {
  it('마이그레이션에서 이유 목록을 읽었다', () => {
    // 목록을 못 읽으면 위에서 throw 하지만, 조용히 한두 개만 잡혔을 때가 더 위험합니다.
    expect(REASONS.length).toBeGreaterThanOrEqual(10)
    expect(REASONS).toContain('spend_quiz')
    expect(REASONS).toContain('spend_diagnosis')
  })

  for (const platform of PLATFORMS) {
    for (const locale of LOCALES) {
      it(`${platform.name}/${locale}`, () => {
        const data = JSON.parse(
          readFileSync(join(platform.dir, locale, 'wallet.json'), 'utf-8'),
        ) as { reason?: Record<string, string> }
        const reason = data.reason ?? {}

        const missing = REASONS.filter(
          (r) => typeof reason[r] !== 'string' || reason[r].trim() === '')
        expect(missing, `${platform.name}/${locale}/wallet.json reason.*`).toEqual([])

        // 라벨이 이유 문자열 그 자체이면 번역한 것이 아닙니다 — `defaultValue` 와 구별이 안 됩니다.
        const untranslated = REASONS.filter((r) => reason[r] === r)
        expect(untranslated, `${platform.name}/${locale}: 원문 그대로인 라벨`).toEqual([])
      })
    }
  }

  it('`spend` 는 더 이상 카드 생성이라고 말하지 않는다', () => {
    // 250 이전의 행이 전부 `spend` 이고 그 중 다수는 카드가 아니었습니다(설명, 이미지).
    // 소급해서 원장을 고쳐 쓰지 않기로 했으므로, 그 문구는 종류를 특정하면 안 됩니다.
    const ko = JSON.parse(
      readFileSync(join(PLATFORMS[0].dir, 'ko', 'wallet.json'), 'utf-8'),
    ) as { reason: Record<string, string> }
    expect(ko.reason.spend).not.toContain('카드')
    expect(ko.reason.spend_cards).toContain('카드')
  })
})
