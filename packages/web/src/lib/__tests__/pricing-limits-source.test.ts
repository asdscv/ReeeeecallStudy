/**
 * 랜딩이 광고하는 한도는 **서버가 정한 한도**여야 한다.
 *
 * 무료 한도가 `const FREE_CARD_LIMIT = 1000` 으로 코드에 박혀 있었습니다. 268 이 그 값을
 * 데이터로 옮기고 5,000 으로 올렸는데, 랜딩만 옛 숫자를 계속 광고하면 값을 데이터로 옮긴
 * 의미가 없습니다 — 바꿀 때마다 웹 배포가 필요해지고, 잊으면 틀린 약속이 남습니다.
 *
 * 소스를 읽어 확인합니다. 이 컴포넌트는 Supabase 호출을 하므로 여기서 렌더하지 않고,
 * 확인하려는 것은 "숫자가 어디서 오는가" 하나입니다.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const src = readFileSync(
  join(here, '../../components/landing/PricingSection.tsx'), 'utf8')

describe('랜딩 요금제', () => {
  it('무료 한도를 코드에 박아 두지 않는다', () => {
    expect(src).not.toMatch(/const FREE_CARD_LIMIT\s*=\s*\d+/)
  })

  it('무료 한도를 서버에서 읽는다', () => {
    expect(src).toMatch(/get_plan_limits/)
    expect(src).toMatch(/free_card_limit/)
  })

  it('못 읽으면 틀린 숫자 대신 아무것도 그리지 않는다', () => {
    // 돈을 요구하는 화면에서 잘못된 한도는 그 자체가 약속 위반입니다.
    expect(src).toMatch(/freeCardLimit == null \? '' :/)
  })

  it('유료 플랜 한도는 카탈로그에서 온다', () => {
    // 이쪽은 원래부터 데이터였습니다. 함께 고정해 둡니다.
    expect(src).toMatch(/limitLine\(p\.card_limit\)/)
  })
})
